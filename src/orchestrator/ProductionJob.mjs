import fs from 'fs'
import { STAGES, StageStatus, FailureClass, classifyError, getStage, stageIndex } from './Stages.mjs'
import { classifyDecision } from './RetryPolicy.mjs'
import { CheckpointStore } from './CheckpointStore.mjs'
import { StageTraceRecorder } from './StageTraceRecorder.mjs'
import { buildJobId } from './ArtifactID.mjs'

/**
 * ProductionJob is the central state machine for a single production run.
 *
 * Lifecycle:  DISCOVER → RENDER → THUMBNAIL → C2PA → UPLOAD → PUBLISH → VERIFY → ANALYTICS
 *
 * Guarantees:
 *  - Idempotent: same article → same jobId → no duplicate stage runs
 *  - Crash-resumable: reads last checkpoint, resumes from next incomplete stage
 *  - Autonomous: retry / regenerate / quarantine decisions are automatic
 *  - Checkpointed: state persists to disk after every stage transition
 *  - Quota-aware: checks ResourceGovernor before external provider calls
 *  - Operation-journaled: external side effects are logged for crash recovery
 */

export class ProductionJob {
  constructor(article, options = {}) {
    this.article = article
    this.jobId = options.jobId || buildJobId(article)
    this.outDir = options.outDir || 'output'
    this.checkpointDir = options.checkpointDir || '.newsmonster/checkpoints'
    this.store = new CheckpointStore(this.jobId, this.checkpointDir)
    this.trace = new StageTraceRecorder(this.jobId, this.store, { outDir: this.outDir })
    this.governor = options.governor || null
    this.stageHandlers = {}
    this.preconditions = {}
    this.results = {}
    this.startedAt = null
    this.completedAt = null
    this.status = StageStatus.PENDING
    this.quarantineReason = null

    // Load existing checkpoint if resuming
    const existing = this.store.load()
    if (existing) {
      this.results = this._restoreResults(existing)
      this.status = existing.status || StageStatus.PENDING
    }
  }

  onStage(stageId, handler) {
    this.stageHandlers[stageId] = handler
    return this
  }

  /**
   * Register a precondition that must hold before a stage's handler is invoked.
   *
   * The job enforces the contract but knows nothing about what is being
   * checked — the validator supplies the policy. This is how the publish gate
   * blocks PUBLISH without business policy leaking into the lifecycle.
   *
   * validator(ctx) → { valid: boolean, missing?: string[], checks?: object }
   */
  onPrecondition(stageId, validator) {
    this.preconditions[stageId] = validator
    return this
  }

  async run(startFrom) {
    this.startedAt = this.startedAt || new Date().toISOString()
    const existing = this.store.load() || {}
    this.store.save({
      ...existing,
      jobId: this.jobId,
      articleTitle: this.article.title?.slice(0, 80),
      status: StageStatus.RUNNING,
      startedAt: this.startedAt,
    })

    const resumeFrom = startFrom || this.store.resumeFrom()
    const rawIdx = resumeFrom ? stageIndex(resumeFrom.id) : 0
    const startIdx = Number.isFinite(rawIdx) && rawIdx >= 0 ? rawIdx : 0

    for (let i = startIdx; i < STAGES.length; i++) {
      const stage = STAGES[i]

      // Skip stages already completed in a previous run
      if (this.store.isStageCompleted(stage.id)) {
        const existing = this.store.getStageResult(stage.id)
        this.results[stage.id] = existing?.result || {}
        this.trace.skipped(stage.id, 'completed in previous run')
        console.log(`[JOB] ${stage.id}: SKIPPED (completed in previous run)`)
        continue
      }

      const stageResult = await this._executeStage(stage)

      // WAITING_FOR_QUOTA: stop pipeline, log nextEligibleAt
      if (stageResult && stageResult.waiting) {
        this.status = StageStatus.WAITING_FOR_QUOTA
        this.completedAt = new Date().toISOString()
        const finalState = this.store.load() || {}
        this.store.save({
          ...finalState,
          jobId: this.jobId,
          status: StageStatus.WAITING_FOR_QUOTA,
          nextEligibleAt: stageResult.nextEligibleAt,
          waitingReason: stageResult.reason,
          startedAt: this.startedAt,
          completedAt: this.completedAt,
        })
        return { success: false, waiting: true, nextEligibleAt: stageResult.nextEligibleAt, reason: stageResult.reason, lastStage: stage.id }
      }

      if (!stageResult) {
        this.status = StageStatus.QUARANTINED
        this.completedAt = new Date().toISOString()
        const finalState = this.store.load() || {}
        this.store.save({
          ...finalState,
          jobId: this.jobId,
          status: StageStatus.QUARANTINED,
          quarantineReason: this.quarantineReason,
          startedAt: this.startedAt,
          completedAt: this.completedAt,
        })
        return { success: false, quarantineReason: this.quarantineReason, lastStage: stage.id }
      }
    }

    this.status = StageStatus.COMPLETED
    this.completedAt = new Date().toISOString()
    const finalState = this.store.load() || {}
    this.store.save({
      ...finalState,
      jobId: this.jobId,
      status: StageStatus.COMPLETED,
      startedAt: this.startedAt,
      completedAt: this.completedAt,
    })
    return { success: true, results: this.results }
  }

