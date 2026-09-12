// QuoteProviderSmoke — PROVES the quote format's line-4 path uses the repo's
// real provider chain, including the WORKING Big Pickle / OpenCode Zen route.
//
// The embedded repo-aware agent's zen invocation is exactly:
//   POST https://opencode.ai/zen/v1/chat/completions
//   headers: Authorization: Bearer <zen key>, x-opencode-session: <session id>
// (packages/opencode request.ts). Without x-opencode-session the free tier
// returns MissingSessionID; with it the gateway accepts the request.
//
// Test 1 (QUOTE_PROVIDER_SMOKE=1 gate — makes a REAL LLM call, needs network
// and a live opencode session, so it skips by default):
//   • discovers the current opencode session id
//   • resolves the chain via resolveProviderChain (existing abstraction)
//   • asserts the chain yields line-4 with source === 'llm'
// If this test fails while the gate is on, the line-4 "LLM" path is broken.
//
// Test 2 (always runs, offline): the deterministic pool is a LAST-RESORT
// fail-safe — with provider=null it still returns a UNIQUE line, proving
// pandemic/quarantine uniqueness is fully independent of the LLM provider.

import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { resolveProviderChain } from '../src/ai/providers/resolveProviders.mjs'
import { discoverZenSessionId, ZenProvider } from '../src/ai/providers/ZenProvider.mjs'
import { QuoteLineAgent, FALLBACK_POOL } from '../src/formats/quote/QuoteLineAgent.mjs'
import { AssetRegistry } from '../src/uniqueness/AssetRegistry.mjs'

function tmpRegistry() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'quote-provider-'))
  // IMPORTANT: AssetRegistry takes an OPTIONS object — a bare path string
  // silently falls back to the PRODUCTION ledger (data/asset-registry.json).
  return new AssetRegistry({ filePath: path.join(dir, 'registry.json') })
}

test(
  'provider chain obtains a REAL line-4 from OpenCode Zen (QUOTE_PROVIDER_SMOKE=1 only)',
  { skip: process.env.QUOTE_PROVIDER_SMOKE !== '1' },
  async () => {
    const sessionId = discoverZenSessionId()
    assert.ok(sessionId, 'expected an OpenCode session id (run inside the opencode app, or set ZEN_SESSION_ID)')
    if (!process.env.ZEN_SESSION_ID) process.env.ZEN_SESSION_ID = sessionId

    const { chain, providers } = await resolveProviderChain()
    assert.ok(
      providers.some(p => p instanceof ZenProvider),
      `expected ZenProvider in the chain, got ${providers.map(p => p.constructor?.name)}`,
    )

    const agent = new QuoteLineAgent(chain, tmpRegistry())
    const result = await agent.generate({ topic: 'shelter and resilience' })
    assert.equal(
      result.source, 'llm',
      `line-4 must come from the LLM path, got ${result.source}; chain failures: ${chain.failures.map(f => f.message).join(' | ')}`,
    )
    assert.ok(result.line4 && result.line4.trim().length > 0, 'line-4 non-empty')

    const served = providers.map(p => `${p.constructor?.name}(${p.lastModel})`)
    console.log('[quote-provider-smoke] LINE-4 FROM LLM:', result.line4)
    console.log('[quote-provider-smoke] session:', sessionId)
    console.log('[quote-provider-smoke] chain:', served.join(' | '))
  },
)

test('deterministic pool is a last-resort (>no provider) and still unique', async () => {
  const agent = new QuoteLineAgent(null, tmpRegistry())
  const r = await agent.generate({ topic: 'shelter and resilience' })
  assert.equal(r.source, 'fallback')
  assert.ok(FALLBACK_POOL.includes(r.line4), `line4 must come from the pool, got "${r.line4}"`)

  // Uniqueness without the LLM: record the emitted line, then the next
  // generation must NOT repeat it (same quarantine ledger the LLM path uses).
  agent.record(r.line4, { jobId: 'j1', videoId: 'v1', title: 'quote-line-4' })
  const r2 = await agent.generate({ topic: 'shelter and resilience' })
  assert.notEqual(r2.line4, r.line4, 'pool must not repeat a recorded line-4')
  assert.equal(r2.source, 'fallback')
})