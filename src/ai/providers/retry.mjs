const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

export const RETRYABLE_HTTP = new Set([429, 500, 502, 503, 504])

// Statuses that must never be retried: auth, invalid request, missing model.
const NON_RETRYABLE_HTTP = new Set([400, 401, 403, 404, 405, 422])

// Timeouts and raw network failures (fetch aborted / refused) are retryable.
const NON_RETRYABLE_CODES = new Set(['AUTH', 'INVALID_REQUEST', 'MODEL_NOT_FOUND'])

export const RETRY_BACKOFF = [0, 500, 2000]

export function backoffDelay(attempt) {
  return RETRY_BACKOFF[Math.min(attempt, RETRY_BACKOFF.length - 1)] ?? 3000
}

// Classify an error thrown by a provider fetch. Returns true when the call
// should be retried, false when it must fail fast.
export function isRetryableError(error) {
  if (!error) return false
  if (error.retriable !== undefined) return Boolean(error.retriable)

  if (error.status != null) {
    if (RETRYABLE_HTTP.has(error.status)) return true
    if (NON_RETRYABLE_HTTP.has(error.status)) return false
  }
  if (error.code && NON_RETRYABLE_CODES.has(error.code)) return false

  // Timeout / transient network failure (AbortSignal.timeout raises this).
  if (error.name === 'TimeoutError' || error.name === 'AbortError') return true
  if (error.type === 'request-timeout') return true

  return true
}

// Wrap fn with retry + backoff. fn receives the current attempt index. Any
// error with a retryable signature is retried; everything else propagates.
export async function withRetry(fn, options = {}) {
  const maxAttempts = (options.retries ?? 2) + 1
  let lastError = null

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    if (attempt > 0) await sleep(backoffDelay(attempt - 1))
    try {
      return await fn(attempt)
    } catch (e) {
      lastError = e
      if (!isRetryableError(e)) throw e
    }
  }

  throw lastError
}