  async _executeStage(stage) {
    const handler = this.stageHandlers[stage.id]
    if (!handler) {
      this.trace.skipped(stage.id, 'no handler registered')
      return true
    }

    // ── Precondition gate ──
    // Runs before the handler exists in the picture at all: a stage whose
    // precondition is false never executes, and the trace names the exact
    // predicates that failed rather than an opaque error string.
    const precondition = this.preconditions[stage.id]
    if (precondition) {
      const verdict = await precondition({
        jobId: this.jobId,
        article: this.article,
        outDir: this.outDir,
        results: this.results,
        stage,
      })
      if (verdict && verdict.valid === false) {
        const failed = verdict.missing || []
        this.quarantineReason = `${stage.id} blocked: precondition failed (${failed.join(', ') || 'unspecified'})`
        this.store.markStageQuarantined(stage.id, this.quarantineReason)
        this.trace.blocked(stage.id, {
          errorClassification: FailureClass.DEPENDENCY,
          failedPredicates: failed,
          checks: verdict.checks || null,
          reason: this.quarantineReason,
        })
        console.error(`[JOB] ${stage.id}: BLOCKED — precondition failed: ${failed.join(', ')}`)
        this._releaseUniquenessReservation()
        return false
      }
    }

    // ── Crash recovery ──
    // Check journal for prior completion regardless of provider — this
    // ensures UPLOAD recovery works even though UPLOAD has no provider
    // (it stages files, doesn't call external APIs).
    if (this.governor) {
      const operationType = stage.provider
        ? `${stage.provider}.${stage.id.toLowerCase()}`
        : `${stage.id.toLowerCase()}`
      const prior = this.governor.wasCompleted(this.jobId, operationType)
      if (prior) {
        console.log(`[JOB] ${stage.id}: RECOVERY — operation already completed remotely (remote_id=${prior.remote_id})`)
        this.results[stage.id] = { remote_id: prior.remote_id, remote_state: prior.remote_state, recovered: true }
        this.store.markStageCompleted(stage.id, this.results[stage.id])
        this.trace.succeeded(stage.id, 0, new Date().toISOString(), 0, this.results[stage.id], {
          recovered: true,
          remoteId: prior.remote_id,
        })
        return true
      }
    }

    // ── Governor gate ──
    if (this.governor && stage.provider) {
      const quota = this.governor.canExecute(stage.provider, this.jobId)
      if (!quota.allowed) {
        this.store.updateStage(stage.id, {
          status: StageStatus.WAITING_FOR_QUOTA,
          reason: quota.reason,
          nextEligibleAt: quota.nextEligibleAt,
          provider: stage.provider,
          budget: quota.budget,
        })
        console.log(`[JOB] ${stage.id}: WAITING_FOR_QUOTA — ${quota.reason} (next eligible: ${quota.nextEligibleAt})`)
        this.trace.skipped(stage.id, quota.reason, {
          errorClassification: FailureClass.RATE_LIMITED,
          metadata: { waiting: true, nextEligibleAt: quota.nextEligibleAt, provider: stage.provider },
        })
        return { waiting: true, nextEligibleAt: quota.nextEligibleAt, reason: quota.reason }
      }
      this.governor.reserve(stage.provider)
    }

    let retries = 0
    const maxRetries = stage.maxRetries ?? 2
    let lastError = null

    this.store.updateStage(stage.id, {
      status: StageStatus.RUNNING,
      startedAt: new Date().toISOString(),
    })

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      if (attempt > 0) retries++

      const attemptStart = Date.now()
      const attemptStartedAt = new Date(attemptStart).toISOString()
      this.trace.running(stage.id, attempt, attemptStartedAt, { maxRetries })

      try {
        const ctx = {
          jobId: this.jobId,
          article: this.article,
          outDir: this.outDir,
          results: this.results,
          attempts: attempt,
          stage,
          governor: this.governor,
        }

        const result = await handler(ctx)
        this.results[stage.id] = result || {}
        this.store.markStageCompleted(stage.id, result)
        this.trace.succeeded(stage.id, attempt, attemptStartedAt, Date.now() - attemptStart, result)
        console.log(`[JOB] ${stage.id}: COMPLETED (attempt ${attempt + 1})`)
        return true

      } catch (error) {
        lastError = error
        const failureClass = classifyError(error, stage)
        const durationMs = Date.now() - attemptStart

        this.store.updateStage(stage.id, {
          status: StageStatus.RETRYING,
          error: String(error?.message || error),
          attempts: attempt + 1,
          failureClass,
        })

        if (failureClass === FailureClass.PERMANENT || failureClass === FailureClass.CONFIGURATION) {
          this.quarantineReason = `${stage.id} quarantined: ${failureClass.toLowerCase()} failure (last error: ${error.message})`
          this.store.markStageQuarantined(stage.id, this.quarantineReason)
          this.trace.quarantined(stage.id, attempt, attemptStartedAt, durationMs, failureClass, { error: error.message })
          console.error(`[JOB] ${stage.id}: QUARANTINED — ${this.quarantineReason}`)
          if (this.governor && stage.provider) this.governor.release(stage.provider)
          this._releaseUniquenessReservation()
          return false
        }

        // Retries exhausted: this attempt's terminal state IS quarantine.
        // Emitting FAILED here as well would give the attempt two terminal
        // records and break the one-terminal-per-attempt invariant.
        if (retries >= maxRetries) {
          this.quarantineReason = `${stage.id} quarantined: exhausted ${maxRetries} retries (last error: ${lastError?.message})`
          this.store.markStageQuarantined(stage.id, this.quarantineReason)
          this.trace.quarantined(stage.id, attempt, attemptStartedAt, durationMs, failureClass, {
            error: error.message,
            exhaustedRetries: true,
          })
          console.error(`[JOB] ${stage.id}: QUARANTINED — ${this.quarantineReason}`)
          if (this.governor && stage.provider) this.governor.release(stage.provider)
          this._releaseUniquenessReservation()
          return false
        }

        this.trace.failed(stage.id, attempt, attemptStartedAt, durationMs, failureClass, { error: error.message })

        const decision = classifyDecision(failureClass, retries, maxRetries)
        if (decision.delayMs > 0) {
          console.log(`[JOB] ${stage.id}: retry in ${decision.delayMs}ms (${decision.reason})`)
          await sleep(decision.delayMs)
        } else {
          console.log(`[JOB] ${stage.id}: ${decision.action} (${decision.reason}) — ${error.message}`)
        }
      }
    }

