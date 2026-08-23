import { FailureClass } from './Stages.mjs'

/**
 * RetryPolicy determines what to do when a stage fails:
 *   - TRANSIENT         → retry with exponential backoff
 *   - RATE_LIMITED      → retry with longer backoff, respect budget
 *   - INVALID_ARTIFACT  → regenerate from scratch (no backoff)
 *   - PERMANENT         → quarantine immediately
 */

const BASE_DELAY = {
  [FailureClass.TRANSIENT]: 2000,
  [FailureClass.RATE_LIMITED]: 5000,
  [FailureClass.INVALID_ARTIFACT]: 0,
  [FailureClass.PERMANENT]: 0,
}

const MAX_BACKOFF = 60_000

export function nextDelay(attempt, failureClass, stageBackoffMs = 0) {
  if (failureClass === FailureClass.PERMANENT) return null
  if (attempt <= 0) return 0

  const base = (stageBackoffMs > 0 ? stageBackoffMs : null) ?? BASE_DELAY[failureClass] ?? 2000
  const delay = base * Math.pow(2, attempt - 1)
  return Math.min(delay, MAX_BACKOFF)
}

export function shouldRetry(attempt, maxRetries, failureClass) {
  if (failureClass === FailureClass.PERMANENT) return false
  if (attempt >= maxRetries) return false
  return true
}

export function classifyDecision(failureClass, attempt, maxRetries) {
  if (failureClass === FailureClass.PERMANENT) {
    return { action: 'quarantine', reason: 'permanent failure' }
  }
  if (attempt >= maxRetries) {
    return { action: 'quarantine', reason: `exhausted ${maxRetries} retries` }
  }
  if (failureClass === FailureClass.INVALID_ARTIFACT) {
    return { action: 'regenerate', reason: 'invalid artifact, retrying from scratch' }
  }
  return {
    action: 'retry',
    delayMs: nextDelay(attempt, failureClass),
    reason: `attempt ${attempt + 1}/${maxRetries}`,
  }
}
