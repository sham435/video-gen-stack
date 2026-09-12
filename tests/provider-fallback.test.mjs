// Provider-chain reliability: dynamic free-model fallback and dead-model
// avoidance.
//
// Covers the required scenarios:
//   1. Primary model succeeds.
//   2. Primary model returns a genuine dead-model 400 → fallback occurs.
//   3. Primary model returns 404 → fallback occurs.
//   4. Failed model is not retried.
//   5. First fallback model succeeds.
//   6. First fallback also returns dead-model 400/404 → next free model selected.
//   7. All candidate free models fail → deterministic provider-exhausted failure.
//   8. A non-model-related 400 does NOT cause inappropriate model rotation.
//   9. Model selection refreshes/uses currently available free models
//      (not a hard-coded deepseek-v4-flash-free).
//  10. No infinite retry loop.
//  11. Existing provider-chain tests remain green (full suite separately).
//  12. Selection policy: FREE tier first (pricing == 0 / :free — any license,
//      healthy ones must be used), FOSS-only fallback when the free tier is
//      empty/exhausted, paid proprietary models never selected. Curated
//      registries (Zen ZEN_MODELS) are restricted to the FOSS subset so
//      proprietary curated entries (big-pickle, minimax, mimo, north-mini-code)
//      are never candidates from the registry.
//
// Run: node --test tests/provider-fallback.test.mjs

import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { OpenRouterProvider } from '../src/ai/providers/OpenRouterProvider.mjs'
import { ZenProvider } from '../src/ai/providers/ZenProvider.mjs'
import { ProviderChain } from '../src/ai/providers/ProviderChain.mjs'
import { classifyError, ProviderError } from '../src/ai/providers/retry.mjs'
import { classifyModelUnavailable } from '../src/ai/providers/modelHealth.mjs'
import { LiveModelCatalog } from '../src/ai/providers/LiveModelCatalog.mjs'

const requireFoss = () => import('../src/ai/providers/fossModels.mjs')

// ── HTTP transport mock ──────────────────────────────────────────────────────

const OrigFetch = globalThis.fetch
let handler = null
let fetchLog = [] // { url, opts }

function mockTransport(fn) {
  handler = fn
  globalThis.fetch = async (url, opts) => {
    fetchLog.push({ url: String(url), opts })
    if (!handler) throw new Error('no handler set')
    const result = await handler(String(url), opts)
    return {
      ok: result.ok ?? true,
      status: result.status ?? 200,
      statusText: result.statusText ?? 'OK',
      headers: {
        get: (k) => (result.headers ?? {})[String(k).toLowerCase()],
        has: (k) => Object.prototype.hasOwnProperty.call(result.headers ?? {}, String(k).toLowerCase()),
      },
      json: async () => result.body ?? {},
      text: async () => result.text ?? '',
    }
  }
}
function restoreTransport() {
  globalThis.fetch = OrigFetch
  handler = null
  fetchLog = []
}

// ✓ / chat/completions responses for each model id
function completionBody(content = 'ok') {
  return { body: { choices: [{ message: { content } }] } }
}
function dead400(model, msg = `The model "${model}" does not exist`, code = 400) {
  return {
    ok: false, status: 400, statusText: 'Bad Request',
    text: JSON.stringify({ error: { message: msg, code } }),
  }
}
function dead404(model) {
  return {
    ok: false, status: 404, statusText: 'Not Found',
    text: JSON.stringify({ error: { message: `Model "${model}" not found`, code: 404 } }),
  }
}
function generic400() {
  return {
    ok: false, status: 400, statusText: 'Bad Request',
    text: JSON.stringify({ error: { message: "Invalid value for 'max_tokens', must be a positive integer" } }),
  }
}

// Stub catalogs: static registry — no network, deterministic.
function staticCatalog(models, opts = {}) {
  return new LiveModelCatalog({
    name: opts.name || 'test',
    registry: models,
    preferredFirst: opts.preferredFirst || [],
    healthFilePath: null,
    ...opts.catalogOpts,
  })
}

