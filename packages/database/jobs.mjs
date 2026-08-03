import { getDb, initSchema } from './news-engine.mjs'

const BACKOFF_BASE_MS = 5000
const MAX_BACKOFF_MS = 300000

let _db = null

export function jobDb() {
  if (!_db) {
    _db = getDb()
    initSchema(_db)
  }
  return _db
}

export function getJob(db, id) {
  const row = db.prepare('SELECT * FROM jobs WHERE id = ?').get(id)
  return row ? decodeJob(row) : null
}

function decodeJob(row) {
  return { ...row, payload: JSON.parse(row.payload || '{}'), result: row.result ? JSON.parse(row.result) : null }
}

export function enqueue(db, { type, payload = {}, maxAttempts = 3, contentHash = null }) {
  if (contentHash) {
    const existing = db.prepare('SELECT * FROM jobs WHERE content_hash = ?').get(contentHash)
    if (existing) return decodeJob(existing)
  }
  const id = `job_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
  try {
    db.prepare(
      'INSERT INTO jobs (id, type, payload, max_attempts, content_hash) VALUES (?, ?, ?, ?, ?)'
    ).run(id, type, JSON.stringify(payload), maxAttempts, contentHash)
  } catch (e) {
    if (contentHash && /UNIQUE/.test(e.message)) {
      const existing = db.prepare('SELECT * FROM jobs WHERE content_hash = ?').get(contentHash)
      if (existing) return decodeJob(existing)
    }
    throw e
  }
  return getJob(db, id)
}

// Atomic claim: one statement, safe under concurrent workers (BEGIN IMMEDIATE implied).
export function claim(db) {
  const row = db.prepare(`
    UPDATE jobs
    SET status = 'running', attempts = attempts + 1, started_at = datetime('now'), error = NULL
    WHERE id = (
      SELECT id FROM jobs
      WHERE status = 'queued'
        AND (next_retry_at IS NULL OR next_retry_at <= datetime('now'))
      ORDER BY created_at, id LIMIT 1
    )
    RETURNING *
  `).get()
  return row ? decodeJob(row) : null
}

export function complete(db, id, { resultPath = null, result = null, durationMs = null } = {}) {
  db.prepare(
    "UPDATE jobs SET status = 'done', result_path = ?, result = ?, duration_ms = ?, finished_at = datetime('now') WHERE id = ?"
  ).run(resultPath, result ? JSON.stringify(result) : null, durationMs, id)
  return getJob(db, id)
}

export function fail(db, id, error) {
  const job = getJob(db, id)
  if (!job) return null
  const message = String(error || 'error').slice(0, 2000)
  if (job.attempts >= job.max_attempts) {
    db.prepare("UPDATE jobs SET status = 'failed', error = ?, finished_at = datetime('now') WHERE id = ?")
      .run(message, id)
  } else {
    const backoff = Math.min(BACKOFF_BASE_MS * Math.pow(2, job.attempts - 1), MAX_BACKOFF_MS)
    db.prepare(
      "UPDATE jobs SET status = 'queued', error = ?, next_retry_at = datetime('now', '+' || ? || ' seconds') WHERE id = ?"
    ).run(message, Math.round(backoff / 1000), id)
  }
  return getJob(db, id)
}

export function cancel(db, id) {
  db.prepare("UPDATE jobs SET status = 'cancelled', finished_at = datetime('now') WHERE id = ? AND status IN ('queued','running')").run(id)
  return getJob(db, id)
}

// Crash recovery: jobs stuck in 'running' past the timeout go back to the queue.
export function requeueStale(db, runningTimeoutMs = 15 * 60 * 1000) {
  const seconds = Math.round(runningTimeoutMs / 1000)
  const res = db.prepare(
    "UPDATE jobs SET status = 'queued', error = 'worker crashed (stale requeue)' WHERE status = 'running' AND started_at <= datetime('now', '-' || ? || ' seconds')"
  ).run(seconds)
  return res.changes
}

export function listJobs(db, { status = null, type = null, limit = 50 } = {}) {
  const clauses = []
  const params = []
  if (status) { clauses.push('status = ?'); params.push(status) }
  if (type) { clauses.push('type = ?'); params.push(type) }
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : ''
  params.push(limit)
  return db.prepare(`SELECT * FROM jobs ${where} ORDER BY created_at DESC LIMIT ?`).all(...params).map(decodeJob)
}
