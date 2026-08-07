import { test } from 'node:test'
import assert from 'node:assert/strict'
import { withRetry, isRetryableError, backoffDelay } from '../src/ai/providers/retry.mjs'

test('retries transient HTTP 5xx and 429 responses', async () => {
  let calls = 0
  const result = await withRetry(async () => {
    calls++
    if (calls < 3) {
      const e = new Error(`down (${calls})`)
      e.status = 503
      throw e
    }
    return 'ok'
  }, { retries: 2 })
  assert.equal(result, 'ok')
  assert.equal(calls, 3)
})

test('retries timeouts (AbortError)', async () => {
  let calls = 0
  const result = await withRetry(async () => {
    calls++
    if (calls < 3) throw new Error('The operation was aborted due to timeout')
    return 'ok'
  }, { retries: 2 })
  assert.equal(result, 'ok')
  assert.equal(calls, 3)
})

test('does not retry authentication errors (401)', async () => {
  let calls = 0
  await assert.rejects(
    withRetry(async () => {
      calls++
      const e = new Error('unauthorized')
      e.status = 401
      throw e
    }, { retries: 2 }),
    /unauthorized/
  )
  assert.equal(calls, 1)
})

test('does not retry invalid requests (400/422)', async () => {
  let calls = 0
  await assert.rejects(
    withRetry(async () => {
      calls++
      const e = new Error('bad request')
      e.status = 400
      throw e
    }, { retries: 2 })
  )
  assert.equal(calls, 1)
})

test('does not retry missing models (404)', async () => {
  let calls = 0
  await assert.rejects(
    withRetry(async () => {
      calls++
      const e = new Error('model missing')
      e.status = 404
      e.code = 'MODEL_NOT_FOUND'
      throw e
    }, { retries: 2 })
  )
  assert.equal(calls, 1)
})

test('backoff schedule is 0ms, 500ms, 2000ms', () => {
  assert.equal(backoffDelay(0), 0)
  assert.equal(backoffDelay(1), 500)
  assert.equal(backoffDelay(2), 2000)
})

test('exhausts retries then throws the last error', async () => {
  let calls = 0
  await assert.rejects(
    withRetry(async () => {
      calls++
      const e = new Error('always fails')
      e.status = 500
      throw e
    }, { retries: 2 }),
    /always fails/
  )
  assert.equal(calls, 3)
})