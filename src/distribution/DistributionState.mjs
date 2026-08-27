/**
 * DistributionState — per-destination publication state.
 * Independent of upload/verification state. Each destination tracks its own lifecycle.
 */

export const DistributionState = Object.freeze({
  PENDING: 'PENDING',
  IN_PROGRESS: 'IN_PROGRESS',
  SUCCESS: 'SUCCESS',
  FAILED: 'FAILED',
  SKIPPED: 'SKIPPED',
})

/** Distribution failure classification for retry decisions */
export class DistributionFailure {
  constructor(destination, error, classification) {
    this.destination = destination
    this.error = error
    this.classification = classification // 'AUTHORIZATION' | 'QUOTA' | 'TRANSIENT' | 'PERMANENT'
    this.retryable = classification === 'TRANSIENT'
    this.timestamp = new Date().toISOString()
  }

  static classify(error) {
    const msg = String(error?.message || error || '').toLowerCase()
    const status = error?.status || error?.statusCode || 0

    if (status === 401 || status === 403 || msg.includes('unauthorized') || msg.includes('forbidden') || msg.includes('insufficientpermissions')) {
      return 'AUTHORIZATION'
    }
    if (status === 429 || msg.includes('429') || msg.includes('quota exceeded') || msg.includes('ratelimit')) {
      return 'QUOTA'
    }
    if (status >= 500 || msg.includes('timeout') || msg.includes('network') || msg.includes('econnreset')) {
      return 'TRANSIENT'
    }
    return 'PERMANENT'
  }
}