// Capture [PROVIDER_FALLBACK] logs
const logs = []
const OrigWarn = console.warn
function captureLogs() {
  logs.length = 0
  console.warn = (...a) => { logs.push(a.join(' ')); OrigWarn(...a) }
}
function restoreLogs() {
  console.warn = OrigWarn
}

// ── classifyModelUnavailable (error taxonomy) ────────────────────────────────

test('classifyModelUnavailable — distinguishes dead-model 400/404 from generic 400', () => {
  // dead-model 400 with explicit model phrasing
  assert.equal(classifyModelUnavailable(400, 'The model "x:free" does not exist').isModelUnavailable, true)
  assert.equal(classifyModelUnavailable(400, 'Model "x" not found', { code: 'MODEL_NOT_FOUND' }).isModelUnavailable, true)
  assert.equal(classifyModelUnavailable(400, 'no such model', { code: 'unknown_model' }).isModelUnavailable, true)
  assert.equal(classifyModelUnavailable(400, 'this model is not supported by the gateway').isModelUnavailable, true)
  // 404 always MODEL_NOT_FOUND
  assert.equal(classifyModelUnavailable(404, 'whatever').isModelUnavailable, true)
  // generic 400 must NOT rotate
  assert.equal(classifyModelUnavailable(400, "Invalid value for 'max_tokens'").isModelUnavailable, false)
  assert.equal(classifyModelUnavailable(400, 'Invalid request body: missing required field').isModelUnavailable, false)
  assert.equal(classifyModelUnavailable(400, '{"error":"bad json"}', {}).isModelUnavailable, false)
  // other statuses
  assert.equal(classifyModelUnavailable(429, 'rate limited').isModelUnavailable, false)
  assert.equal(classifyModelUnavailable(401, 'auth').isModelUnavailable, false)
  assert.equal(classifyModelUnavailable(503, 'down').isModelUnavailable, false)
})

// ── LiveModelCatalog: free filtering / live refresh / TTL / dead exclusion ──

test('LiveModelCatalog — exposes weather-free models from live /models list, not hard-coded', async () => {
  await mockTransportAndApply(async () => {
    const liveModels = [
      { id: 'vendor/a-new-free:free', pricing: { prompt: '0' } },
      { id: 'vendor/paid-model',      pricing: { prompt: '0.01' } },
      { id: 'vendor/b-another-free:free', pricing: { prompt: '0' } },
    ]
    mockTransport(() => ({ body: { data: liveModels } }))
    const catalog = new LiveModelCatalog({
      name: 'openrouter',
      catalogUrl: 'https://openrouter.ai/api/v1/models',
      preferredFirst: [],
      healthFilePath: null,
    })
    const models = await catalog.availableModels()
    assert.deepEqual(models, ['vendor/a-new-free:free', 'vendor/b-another-free:free'])
    assert.ok(!models.includes('vendor/paid-model'), 'paid model filtered out')
    assert.ok(!models.includes('deepseek-v4-flash-free'), 'no hard-coded fallback leaked in')
  })
})

async function mockTransportAndApply(fn) {
  try { await fn() } finally { restoreTransport() }
}

test('LiveModelCatalog — preferredFirst ranks first and dead models excluded until TTL expiry', async () => {
  let now = 1_000_000
  const catalog = staticCatalog(['m3', 'm1', 'm2'], { preferredFirst: ['m1'], catalogOpts: { now: () => now, deadTtlMs: 500 } })
  let list = await catalog.availableModels()
  assert.deepEqual(list, ['m1', 'm3', 'm2'])

  catalog.markDead('m1', 'MODEL_NOT_FOUND', 404)
  list = await catalog.availableModels()
  assert.deepEqual(list, ['m3', 'm2'], 'dead model excluded')

  now += 600 // past TTL
  list = await catalog.availableModels()
  assert.deepEqual(list, ['m1', 'm3', 'm2'], 'model recovers after TTL — not blacklisted forever')
})

