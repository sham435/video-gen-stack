// Dead-model error classification helpers.
//
// Distinguishes provider/model-unavailability 400/404 (model dead/removed/unsupported)
// from genuine malformed-request 400 (invalid payload, missing fields, contract
// violations). Used by OpenRouterProvider and ZenProvider to decide whether
// to rotate to a different model vs. preserve the existing error and let
// ProviderChain try the next vendor.

// ── body error codes that indicate the model itself is the problem ────────────
// Covers OpenAI-compatible error.code / error.type fields from both OpenRouter
// and the Zen gateway.
export const MODEL_UNAVAILABLE_BODY_CODES = new Set([
  'MODEL_NOT_FOUND', 'model_not_found', 'ModelNotFound',
  'NOT_FOUND', 'not_found', 'ENOTFOUND',
  'unknown_model', 'invalid_model', 'UNKNOWN_MODEL',
  'model_not_available', 'model_unavailable',
  'MODEL_RETIRED', 'model_retired',
  'MODEL_DISABLED', 'model_disabled',
  'MODEL_REMOVED', 'model_removed',
])

// ── body message patterns that signal model unavailability ────────────────────
// Each pattern requires the word "model" (or a known exact phrase) to appear in
// the message body so that generic "Invalid request" / "Missing required field"
// / "Invalid value for 'model'" messages are NOT misclassified.
const MODEL_UNAVAILABLE_MSG = [
  // model … does not exist / not found / unavailable / unsupported / retired / removed / unknown
  /\bmodel\b[^.!?]{0,80}\b(does not exist|not found|is not found|unavailable|not available|is not available|unsupported|retired|removed|unknown|is invalid)\b/i,
  // Exact phrases where the model-name is the subject
  /\b(no such model|unknown model|invalid model|model not supported|model is not supported)\b/i,
  // OpenRouter canonical 404 phrasing
  /does not exist or you do not have access/i,
]

/**
 * Classify whether a non-ok HTTP response signals that the *selected model* is
 * unavailable / dead / unsupported, as opposed to a generic malformed-request
 * error that should NOT trigger model rotation.
 *
 * @param {number|null}   status    HTTP status code (400, 404, …)
 * @param {string}        bodyText  Raw response body text
 * @param {object|null}   errorBody Parsed error body (JSON.error or equivalent)
 * @returns {{ isModelUnavailable: boolean, reason: string|null }}
 */
export function classifyModelUnavailable(status, bodyText = '', errorBody = null) {
  const code = String(errorBody?.code ?? errorBody?.type ?? '')
  const msg  = bodyText || String(errorBody?.message ?? '')

  // 1. Explicit error code from the body indicates model-level failure.
  if (code && MODEL_UNAVAILABLE_BODY_CODES.has(code)) {
    return { isModelUnavailable: true, reason: `BODY_CODE:${code}` }
  }

  // 2. HTTP 404 is always MODEL_NOT_FOUND per the existing taxonomy.
  const st = Number(status)
  if (st === 404) {
    return { isModelUnavailable: true, reason: 'MODEL_NOT_FOUND' }
  }

  // 3. HTTP 400 only when the body message explicitly describes a model-level
  //    problem (not a malformed request / missing field / contract violation).
  if (st === 400 && msg) {
    for (const re of MODEL_UNAVAILABLE_MSG) {
      if (re.test(msg)) {
        return { isModelUnavailable: true, reason: `MSG:${re.source.slice(0, 60)}` }
      }
    }
  }

  return { isModelUnavailable: false, reason: null }
}
