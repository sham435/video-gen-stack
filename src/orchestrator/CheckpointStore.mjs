import fs from 'fs'
import path from 'path'
import { StageStatus, STAGES, stageIndex } from './Stages.mjs'

/**
 * CheckpointStore persists stage state to disk after every stage transition.
 * On resume it restores the last checkpoint so the orchestrator can continue
 * from where it left off. All reads/writes are atomic (write-to-temp + rename).
 */

const DEFAULT_DIR = '.newsmonster/checkpoints'

export class CheckpointStore {
  constructor(jobId, baseDir) {
    this.jobId = jobId
    this.baseDir = baseDir || DEFAULT_DIR
    this.filePath = path.join(this.baseDir, `${jobId}.json`)
  }

  exists() {
    return fs.existsSync(this.filePath)
  }

  load() {
    if (!this.exists()) return null
    try {
      const raw = fs.readFileSync(this.filePath, 'utf-8')
      return JSON.parse(raw)
    } catch {
      return null
    }
  }

  save(state) {
    fs.mkdirSync(this.baseDir, { recursive: true })
    const tmpPath = `${this.filePath}.tmp`
    const payload = {
      jobId: this.jobId,
      ...state,
      savedAt: new Date().toISOString(),
    }
    fs.writeFileSync(tmpPath, JSON.stringify(payload, null, 2))
    fs.renameSync(tmpPath, this.filePath)
  }

  updateStage(stageId, patch) {
    const state = this.load() || { stages: {} }
    if (!state.stages) state.stages = {}
    state.stages[stageId] = { ...(state.stages[stageId] || {}), ...patch }
    this.save(state)
    return state.stages[stageId]
  }

  markStageCompleted(stageId, result = {}) {
    return this.updateStage(stageId, {
      status: StageStatus.COMPLETED,
      completedAt: new Date().toISOString(),
      result,
    })
  }

  markStageFailed(stageId, error, attempts) {
    return this.updateStage(stageId, {
      status: StageStatus.FAILED,
      failedAt: new Date().toISOString(),
      error: String(error?.message || error),
      attempts,
    })
  }

  markStageQuarantined(stageId, reason) {
    return this.updateStage(stageId, {
      status: StageStatus.QUARANTINED,
      quarantinedAt: new Date().toISOString(),
      quarantineReason: reason,
    })
  }

  appendTrace(record) {
    const state = this.load() || { stages: {} }
    if (!state.stageTrace) state.stageTrace = []
    state.stageTrace.push(record)
    this.save(state)
    return record
  }

  getTrace() {
    const state = this.load()
    return state?.stageTrace || []
  }

  getStageTrace(stageId) {
    return this.getTrace().filter(r => r.stage === stageId)
  }

  getArtifacts() {
    const state = this.load()
    return state?.artifacts || {}
  }

  setArtifacts(artifacts) {
    const state = this.load() || { stages: {} }
    state.artifacts = { ...(state.artifacts || {}), ...artifacts }
    this.save(state)
  }

  getStageResult(stageId) {
    const state = this.load()
    return state?.stages?.[stageId] || null
  }

  getLastCompletedStage() {
    const state = this.load()
    if (!state?.stages) return null
    let best = null
    let bestIdx = -1
    for (const [id, stage] of Object.entries(state.stages)) {
      if (stage.status === StageStatus.COMPLETED) {
        const idx = stageIndex(id)
        if (idx > bestIdx) { bestIdx = idx; best = { id, ...stage } }
      }
    }
    return best
  }

  resumeFrom() {
    const state = this.load()
    if (!state?.stages) return null
    let lastCompletedIdx = -1
    for (const [id, stage] of Object.entries(state.stages)) {
      if (stage.status === StageStatus.COMPLETED) {
        const idx = stageIndex(id)
        if (idx > lastCompletedIdx) lastCompletedIdx = idx
      }
    }
    if (lastCompletedIdx < 0) return null
    return STAGES[lastCompletedIdx + 1] || null
  }

  isStageCompleted(stageId) {
    const s = this.getStageResult(stageId)
    return s?.status === StageStatus.COMPLETED
  }

  cleanup() {
    try {
      if (this.exists()) fs.unlinkSync(this.filePath)
    } catch { /* best effort */ }
  }
}
