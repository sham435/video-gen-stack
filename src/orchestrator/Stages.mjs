export const StageStatus = Object.freeze({
  PENDING: 'PENDING',
  RUNNING: 'RUNNING',
  COMPLETED: 'COMPLETED',
  FAILED: 'FAILED',
  RETRYING: 'RETRYING',
  QUARANTINED: 'QUARANTINED',
  SKIPPED: 'SKIPPED',
})

export const FailureClass = Object.freeze({
  TRANSIENT: 'TRANSIENT',       // network timeout, ffmpeg glitch → retry
  RATE_LIMITED: 'RATE_LIMITED', // 429 → backoff
  INVALID_ARTIFACT: 'INVALID',  // bad render, corrupt file → regenerate
  PERMANENT: 'PERMANENT',       // auth failure, quota → quarantine
})

export const STAGES = Object.freeze([
  {
    id: 'DISCOVER',
    description: 'News discovery + dedup + article selection',
    failureClass: FailureClass.TRANSIENT,
    maxRetries: 2,
    backoffMs: 2000,
  },
  {
    id: 'RENDER',
    description: 'Video rendering via NewsBroadcastEngine',
    failureClass: FailureClass.INVALID_ARTIFACT,
    maxRetries: 2,
    backoffMs: 0,
  },
  {
    id: 'THUMBNAIL',
    description: 'Autonomous thumbnail factory production',
    failureClass: FailureClass.INVALID_ARTIFACT,
    maxRetries: 2,
    backoffMs: 0,
  },
  {
    id: 'C2PA',
    description: 'C2PA content credential signing + verification',
    failureClass: FailureClass.TRANSIENT,
    maxRetries: 2,
    backoffMs: 1000,
  },
  {
    id: 'UPLOAD',
    description: 'YouTube video upload + thumbnail set',
    failureClass: FailureClass.RATE_LIMITED,
    maxRetries: 3,
    backoffMs: 5000,
  },
  {
    id: 'PUBLISH',
    description: 'LinkedIn cross-post + social distribution + pinned comment',
    failureClass: FailureClass.TRANSIENT,
    maxRetries: 2,
    backoffMs: 3000,
  },
  {
    id: 'VERIFY',
    description: 'YouTube thumbnail + video state verification',
    failureClass: FailureClass.TRANSIENT,
    maxRetries: 3,
    backoffMs: 10000,
  },
  {
    id: 'ANALYTICS',
    description: 'Performance memory + retention snapshot + feedback loop',
    failureClass: FailureClass.TRANSIENT,
    maxRetries: 1,
    backoffMs: 0,
  },
])

export function getStage(id) {
  return STAGES.find(s => s.id === id)
}

export function stageIndex(id) {
  return STAGES.findIndex(s => s.id === id)
}

export function nextStage(currentId) {
  const idx = stageIndex(currentId)
  return idx >= 0 && idx < STAGES.length - 1 ? STAGES[idx + 1] : null
}

export function classifyError(error, stage) {
  const msg = String(error?.message || error || '').toLowerCase()
  const status = error?.status || error?.statusCode || 0

  if (status === 429 || msg.includes('429') || msg.includes('rate limit') || msg.includes('quota exceeded')) {
    return FailureClass.RATE_LIMITED
  }
  if (status === 401 || status === 403 || msg.includes('unauthorized') || msg.includes('forbidden')) {
    return FailureClass.PERMANENT
  }
  if (msg.includes('render validation failed') || msg.includes('corrupt') || msg.includes('invalid artifact') || msg.includes('moov atom')) {
    return FailureClass.INVALID_ARTIFACT
  }

  return stage.failureClass || FailureClass.TRANSIENT
}
