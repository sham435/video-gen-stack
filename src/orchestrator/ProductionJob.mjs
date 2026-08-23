import fs from 'fs'
import { STAGES, StageStatus, FailureClass, classifyError, getStage, stageIndex } from './Stages.mjs'
import { classifyDecision } from './RetryPolicy.mjs'
import { CheckpointStore } from './CheckpointStore.mjs'
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
    this.governor = options.governor || null
    this.stageHandlers = {}
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
    const startIdx = resumeFrom ? stageIndex(resumeFrom.id) : 0

    for (let i = startIdx; i < STAGES.length; i++) {
      const stage = STAGES[i]

      // Skip stages already completed in a previous run
      if (this.store.isStageCompleted(stage.id)) {
        const existing = this.store.getStageResult(stage.id)
        this.results[stage.id] = existing?.result || {}
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
      // No handler = pass-through. Do NOT write to checkpoint so resume
      // treats it as not-yet-run and re-executes on next attempt.
      return true
    }

    // ── Governor gate: check quota BEFORE attempting the stage ──
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
        return { waiting: true, nextEligibleAt: quota.nextEligibleAt, reason: quota.reason }
      }
      // Reserve slot before execution
      this.governor.reserve(stage.provider)
    }

    // ── Crash recovery: check if this external operation was already completed ──
    if (this.governor && stage.provider) {
      const operationType = `${stage.provider}.${stage.id.toLowerCase()}`
      const prior = this.governor.wasCompleted(this.jobId, operationType)
      if (prior) {
        console.log(`[JOB] ${stage.id}: RECOVERY — operation already completed remotely (remote_id=${prior.remote_id})`)
        this.results[stage.id] = { remote_id: prior.remote_id, remote_state: prior.remote_state, recovered: true }
        this.store.markStageCompleted(stage.id, this.results[stage.id])
        return true
      }
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
        console.log(`[JOB] ${stage.id}: COMPLETED (attempt ${attempt + 1})`)
        return true

      } catch (error) {
        lastError = error
        const failureClass = classifyError(error, stage)

        this.store.updateStage(stage.id, {
          status: StageStatus.RETRYING,
          error: String(error?.message || error),
          attempts: attempt + 1,
          failureClass,
        })

        if (failureClass === FailureClass.PERMANENT) {
          this.quarantineReason = `${stage.id} quarantined: permanent failure (last error: ${error.message})`
          this.store.markStageQuarantined(stage.id, this.quarantineReason)
          console.error(`[JOB] ${stage.id}: QUARANTINED — ${this.quarantineReason}`)
          // Release governor slot on permanent failure
          if (this.governor && stage.provider) this.governor.release(stage.provider)
          return false
        }

        if (retries >= maxRetries) break

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
    // Release governor slot on exhaustion
    if (this.governor && stage.provider) this.governor.release(stage.provider)
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
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}
