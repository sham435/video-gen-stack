// Regression suite for ProviderChain retry/fallback + error classification.
//
// Audit result (AI-001): retry primitives (withRetry/backoff) were in place,
// but every provider catch wrapped errors with `new Error("X generate failed:
// msg")`, ERASING status/code — so the chain could not classify auth vs
// transient vs model-not-found, and the final error carried no provider/model/
// classification diagnostics. Providers now rethrow through ProviderError
// (classification survives), empty responses are INVALID_RESPONSE (never
// re-retried), and the chain emits per-provider classified failures.
//
// Run: node --test tests/provider-chain.test.mjs

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { ProviderChain } from '../src/ai/providers/ProviderChain.mjs'
import { withRetry, isRetryableError, classifyError, ProviderError } from '../src/ai/providers/retry.mjs'

function stubProvider(name, behavior, features = ['chat']) {
  return {
    name,
    supportedFeatures: features,
    generate: async (messages, options) => {
      if (typeof behavior === 'function') return behavior(messages, options)
      if (behavior.throw) throw behavior.throw
      return behavior.result
    },
  }
}

test('chain — falls through to next provider on retryable failure', async () => {
  let firstCalls = 0
  const chain = new ProviderChain([stubProvider('A', async () => {
    firstCalls++
    const e = new Error('boom 503')
    e.status = 503
    throw e
  }), stubProvider('B', { result: 'ok' })])
  const result = await chain.generate([{ role: 'user', content: 'hi' }])
  assert.equal(result, 'ok')
  assert.equal(firstCalls, 1)
  assert.equal(chain.lastError, null, 'lastError cleared after success')
})

test('chain — propagates the last provider error with classified diagnostics', async () => {
  const chain = new ProviderChain([
    stubProvider('A', async () => {
      const e = new Error('bad req')
      e.status = 400
      throw e
    }),
    stubProvider('B', async () => {
      const e = new Error('no key')
      e.status = 401
      throw e
    }),
  ])
  await assert.rejects(() => chain.generate([{ role: 'user', content: 'hi' }]), (err) => {
    assert.ok(err.message.includes('All 2 providers failed'), err.message)
    assert.ok(err.message.includes('A:INVALID_REQUEST(400)'), err.message)
    assert.ok(err.message.includes('B:AUTH(401)'), err.message)
    assert.equal(err.class, 'AUTH')
    assert.equal(err.code, 'ALL_PROVIDERS_FAILED')
    assert.ok(err.providerFailures.length === 2, 'per-provider failures recorded')
    assert.equal(err.providerFailures[0].class, 'INVALID_REQUEST')
    assert.equal(err.providerFailures[1].class, 'AUTH')
    return true
  })
})

test('chain — surface per-provider failures after failure only', async () => {
  const chain = new ProviderChain([stubProvider('A', async () => {
    const e = new Error('down')
    e.status = 500
    throw e
  })])
  await assert.rejects(() => chain.generate([{ role: 'user', content: 'hi' }]))
  assert.equal(chain.failures.length, 1)
  assert.equal(chain.failures[0].provider, 'A')
  assert.equal(chain.failures[0].class, 'TRANSIENT')
  assert.equal(chain.failures[0].retryable, true)
})

test('chain — non-retryable error still falls to next provider (preserved semantics)', async () => {
  // Fallback semantics unchanged: a 401 on A does not abort the chain; B is tried.
  const chain = new ProviderChain([
    stubProvider('A', async () => { const e = new Error('auth'); e.status = 401; throw e }),
    stubProvider('B', { result: 'from-b' }),
  ])
  const result = await chain.generate([{ role: 'user', content: 'hi' }])
  assert.equal(result, 'from-b')
})

test('withRetry — malformed responses (INVALID_RESPONSE) are not re-retried', async () => {
  let calls = 0
  await assert.rejects(
    withRetry(async () => {
      calls++
      throw new ProviderError('empty', { code: 'INVALID_RESPONSE', provider: 'Zen' })
    }, { retries: 2 }),
    /empty/
  )
  assert.equal(calls, 1, 'INVALID_RESPONSE must fail fast, not retry')
})

test('classifyError — maps status/code/name to stable classes', () => {
  const mk = (status, code, name) => { const e = new Error('x'); if (status) e.status = status; if (code) e.code = code; if (name) e.name = name; return e }
  assert.equal(classifyError(mk(429, null)).class, 'TRANSIENT')
  assert.equal(classifyError(mk(503)).class, 'TRANSIENT')
  assert.equal(classifyError(mk(401)).class, 'AUTH')
  assert.equal(classifyError(mk(403)).class, 'AUTH')
  assert.equal(classifyError(mk(404)).class, 'MODEL_NOT_FOUND')
  assert.equal(classifyError(mk(422)).class, 'INVALID_REQUEST')
  assert.equal(classifyError(mk(null, 'MODEL_NOT_FOUND')).class, 'MODEL_NOT_FOUND')
  assert.equal(classifyError(mk(null, 'AUTH')).class, 'AUTH')
  assert.equal(classifyError(mk(null, 'INVALID_RESPONSE')).class, 'INVALID_RESPONSE')
  const t = mk(null, null, 'TimeoutError')
  assert.equal(classifyError(t).class, 'TIMEOUT')
})

test('classifyError — retryable flag mirrors isRetryableError', () => {
  const transient = new Error('x'); transient.status = 503
  assert.equal(classifyError(transient).retryable, isRetryableError(transient))
  const auth = new Error('x'); auth.status = 401
  assert.equal(classifyError(auth).retryable, false)
  const model = new Error('x'); model.status = 404; model.code = 'MODEL_NOT_FOUND'
  assert.equal(classifyError(model).retryable, false)
})

test('ProviderError — preserves classification through a wrapper', () => {
  const cause = new Error('upstream')
  cause.status = 429
  const wrapped = new ProviderError('Zen generate failed: upstream', { provider: 'Zen', model: 'm1', status: 429, cause })
  assert.equal(wrapped.status, 429)
  assert.equal(wrapped.provider, 'Zen')
  assert.equal(wrapped.model, 'm1')
  assert.equal(wrapped.cause, cause)
  assert.equal(classifyError(wrapped).class, 'TRANSIENT')
})