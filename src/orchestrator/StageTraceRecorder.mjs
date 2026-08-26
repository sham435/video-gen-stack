import { StageStatus } from './Stages.mjs'

/**
 * StageTraceRecorder — owns the shape and persistence of stage telemetry.
 *
 * Boundary:
 *   ProductionJob  → stage lifecycle, retries, quarantine decisions
 *   StageTraceRecorder → what a trace record contains and where it lands
 *
 * It is deliberately stateless about attempts: the caller supplies `startedAt`
 * and `attempt` because ProductionJob owns the lifecycle. The recorder never
 * decides whether a stage runs, retries, or quarantines — it only describes
 * what happened. It writes through the existing CheckpointStore; there is no
 * second state store.
 */

export const TraceStatus = Object.freeze({
  PENDING: 'PENDING',
  RUNNING: 'RUNNING',
  SUCCEEDED: 'SUCCEEDED',
  FAILED: 'FAILED',
  SKIPPED: 'SKIPPED',
  QUARANTINED: 'QUARANTINED',
})

const TERMINAL = Object.freeze(new Set([
  TraceStatus.SUCCEEDED,
  TraceStatus.FAILED,
  TraceStatus.SKIPPED,
  TraceStatus.QUARANTINED,
]))

export function isTerminalTraceStatus(status) {
  return TERMINAL.has(status)
}

export class StageTraceRecorder {
  constructor(jobId, store, options = {}) {
    this.jobId = jobId
    this.store = store
    this.outDir = options.outDir || null
  }

  /**
   * Append one record. `startedAt` must be the real start of the attempt —
   * stamping "now" on a terminal record collapses startedAt/completedAt and
   * the trace stops being an auditable timeline.
   */
  record({ stage, attempt, status, startedAt, durationMs = null, artifactIds = [], errorClassification = null, metadata = {} }, artifacts = null) {
    const started = startedAt || new Date().toISOString()
    const record = {
      jobId: this.jobId,
      stage,
      attempt,
      startedAt: started,
      completedAt: isTerminalTraceStatus(status)
        ? new Date(new Date(started).getTime() + (durationMs || 0)).toISOString()
        : undefined,
      status,
      durationMs,
      artifactIds,
      errorClassification,
      metadata,
    }
    this.store.appendTrace(record, artifacts)
    return record
  }

  running(stage, attempt, startedAt, metadata = {}) {
    return this.record({ stage, attempt, status: TraceStatus.RUNNING, startedAt, metadata })
  }

  /** Terminal success. Extracts artifact ids from the result and indexes them. */
  succeeded(stage, attempt, startedAt, durationMs, result, metadata = {}) {
    const artifactIds = this.artifactIdsFor(stage, result)
    return this.record(
      { stage, attempt, status: TraceStatus.SUCCEEDED, startedAt, durationMs, artifactIds, metadata },
      this.artifactIndexEntry(stage, artifactIds)
    )
  }

  failed(stage, attempt, startedAt, durationMs, errorClassification, metadata = {}) {
    return this.record({ stage, attempt, status: TraceStatus.FAILED, startedAt, durationMs, errorClassification, metadata })
  }

  quarantined(stage, attempt, startedAt, durationMs, errorClassification, metadata = {}) {
    return this.record({ stage, attempt, status: TraceStatus.QUARANTINED, startedAt, durationMs, errorClassification, metadata })
  }

  /** A stage that never ran: no handler, already complete, or quota-blocked. */
  skipped(stage, reason, { attempt = 0, errorClassification = null, metadata = {} } = {}) {
    return this.record({
      stage,
      attempt,
      status: TraceStatus.SKIPPED,
      startedAt: new Date().toISOString(),
      durationMs: 0,
      errorClassification,
      metadata: { reason, ...metadata },
    })
  }

  /**
   * A stage blocked by a failed precondition. The handler was never invoked,
   * so `handlerInvoked: false` marks this as a stage that did not execute —
   * and the exact failed predicates are recorded, not just an error string.
   */
  blocked(stage, { attempt = 0, errorClassification = null, failedPredicates = [], checks = null, reason = null } = {}) {
    return this.record({
      stage,
      attempt,
      status: TraceStatus.QUARANTINED,
      startedAt: new Date().toISOString(),
      durationMs: 0,
      errorClassification,
      metadata: {
        handlerInvoked: false,
        precondition: 'failed',
        failedPredicates,
        ...(reason ? { reason } : {}),
        ...(checks ? { checks } : {}),
      },
    })
  }

  /**
   * Map a stage result onto stable artifact identifiers.
   *
   * RENDER and THUMBNAIL are the canonical artifacts and their real result
   * shapes are engine-based ({engine}) and selection-based ({selected}), not
   * flat paths — a path-only extractor records nothing for exactly the two
   * artifacts the publish gate depends on.
   */
  artifactIdsFor(stageId, result) {
    if (!result) return []
    const ids = []

    if (stageId === 'RENDER') {
      const videoPath = result.videoPath || result.engine?.finalPath || (this.outDir ? `${this.outDir}/final.mp4` : null)
      if (videoPath) ids.push(`video:${videoPath}`)
    }
    if (stageId === 'THUMBNAIL' && result.selected?.path) {
      ids.push(`thumbnail:${result.selected.path}`)
    }

    if (result.videoPath && stageId !== 'RENDER') ids.push(`video:${result.videoPath}`)
    if (result.thumbnailPath) ids.push(`thumbnail:${result.thumbnailPath}`)
    if (result.path) ids.push(`file:${result.path}`)
    if (result.videoId) ids.push(`youtube:${result.videoId}`)
    if (result.remote_id) ids.push(`remote:${result.remote_id}`)
    if (result.manifestId) ids.push(`c2pa:${result.manifestId}`)

    return [...new Set(ids)]
  }

  /**
   * Artifact index entry for the job file: stage → the ids it produced.
   * Ids only, never the raw stage result — results carry whole engine objects
   * and would bloat every checkpoint write.
   */
  artifactIndexEntry(stageId, artifactIds) {
    if (!artifactIds || artifactIds.length === 0) return null
    return { [stageId]: { ids: artifactIds, recordedAt: new Date().toISOString() } }
  }
}

// StageStatus is the checkpoint's stage vocabulary; TraceStatus is the trace's.
// They overlap but are not the same enum — COMPLETED vs SUCCEEDED, and the
// trace has no RETRYING/WAITING_FOR_QUOTA. Kept separate on purpose.
export { StageStatus }
