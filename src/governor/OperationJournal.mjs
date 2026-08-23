import fs from 'fs'
import path from 'path'
import crypto from 'crypto'

/**
 * OperationJournal logs every externally-visible side effect.
 *
 * Each entry records:
 *   operation_id   — sha256(jobId + operation_type), deterministic
 *   provider       — which API was called
 *   operation_type — semantic name (e.g. "youtube.upload", "c2pa.sign")
 *   attempt        — which attempt this was (1-based)
 *   remote_id      — provider's returned ID (videoId, postId, etc.)
 *   remote_state   — provider's current state (live, processing, failed)
 *   request_at     — when the call was made
 *   completed_at   — when the call finished
 *   duration_ms    — round-trip time
 *   error          — error message if failed
 *   input_hash     — sha256 of the input artifact for dedup
 *
 * On crash recovery, the orchestrator checks the journal:
 *   if remote_id exists → verify remote state → return existing result
 *   if no remote_id     → safe to re-execute
 */

const DEFAULT_DIR = '.newsmonster/journal'

export class OperationJournal {
  constructor(baseDir) {
    this.baseDir = baseDir || DEFAULT_DIR
    this.filePath = path.join(this.baseDir, 'operations.jsonl')
    this._cache = null
    this._cacheMtime = 0
  }

  _loadAll() {
    try {
      const stat = fs.statSync(this.filePath)
      const mt = stat.mtimeMs
      if (this._cache && this._cacheMtime === mt) return this._cache
      this._cacheMtime = mt
    } catch { /* file may not exist */ }
    if (!fs.existsSync(this.filePath)) { this._cache = []; return this._cache }
    const lines = fs.readFileSync(this.filePath, 'utf-8').split('\n').filter(Boolean)
    this._cache = lines.map(l => { try { return JSON.parse(l) } catch { return null } }).filter(Boolean)
    return this._cache
  }

  _append(entry) {
    fs.mkdirSync(this.baseDir, { recursive: true })
    fs.appendFileSync(this.filePath, JSON.stringify(entry) + '\n')
    this._cache = null // invalidate
  }

  static operationId(jobId, operationType) {
    return `op-${crypto.createHash('sha256').update(`${jobId}:${operationType}`).digest('hex').slice(0, 16)}`
  }

  static inputHash(data) {
    return crypto.createHash('sha256').update(JSON.stringify(data || '')).digest('hex').slice(0, 16)
  }

  /**
   * Record that an operation is starting. Returns the operation_id.
   */
  start(jobId, operationType, provider, input = {}) {
    const entry = {
      operation_id: OperationJournal.operationId(jobId, operationType),
      job_id: jobId,
      provider,
      operation_type: operationType,
      input_hash: OperationJournal.inputHash(input),
      attempt: 1,
      remote_id: null,
      remote_state: null,
      request_at: new Date().toISOString(),
      completed_at: null,
      duration_ms: null,
      error: null,
    }

    // Check if there's an existing entry for this operation (resume scenario)
    const existing = this.findCompleted(jobId, operationType)
    if (existing) {
      entry.attempt = (existing.attempt || 0) + 1
    } else {
      const existingStarted = this.findStarted(jobId, operationType)
      if (existingStarted) {
        entry.attempt = (existingStarted.attempt || 0) + 1
      }
    }

    this._append(entry)
    return entry.operation_id
  }

  /**
   * Mark an operation as completed with remote state.
   */
  complete(jobId, operationType, remoteId, remoteState = 'active', durationMs = 0) {
    const entries = this._loadAll()
    // Find the last started entry for this job+operation
    let target = null
    for (let i = entries.length - 1; i >= 0; i--) {
      const e = entries[i]
      if (e.job_id === jobId && e.operation_type === operationType && !e.completed_at) {
        target = e
        break
      }
    }
    if (!target) {
      // No in-progress entry — create a completed one (defensive)
      this._append({
        operation_id: OperationJournal.operationId(jobId, operationType),
        job_id: jobId,
        provider: 'unknown',
        operation_type: operationType,
        input_hash: '',
        attempt: 1,
        remote_id: remoteId,
        remote_state: remoteState,
        request_at: new Date().toISOString(),
        completed_at: new Date().toISOString(),
        duration_ms: durationMs,
        error: null,
      })
      return
    }
    target.remote_id = remoteId
    target.remote_state = remoteState
    target.completed_at = new Date().toISOString()
    target.duration_ms = durationMs
    target.error = null
    // Rewrite the file
    this._rewrite(entries)
  }

  /**
   * Mark an operation as failed.
   */
  fail(jobId, operationType, error, durationMs = 0) {
    const entries = this._loadAll()
    let target = null
    for (let i = entries.length - 1; i >= 0; i--) {
      const e = entries[i]
      if (e.job_id === jobId && e.operation_type === operationType && !e.completed_at) {
        target = e
        break
      }
    }
    if (!target) return
    target.completed_at = new Date().toISOString()
    target.duration_ms = durationMs
    target.error = String(error?.message || error)
    this._rewrite(entries)
  }

  /**
   * Find a completed entry for this job+operation.
   */
  findCompleted(jobId, operationType) {
    const entries = this._loadAll()
    for (let i = entries.length - 1; i >= 0; i--) {
      const e = entries[i]
      if (e.job_id === jobId && e.operation_type === operationType && e.completed_at && !e.error) {
        return e
      }
    }
    return null
  }

  /**
   * Find a started (incomplete) entry for this job+operation.
   */
  findStarted(jobId, operationType) {
    const entries = this._loadAll()
    for (let i = entries.length - 1; i >= 0; i--) {
      const e = entries[i]
      if (e.job_id === jobId && e.operation_type === operationType && !e.completed_at) {
        return e
      }
    }
    return null
  }

  /**
   * Check if an operation was already completed with a remote_id.
   * Used by orchestrator to skip re-execution.
   */
  alreadyCompleted(jobId, operationType) {
    const entry = this.findCompleted(jobId, operationType)
    return entry?.remote_id ? entry : null
  }

  /**
   * Get all entries for a given job.
   */
  forJob(jobId) {
    return this._loadAll().filter(e => e.job_id === jobId)
  }

  /**
   * Get all entries for a given provider.
   */
  forProvider(provider) {
    return this._loadAll().filter(e => e.provider === provider)
  }

  /**
   * Count completed calls for a provider within a time window.
   */
  countInWindow(provider, sinceMs) {
    const since = new Date(Date.now() - sinceMs).toISOString()
    return this._loadAll().filter(e =>
      e.provider === provider &&
      e.completed_at &&
      e.completed_at >= since &&
      !e.error
    ).length
  }

  _rewrite(entries) {
    fs.mkdirSync(this.baseDir, { recursive: true })
    const tmpPath = `${this.filePath}.tmp`
    const content = entries.map(e => JSON.stringify(e)).join('\n') + '\n'
    fs.writeFileSync(tmpPath, content)
    fs.renameSync(tmpPath, this.filePath)
    this._cache = null
  }

  cleanup() {
    try {
      if (fs.existsSync(this.filePath)) fs.unlinkSync(this.filePath)
      this._cache = null
    } catch { /* best effort */ }
  }
}
