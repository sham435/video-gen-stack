// Bounded exponential backoff retry for transient distribution errors.
//
// Retries ONLY transient failures:
//   - HTTP 429 (rate limit)
//   - HTTP 5xx (server errors)
//   - network timeouts / fetch-level failures
//
// Never retries permanent errors: 400, 401, 403, 404, 422 (auth, permissions,
// validation) — those are caller bugs and retrying them wastes quota.
//
// Usage:
//   const res = await withTransientRetry(() => httpPost(...), { attempts: 3 })
// Throws the last error after attempts are exhausted.

const DEFAULT_BASE_MS = 1000
const DEFAULT_MAX_MS = 15000

export function isTransientError(err) {
  // Network/timeout (fetch throws, or an AbortError from AbortSignal.timeout).
  if (!(err instanceof Error)) return false
  if (err.name === 'AbortError' || err.code === 'ETIMEDOUT' || err.code === 'ECONNRESET' || err.code === 'ECONNREFUSED') return true
  if (typeof err.status === 'number') return err.status === 429 || err.status >= 500
  return false
}

export function sleep(ms) {
  return new Promise(r => setTimeout(r, ms))
}

// Exponential backoff with full jitter: delay ∈ [0, min(max, base * 2^attempt)).
function backoffDelay(attempt, baseMs, maxMs) {
  const cap = Math.min(maxMs, baseMs * 2 ** attempt)
  return Math.floor(Math.random() * cap)
}

export async function withTransientRetry(fn, { attempts = 3, baseMs = DEFAULT_BASE_MS, maxMs = DEFAULT_MAX_MS, isTransient = isTransientError } = {}) {
  let lastErr
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn()
    } catch (err) {
      lastErr = err
      if (!isTransient(err) || i === attempts - 1) throw err
      await sleep(backoffDelay(i, baseMs, maxMs))
    }
  }
  throw lastErr
}