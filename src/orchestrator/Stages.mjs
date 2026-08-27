export const StageStatus = Object.freeze({
  PENDING: 'PENDING',
  RUNNING: 'RUNNING',
  COMPLETED: 'COMPLETED',
  FAILED: 'FAILED',
  RETRYING: 'RETRYING',
  QUARANTINED: 'QUARANTINED',
  SKIPPED: 'SKIPPED',
  WAITING_FOR_QUOTA: 'WAITING_FOR_QUOTA',
})

export const FailureClass = Object.freeze({
  TRANSIENT: 'TRANSIENT',         // network timeout, ffmpeg glitch → retry
  RATE_LIMITED: 'RATE_LIMITED',   // 429 → backoff
  INVALID_ARTIFACT: 'INVALID',    // bad render, corrupt file → regenerate
  PERMANENT: 'PERMANENT',         // auth failure, quota → quarantine
  DEPENDENCY: 'DEPENDENCY',       // upstream stage output missing → retry
  CONFIGURATION: 'CONFIGURATION', // missing env var, invalid config → quarantine
})

export const STAGES = Object.freeze([
  {
    id: 'DISCOVER',
    description: 'News discovery + dedup + article selection',
    failureClass: FailureClass.TRANSIENT,
    maxRetries: 2,
    backoffMs: 2000,
    provider: null,
  },
  {
    id: 'PREFLIGHT',
    description: 'OAuth scope + credentials validation before render/upload',
    failureClass: FailureClass.CONFIGURATION,
    maxRetries: 1,
    backoffMs: 0,
    provider: 'youtube',
  },
  {
    id: 'RENDER',
    description: 'Video rendering via NewsBroadcastEngine',
    failureClass: FailureClass.INVALID_ARTIFACT,
    maxRetries: 2,
    backoffMs: 0,
    provider: null,
  },
  {
    id: 'THUMBNAIL',
    description: 'Autonomous thumbnail factory production',
    failureClass: FailureClass.INVALID_ARTIFACT,
    maxRetries: 2,
    backoffMs: 0,
    provider: null,
  },
  {
    id: 'C2PA',
    description: 'C2PA content credential signing + verification',
    failureClass: FailureClass.TRANSIENT,
    maxRetries: 2,
    backoffMs: 1000,
    provider: null,
  },
  {
    id: 'UNIQUENESS',
    description: 'Content uniqueness validation — blocks PUBLISH if any asset is duplicate',
    failureClass: FailureClass.INVALID_ARTIFACT,
    maxRetries: 2,
    backoffMs: 0,
    provider: null,
  },
  {
    id: 'UPLOAD',
    description: 'Staging video + thumbnail for publish (no external API call)',
    failureClass: FailureClass.RATE_LIMITED,
    maxRetries: 3,
    backoffMs: 5000,
    provider: null,
  },
  {
    id: 'PUBLISH',
    description: 'Publication committed — artifact ready for distribution',
    failureClass: FailureClass.TRANSIENT,
    maxRetries: 2,
    backoffMs: 3000,
    provider: 'youtube',
  },
  {
    id: 'DISTRIBUTE',
    description: 'Parallel fan-out to YouTube, GitHub Pages, LinkedIn',
    failureClass: FailureClass.TRANSIENT,
    maxRetries: 3,
    backoffMs: 5000,
    provider: null,
  },
  {
    id: 'VERIFY',
    description: 'YouTube thumbnail + video state verification (read-only)',
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
    provider: null,
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
  if (msg.includes('requires_') || msg.includes('dependency') || msg.includes('upstream') || msg.includes('required by')) {
    return FailureClass.DEPENDENCY
  }
  if (msg.includes('missing env') || msg.includes('not configured') || msg.includes('configuration') || msg.includes('config')) {
    return FailureClass.CONFIGURATION
  }

  return stage.failureClass || FailureClass.TRANSIENT
}
