const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

export const RETRYABLE_HTTP = new Set([429, 500, 502, 503, 504])

// Statuses that must never be retried: auth, invalid request, missing model.
const NON_RETRYABLE_HTTP = new Set([400, 401, 403, 404, 405, 422])

// Timeouts and raw network failures (fetch aborted / refused) are retryable.
// INVALID_RESPONSE = provider responded but the payload was malformed/empty —
// deterministic, retrying won't fix it.
const NON_RETRYABLE_CODES = new Set(['AUTH', 'INVALID_REQUEST', 'MODEL_NOT_FOUND', 'INVALID_RESPONSE'])

export const RETRY_BACKOFF = [0, 500, 2000]

export function backoffDelay(attempt, error) {
  // Honor Retry-After header from 429 responses when available (set by
  // providers that capture the header, e.g. OpenRouterProvider). Falls
  // back to the fixed schedule [0, 500, 2000].
  if (error?.retryAfterMs && Number.isFinite(error.retryAfterMs)) {
    return Math.min(error.retryAfterMs, 10000) // cap at 10s
  }
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
    if (attempt > 0) await sleep(backoffDelay(attempt - 1, lastError))
    try {
      return await fn(attempt)
    } catch (e) {
      lastError = e
      if (!isRetryableError(e)) throw e
    }
  }

  throw lastError
}

// Classified provider failure. Providers rethrow through this wrapper so the
// machine-readable classification (status, code, provider, model) survives the
// `generate failed:` message-wrapping that used to erase it — the chain needs
// the code/status to decide fallback vs fail-fast, and to emit diagnostics.
export class ProviderError extends Error {
  constructor(message, classification = {}) {
    super(message)
    this.name = 'ProviderError'
    if (classification.status != null) this.status = classification.status
    if (classification.code) this.code = classification.code
    if (classification.provider) this.provider = classification.provider
    if (classification.model) this.model = classification.model
    if (classification.cause) this.cause = classification.cause
    if (classification.retriable !== undefined) this.retriable = classification.retriable
  }
}

// Classify provider/model/error into a stable diagnostic descriptor. Used by
// the chain so the final error and logs carry provider+model+error class.
export function classifyError(error, { provider = null, model = null } = {}) {
  const retryable = isRetryableError(error)
  let cls = 'UNKNOWN'
  if (error?.code) {
    const c = String(error.code)
    if (c.includes('AUTH')) cls = 'AUTH'
    else if (c === 'MODEL_NOT_FOUND') cls = 'MODEL_NOT_FOUND'
    else if (c === 'INVALID_REQUEST') cls = 'INVALID_REQUEST'
    else if (c === 'INVALID_RESPONSE') cls = 'INVALID_RESPONSE'
    else cls = c
  } else if (error?.status != null) {
    const s = Number(error.status)
    if (s === 429 || (s >= 500 && s <= 599)) cls = 'TRANSIENT'
    else if (s === 401 || s === 403) cls = 'AUTH'
    else if (s === 404) cls = 'MODEL_NOT_FOUND'
    else if (s >= 400 && s < 500) cls = 'INVALID_REQUEST'
  } else if (error?.name === 'TimeoutError' || error?.name === 'AbortError') {
    cls = 'TIMEOUT'
  } else if (error?.type === 'request-timeout') {
    cls = 'TIMEOUT'
  } else if (error instanceof TypeError) {
    cls = 'NETWORK'
  }
  return {
    provider: error?.provider ?? provider ?? null,
    model: error?.model ?? model ?? null,
    code: error?.code ?? null,
    status: error?.status ?? null,
    class: cls,
    retryable,
    message: error?.message ?? String(error),
  }
}