    this.quarantineReason = `${stage.id} quarantined: exhausted ${maxRetries} retries (last error: ${lastError?.message})`
    this.store.markStageQuarantined(stage.id, this.quarantineReason)
    console.error(`[JOB] ${stage.id}: QUARANTINED — ${this.quarantineReason}`)
    if (this.governor && stage.provider) this.governor.release(stage.provider)
    this._releaseUniquenessReservation()
    return false
  }

  _restoreResults(saved) {
    const results = {}
    if (!saved.stages) return results
    for (const [id, stage] of Object.entries(saved.stages)) {
      if (stage.status === StageStatus.COMPLETED && stage.result) {
        results[id] = stage.result
      }
    }
    return results
  }

  getStageStatus(stageId) {
    return this.store.getStageResult(stageId)
  }

  isComplete() {
    return STAGES.every(s => this.store.isStageCompleted(s.id))
  }

  cleanup() {
    this.store.cleanup()
  }

  /**
   * Release uniqueness reservation if UNIQUENESS stage completed with reserved: true.
   * Called when a subsequent stage (UPLOAD/PUBLISH/VERIFY) quarantines.
   * Reads/writes the asset-registry.json directly to avoid coupling to UniquenessPreflight.
   */
  _releaseUniquenessReservation() {
    const unqResult = this.results?.UNIQUENESS
    if (!unqResult?.reserved) return
    try {
      const registryPath = this.outDir ? `${this.outDir}/.asset-registry.json` : null
      if (!registryPath || !fs.existsSync(registryPath)) return
      const state = JSON.parse(fs.readFileSync(registryPath, 'utf-8'))
      if (state.reservations?.[this.jobId]) {
        delete state.reservations[this.jobId]
        fs.writeFileSync(registryPath, JSON.stringify(state, null, 2))
        console.log(`[JOB] UNIQUENESS reservation released for job ${this.jobId}`)
      }
    } catch (e) {
      console.log(`[JOB] Failed to release uniqueness reservation: ${e.message}`)
    }
  }
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}