test('LiveModelCatalog — persisted health file applies to new instances but expires', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ml-health-'))
  const file = path.join(dir, 'model-health.json')
  let now = 1_000_000
  try {
    const c1 = new LiveModelCatalog({ name: 'test', registry: ['a', 'b'], healthFilePath: file, now: () => now, deadTtlMs: 500 })
    c1.markDead('a', 'MODEL_NOT_FOUND', 404)
    const c2 = new LiveModelCatalog({ name: 'test', registry: ['a', 'b'], healthFilePath: file, now: () => now, deadTtlMs: 500 })
    assert.equal(c2.isDead('a'), true, 'dead model remembered across instances')
    now += 600
    assert.equal(c2.isDead('a'), false, 'dead model recovers after TTL, not permanent')
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('LiveModelCatalog — catalog cache TTL avoids refetching /models on every call', async () => {
  let fetches = 0
  let now = 1_000_000
  try {
    mockTransport(() => { fetches++; return { body: { data: [{ id: 'x:free', pricing: { prompt: '0' } }] } } })
    const catalog = new LiveModelCatalog({
      name: 'openrouter',
      catalogUrl: 'https://openrouter.ai/api/v1/models',
      healthFilePath: null,
      ttlMs: 1000,
      now: () => now,
    })
    await catalog.availableModels()
    await catalog.availableModels()
    assert.equal(fetches, 1, 'cached within TTL')
    now += 1500
    await catalog.availableModels()
    assert.equal(fetches, 2, 'refetches after TTL')
  } finally { restoreTransport() }
})

// ── OpenRouterProvider rotation ──────────────────────────────────────────────

test('OR — primary model succeeds, no fallback', async () => {
  try {
    mockTransport(() => completionBody('ok'))
    const p = new OpenRouterProvider('sk-or-v1-test', { model: 'a:free', catalog: staticCatalog(['a:free', 'b:free']) })
    const out = await p.generate([{ role: 'user', content: 'hi' }])
    assert.equal(out, 'ok')
    assert.equal(p.lastModel, 'a:free')
    const called = JSON.parse(fetchLog[0].opts.body)
    assert.equal(called.model, 'a:free')
  } finally { restoreTransport() }
})

test('OR — dead-model 400 → fallback to next free model succeeds', async () => {
  try {
    mockTransport((url, opts) => {
      const model = JSON.parse(opts.body).model
      if (model === 'a:free') return dead400(model, `The model "${model}" does not exist`)
      return completionBody(`from-${model}`)
    })
    captureLogs()
    const p = new OpenRouterProvider('sk-or-v1-test', { model: 'a:free', catalog: staticCatalog(['a:free', 'b:free']) })
    const out = await p.generate([{ role: 'user', content: 'hi' }])
    assert.equal(out, 'from-b:free')
    assert.equal(p.lastModel, 'b:free')
    assert.ok(logs.some(l => l.includes('[PROVIDER_FALLBACK]') && l.includes('failed_model=a:free') && l.includes('replacement_model=b:free')), `fallback logged: ${logs}`)
  } finally { restoreTransport(); restoreLogs() }
})

test('OR — 404 → fallback occurs', async () => {
  try {
    mockTransport((url, opts) => {
      const model = JSON.parse(opts.body).model
      if (model === 'a:free') return dead404(model)
      return completionBody('ok')
    })
    const p = new OpenRouterProvider('sk-or-v1-test', { model: 'a:free', catalog: staticCatalog(['a:free', 'b:free']) })
    assert.equal(await p.generate([{ role: 'user', content: 'hi' }]), 'ok')
    assert.equal(p.lastModel, 'b:free')
  } finally { restoreTransport() }
})

test('OR — failed model is never retried', async () => {
  try {
    const calls = []
    mockTransport((url, opts) => {
      const model = JSON.parse(opts.body).model
      calls.push(model)
      return dead400(model)
    })
    const p = new OpenRouterProvider('sk-or-v1-test', { model: 'a:free', catalog: staticCatalog(['a:free', 'b:free', 'c:free']) })
    await assert.rejects(() => p.generate([{ role: 'user', content: 'hi' }]), (e) => {
      assert.equal(e.code, 'MODEL_EXHAUSTED')
      return true
    })
    assert.deepEqual(new Set(calls), new Set(['a:free', 'b:free', 'c:free']), 'each model attempted exactly once')
    assert.equal(new Set(calls).size, calls.length, 'no retry of the same dead model')
  } finally { restoreTransport() }
})

test('OR — first fallback also dead → next model selected', async () => {
  try {
    mockTransport((url, opts) => {
      const model = JSON.parse(opts.body).model
      if (model === 'a:free') return dead404(model)
      if (model === 'b:free') return dead400(model)
      return completionBody('finally-worked')
    })
    captureLogs()
    const p = new OpenRouterProvider('sk-or-v1-test', { model: 'a:free', catalog: staticCatalog(['a:free', 'b:free', 'c:free']) })
    assert.equal(await p.generate([{ role: 'user', content: 'hi' }]), 'finally-worked')
    assert.equal(p.lastModel, 'c:free')
    assert.equal(logs.filter(l => l.includes('[PROVIDER_FALLBACK]')).length, 2)
  } finally { restoreTransport(); restoreLogs() }
})

test('OR — all models dead → deterministic provider-exhausted error', async () => {
  try {
    mockTransport((url, opts) => dead404(JSON.parse(opts.body).model))
    const p = new OpenRouterProvider('sk-or-v1-test', { catalog: staticCatalog(['a:free', 'b:free']) })
    await assert.rejects(() => p.generate([{ role: 'user', content: 'hi' }]), (err) => {
      assert.ok(err instanceof ProviderError)
      assert.equal(err.code, 'MODEL_EXHAUSTED')
      assert.equal(err.provider, 'OpenRouter')
      assert.equal(err.retriable, false, 'provider-exhausted is not retryable')
      assert.ok(err.message.includes('no eligible free model'), err.message)
      return true
    })
  } finally { restoreTransport() }
})

test('OR — generic (non-model) 400 does NOT rotate model', async () => {
  try {
    let calls = 0
    mockTransport(() => { calls++; return generic400() })
    const p = new OpenRouterProvider('sk-or-v1-test', { catalog: staticCatalog(['a:free', 'b:free']) })
    await assert.rejects(() => p.generate([{ role: 'user', content: 'hi' }]), (err) => {
      assert.notEqual(err.code, 'MODEL_EXHAUSTED')
      assert.equal(classifyError(err).class, 'INVALID_REQUEST', 'preserved classification')
      return true
    })
    assert.equal(calls, 1, 'no rotation attempted for generic 400')
  } finally { restoreTransport() }
})

test('OR — no infinite loop; bounded by maxModelFallbacks', async () => {
  try {
    const calls = []
    mockTransport((url, opts) => { calls.push(JSON.parse(opts.body).model); return dead404('any') })
    const p = new OpenRouterProvider('sk-or-v1-test', {
      maxModelFallbacks: 1,
      catalog: staticCatalog(['a:free', 'b:free', 'c:free']),
    })
    await assert.rejects(() => p.generate([{ role: 'user', content: 'hi' }]), { code: 'MODEL_EXHAUSTED' })
    assert.equal(calls.length, 2, 'exactly initial + maxModelFallbacks attempts')
  } finally { restoreTransport() }
})

test('OR — default catalog is live (not hard-coded) via /models endpoint', async () => {
  // Regression: provider WITHOUT a stubbed catalog consults /models for its
  // candidate pool — the fallback must come from the live list, never from a
  // hard-coded dead model.
  try {
    mockTransport((url, opts) => {
      if (url.includes('/models')) {
        return { body: { data: [
          { id: 'google/gemma-4-26b-a4b-it:free', pricing: { prompt: '0' } },
          { id: 'qwen/qwen3-32b:free', pricing: { prompt: '0' } },
        ] } }
      }
      const model = JSON.parse(opts.body).model
      if (model === 'google/gemma-4-26b-a4b-it:free') return dead400(model, `The model "${model}" does not exist`)
      return completionBody('live-fallback')
    })
    const p = new OpenRouterProvider('sk-or-v1-test', { healthFilePath: null })
    const out = await p.generate([{ role: 'user', content: 'hi' }])
    assert.equal(out, 'live-fallback')
    const mall = fetchLog.filter(f => !f.url.includes('/models')).map(f => JSON.parse(f.opts.body).model)
    assert.deepEqual(mall, ['google/gemma-4-26b-a4b-it:free', 'qwen/qwen3-32b:free'])
  } finally { restoreTransport() }
})

// ── ZenProvider rotation (registry-based ZEN_MODELS) ─────────────────────────

test('Zen — dead default model (deepseek-v4-flash-free) rotates to next registry model', async () => {
  try {
    mockTransport((url, opts) => {
      const model = JSON.parse(opts.body).model
      if (model === 'deepseek-v4-flash-free') return dead404(model)
      return completionBody('zen-ok')
    })
    captureLogs()
    const p = new ZenProvider('zen-key', { catalog: staticCatalog(['deepseek-v4-flash-free', 'big-pickle', 'minimax-m3-free']) })
    const out = await p.generate([{ role: 'user', content: 'hi' }])
    assert.equal(out, 'zen-ok')
    assert.equal(p.lastModel, 'big-pickle')
    assert.ok(logs.some(l => l.includes('[PROVIDER_FALLBACK]') && l.includes('failed_model=deepseek-v4-flash-free')))
  } finally { restoreTransport(); restoreLogs() }
})

test('Zen — no eligible model → MODEL_EXHAUSTED', async () => {
  try {
    mockTransport(() => dead404('x'))
    const p = new ZenProvider('zen-key', { catalog: staticCatalog(['deepseek-v4-flash-free', 'big-pickle']) })
    await assert.rejects(() => p.generate([{ role: 'user', content: 'hi' }]), { code: 'MODEL_EXHAUSTED' })
  } finally { restoreTransport() }
})

test('Zen — generic 400 does not rotate', async () => {
  try {
    let calls = 0
    mockTransport(() => { calls++; return generic400() })
    const p = new ZenProvider('zen-key', { catalog: staticCatalog(['deepseek-v4-flash-free', 'big-pickle']) })
    await assert.rejects(() => p.generate([{ role: 'user', content: 'hi' }]))
    assert.equal(calls, 1)
  } finally { restoreTransport() }
})

test('Zen — default catalog built from ZEN_MODELS registry, FOSS-only (not hard-coded single)', async () => {
  try {
    mockTransport((url, opts) => {
      if (url.includes('/models')) {
        return { body: { data: [
          { id: 'deepseek-v4-flash-free' },
          { id: 'nemotron-3-ultra-free' },
          { id: 'qwen3.6-plus-free' },
        ] } }
      }
      const model = JSON.parse(opts.body).model
      if (model === 'deepseek-v4-flash-free') return dead404(model)
      return completionBody('zen-live')
    })
    // No catalog injected → provider builds its own: live /models fetch with
    // registry merge. Registry is FOSS-gated (deepseek/nemotron/qwen); live
    // additions are free-tier-first. Proprietary curated entries (big-pickle,
    // minimax, north-mini-code) are never candidates from the registry.
    const p = new ZenProvider('zen-key', { healthFilePath: null })
    const out = await p.generate([{ role: 'user', content: 'hi' }])
    assert.equal(out, 'zen-live')
    assert.ok(p.lastModel !== 'deepseek-v4-flash-free', 'rotated away from dead default')
    const modelsFetched = fetchLog.some(f => f.url.includes('/models'))
    assert.ok(modelsFetched, 'live /models consulted (not static-only)')
  } finally { restoreTransport() }
})

test('Zen — live /models discovers a new free model; registry stays FOSS-gated (no manual registry update)', async () => {
  try {
    mockTransport((url, opts) => {
      if (url.includes('/models')) {
        return { body: { data: [
          { id: 'deepseek-v4-flash-free' },        // registry-FOSS + live, dead
          { id: 'meta-llama/llama-4-6b:free' },    // discovered live — FREE tier
          { id: 'big-pickle' },                    // live, not free, not FOSS → never
        ] } }
      }
      const model = JSON.parse(opts.body).model
      if (model === 'deepseek-v4-flash-free') return dead404(model)
      if (model === 'nemotron-3-ultra-free') return dead404(model)
      if (model === 'qwen3.6-plus-free') return dead404(model)
      if (model === 'big-pickle') return dead404(model) // known-free but dead in this scenario
      return completionBody('discovered-ok')
    })
    const p = new ZenProvider('zen-key', { healthFilePath: null, maxModelFallbacks: 5 })
    const out = await p.generate([{ role: 'user', content: 'hi' }])
    // Registry FOSS models + known-free big-pickle all dead in order → rotation
    // reaches the LIVE free discovery. big-pickle is a free-tier candidate now
    // (knownFree), so it must die before the discovery is reached.
    assert.equal(out, 'discovered-ok')
    assert.equal(p.lastModel, 'meta-llama/llama-4-6b:free')
  } finally { restoreTransport() }
})

test('Zen — live /models fetch failure falls back to registry (no hard failure)', async () => {
  try {
    mockTransport((url, opts) => {
      if (url.includes('/models')) return { ok: false, status: 500, text: 'boom' }
      const model = JSON.parse(opts.body).model
      if (model === 'deepseek-v4-flash-free') return dead404(model)
      return completionBody('registry-fallback-ok')
    })
    const p = new ZenProvider('zen-key', { healthFilePath: null })
    const out = await p.generate([{ role: 'user', content: 'hi' }])
    assert.equal(out, 'registry-fallback-ok')
  } finally { restoreTransport() }
})

test('FOSS — isFossModelId allows open families, denies proprietary, excludes unknown (strict)', async () => {
  const { isFossModelId } = await requireFoss()
  const allow = ['google/gemma-4-26b-a4b-it:free', 'qwen/qwen3-32b:free', 'meta-llama/llama-4-6b:free',
                 'deepseek-v4-flash-free', 'nemotron-3-ultra-free', 'qwen3.6-plus-free',
                 'gpt-oss:120b', 'microsoft/phi-4:free', 'mistralai/mistral-small-3.2-24b-instruct:free']
  for (const id of allow) assert.ok(isFossModelId(id), `${id} should be FOSS`)
  const deny = ['openai/gpt-4o-mini:free', 'openai/gpt-5:free', 'anthropic/claude-3-5-haiku:free',
                'google/gemini-2.0-flash:free', 'minimax-m3-free', 'big-pickle', 'north-mini-code-free',
                'z-ai/glm-5.2:free', 'x-ai/grok-3-mini:free', 'mistralai/mistral-large-2411:free',
                'moonshotai/kimi-k2:free']
  for (const id of deny) assert.ok(!isFossModelId(id), `${id} must NOT be FOSS`)
  const unknown = ['fresh/live-free:free', 'brand-new-added-today:free', 'vendor/mystery-42']
  for (const id of unknown) assert.ok(!isFossModelId(id), `${id} unknown → excluded (strict)`)
})

test('LiveModelCatalog — preferFree: FREE tier first (any license), paid-FOSS fallback, paid-proprietary never', async () => {
  try {
    mockTransport(() => ({ body: { data: [
      { id: 'openai/gpt-4o-mini:free',     pricing: { prompt: '0' },  completion: '0' }, // free, closed weights → FREE tier
      { id: 'google/gemma-4-26b-a4b-it:free', pricing: { prompt: '0' } },                 // free + FOSS → FREE tier
      { id: 'qwen/qwen3-coder-plus',       pricing: { prompt: '0.5' } },                  // paid FOSS → fallback tier
      { id: 'openai/gpt-5',                pricing: { prompt: '20' } },                   // paid proprietary → NEVER
    ] } }))
    const catalog = new LiveModelCatalog({
      name: 'openrouter',
      catalogUrl: 'https://openrouter.ai/api/v1/models',
      preferFree: true,
      preferredFirst: ['openai/gpt-4o-mini:free'],
      healthFilePath: null,
    })
    const models = await catalog.availableModels()
    assert.deepEqual(models, [
      'openai/gpt-4o-mini:free',     // free proprietary: used when healthy (free tier wins)
      'google/gemma-4-26b-a4b-it:free',
      'qwen/qwen3-coder-plus',       // paid FOSS reachable only after free tier
    ])
    assert.ok(!models.includes('openai/gpt-5'), 'paid proprietary never selected')
  } finally { restoreTransport() }
})

test('LiveModelCatalog — registryFossOnly keeps only FOSS entries from curated registry (knownFree survives)', async () => {
  // WITHOUT knownFree: big-pickle is NOT FOSS → excluded.
  const without = new LiveModelCatalog({
    name: 'zen',
    registry: [
      'deepseek-v4-flash-free', 'big-pickle', 'minimax-m3-free',
      'mimo-v2.5-free', 'nemotron-3-ultra-free', 'north-mini-code-free', 'qwen3.6-plus-free',
    ],
    registryFossOnly: true,
    healthFilePath: null,
  })
  const withoutList = await without.availableModels()
  assert.deepEqual(withoutList, ['deepseek-v4-flash-free', 'nemotron-3-ultra-free', 'qwen3.6-plus-free'],
    'big-pickle/minimax/mimo/north excluded (knownFree not passed)')
  // WITH knownFree: big-pickle survives the gate (it IS free).
  const withKf = new LiveModelCatalog({
    name: 'zen',
    registry: [
      'deepseek-v4-flash-free', 'big-pickle', 'minimax-m3-free',
      'mimo-v2.5-free', 'nemotron-3-ultra-free', 'north-mini-code-free', 'qwen3.6-plus-free',
    ],
    registryFossOnly: true,
    knownFree: ['big-pickle'],
    healthFilePath: null,
  })
  const withKfList = await withKf.availableModels()
  assert.deepEqual(withKfList, ['deepseek-v4-flash-free', 'big-pickle', 'nemotron-3-ultra-free', 'qwen3.6-plus-free'],
    'big-pickle free-tier (knownFree); minimax/mimo/north still gated')
})

test('LiveModelCatalog — knownFree: markerless free model (big-pickle) is a free-tier candidate and survives the FOSS registry gate', async () => {
  const catalog = new LiveModelCatalog({
    name: 'zen',
    registry: ['deepseek-v4-flash-free', 'big-pickle'],
    registryFossOnly: true, // big-pickle is NOT FOSS — gate would drop it without knownFree
    knownFree: ['big-pickle'],
    preferredFirst: ['deepseek-v4-flash-free'],
    healthFilePath: null,
  })
  let list = await catalog.availableModels()
  assert.deepEqual(list, ['deepseek-v4-flash-free', 'big-pickle'], 'both free-tier members')
  catalog.markDead('deepseek-v4-flash-free', 'MODEL_NOT_FOUND', 404)
  list = await catalog.availableModels()
  assert.deepEqual(list, ['big-pickle'], 'big-pickle selectable when the default is dead')
})

test('LiveModelCatalog — mergeRegistry unions curated registry with live free list', async () => {
  try {
    mockTransport(() => ({ body: { data: [
      { id: 'brand-new:free', pricing: { prompt: '0' } },
      { id: 'genuine:free',   pricing: { prompt: '0' } },
    ] } }))
    const catalog = new LiveModelCatalog({
      name: 'zen',
      catalogUrl: 'https://example/zen/v1/models',
      registry: ['registry-model-a', 'registry-model-b'],
      mergeRegistry: true,
      healthFilePath: null,
    })
    const models = await catalog.availableModels()
    assert.deepEqual(models, ['registry-model-a', 'registry-model-b', 'brand-new:free', 'genuine:free'])
  } finally { restoreTransport() }
})

// ── ProviderChain integration ────────────────────────────────────────────────

test('chain — OpenRouter MODEL_EXHAUSTED falls through to Zen (existing semantics preserved)', async () => {
  try {
    mockTransport((url, opts) => {
      if (url.includes('opencode.ai')) {
        return completionBody('zen-wins')
      }
      return dead404(JSON.parse(opts.body).model)
    })
    const chain = new ProviderChain([
      new OpenRouterProvider('sk-or-v1-test', { catalog: staticCatalog(['a:free']) }),
      new ZenProvider('zen-key', { catalog: staticCatalog(['deepseek-v4-flash-free', 'big-pickle']) }),
    ])
    const out = await chain.generate([{ role: 'user', content: 'hi' }])
    assert.equal(out, 'zen-wins')
  } finally { restoreTransport() }
})