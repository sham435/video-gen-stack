import fs from 'fs'
import path from 'path'
import { getDb, initSchema } from '../../packages/database/news-engine.mjs'

const LEGACY_SESSIONS_FILE = 'output/video-sessions.json'

const VALID_TRANSITIONS = {
  GENERATED: ['READY_FOR_REVIEW'],
  READY_FOR_REVIEW: ['EDITING_SESSION_ACTIVE', 'APPROVED_FOR_PUBLISH'],
  EDITING_SESSION_ACTIVE: ['APPROVED_FOR_PUBLISH', 'READY_FOR_REVIEW'],
  APPROVED_FOR_PUBLISH: ['PUBLISHED', 'READY_FOR_REVIEW'],
  PUBLISHED: ['LEARNING_COMPLETE'],
  LEARNING_COMPLETE: [],
}

let _db = null

function sessionDb() {
  if (!_db) {
    _db = getDb()
    initSchema(_db)
    migrateLegacy(_db)
  }
  return _db
}

function migrateLegacy(db) {
  const count = db.prepare('SELECT COUNT(*) AS n FROM sessions').get().n
  if (count > 0) return
  let legacy = []
  try { legacy = JSON.parse(fs.readFileSync(LEGACY_SESSIONS_FILE, 'utf-8')) } catch {}
  if (!Array.isArray(legacy) || legacy.length === 0) return
  const insert = db.prepare(
    'INSERT INTO sessions (id, title, category, status, article, source, scores, publish_url, editing_window, published_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
  )
  const insertHistory = db.prepare('INSERT INTO session_history (session_id, action, timestamp) VALUES (?, ?, ?)')
  const tx = db.transaction(() => {
    for (const s of legacy) {
      insert.run(
        s.id,
        s.title || 'Untitled',
        s.category || 'technology',
        s.status || 'GENERATED',
        s.article ? JSON.stringify(s.article) : null,
        s.source || null,
        s.scores ? JSON.stringify(s.scores) : null,
        s.publishUrl || null,
        s.editingWindow ? JSON.stringify(s.editingWindow) : null,
        s.publishedAt || null,
        s.createdAt || new Date().toISOString()
      )
      for (const h of s.history || []) insertHistory.run(s.id, h.action, h.timestamp || new Date().toISOString())
    }
  })
  tx()
  console.log(`[SessionManager] migrated ${legacy.length} sessions from ${LEGACY_SESSIONS_FILE}`)
}

function rowToSession(row) {
  if (!row) return null
  const history = _db.prepare('SELECT action, timestamp FROM session_history WHERE session_id = ? ORDER BY id DESC').all(row.id)
  return {
    id: row.id,
    title: row.title,
    category: row.category,
    status: row.status,
    article: row.article ? JSON.parse(row.article) : undefined,
    source: row.source,
    scores: row.scores ? JSON.parse(row.scores) : null,
    publishUrl: row.publish_url,
    editingWindow: row.editing_window ? JSON.parse(row.editing_window) : null,
    publishedAt: row.published_at,
    createdAt: row.created_at,
    history,
  }
}

export class SessionManager {
  constructor(db = null) {
    if (db) _db = db
    sessionDb()
  }

  create(title, category) {
    const db = sessionDb()
    const id = `nm_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`
    const tx = db.transaction(() => {
      db.prepare('INSERT INTO sessions (id, title, category) VALUES (?, ?, ?)').run(id, title || 'Untitled', category || 'technology')
      db.prepare('INSERT INTO session_history (session_id, action) VALUES (?, ?)').run(id, 'GENERATED')
    })
    tx()
    return rowToSession(db.prepare('SELECT * FROM sessions WHERE id = ?').get(id))
  }

  transition(id, newStatus) {
    const db = sessionDb()
    const row = db.prepare('SELECT * FROM sessions WHERE id = ?').get(id)
    if (!row) throw new Error(`Session ${id} not found`)
    const allowed = VALID_TRANSITIONS[row.status] || []
    if (!allowed.includes(newStatus)) {
      throw new Error(`Cannot transition from ${row.status} to ${newStatus}`)
    }
    const tx = db.transaction(() => {
      db.prepare('UPDATE sessions SET status = ?, updated_at = datetime(\'now\') WHERE id = ?').run(newStatus, id)
      db.prepare('INSERT INTO session_history (session_id, action) VALUES (?, ?)').run(id, newStatus)
      if (newStatus === 'READY_FOR_REVIEW') {
        const window = JSON.stringify({
          startedAt: new Date().toISOString(),
          expiresAt: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
        })
        db.prepare('UPDATE sessions SET editing_window = ? WHERE id = ?').run(window, id)
      }
      if (newStatus === 'PUBLISHED') {
        db.prepare("UPDATE sessions SET published_at = datetime('now') WHERE id = ?").run(id)
      }
    })
    tx()
    return rowToSession(db.prepare('SELECT * FROM sessions WHERE id = ?').get(id))
  }

  get(id) { return rowToSession(sessionDb().prepare('SELECT * FROM sessions WHERE id = ?').get(id)) }

  list(status) {
    const db = sessionDb()
    if (status) {
      return db.prepare('SELECT * FROM sessions WHERE status = ? ORDER BY created_at DESC').all(status).map(rowToSession)
    }
    return db.prepare('SELECT * FROM sessions ORDER BY created_at DESC').all().map(rowToSession)
  }

  queue() {
    const db = sessionDb()
    const rows = db.prepare('SELECT status, COUNT(*) AS n FROM sessions GROUP BY status').all()
    const counts = Object.fromEntries(rows.map(r => [r.status, r.n]))
    return {
      generated: counts.GENERATED || 0,
      readyForReview: counts.READY_FOR_REVIEW || 0,
      editing: counts.EDITING_SESSION_ACTIVE || 0,
      approved: counts.APPROVED_FOR_PUBLISH || 0,
      published: counts.PUBLISHED || 0,
    }
  }

  updateScore(id, scores) {
    sessionDb().prepare('UPDATE sessions SET scores = ?, updated_at = datetime(\'now\') WHERE id = ?').run(JSON.stringify(scores), id)
  }

  setPublishUrl(id, url) {
    sessionDb().prepare('UPDATE sessions SET publish_url = ?, updated_at = datetime(\'now\') WHERE id = ?').run(url, id)
  }

  expireWindows() {
    const db = sessionDb()
    const rows = db.prepare("SELECT id FROM sessions WHERE status = 'EDITING_SESSION_ACTIVE' AND editing_window IS NOT NULL").all()
    const now = Date.now()
    for (const r of rows) {
      const row = db.prepare('SELECT editing_window FROM sessions WHERE id = ?').get(r.id)
      let window = {}
      try { window = JSON.parse(row.editing_window) } catch {}
      const expires = new Date(window.expiresAt || 0).getTime()
      if (now > expires) {
        const tx = db.transaction(() => {
          db.prepare("UPDATE sessions SET status = 'APPROVED_FOR_PUBLISH', updated_at = datetime('now') WHERE id = ?").run(r.id)
          db.prepare("INSERT INTO session_history (session_id, action) VALUES (?, 'AUTO_APPROVED_TIMEOUT')").run(r.id)
        })
        tx()
      }
    }
  }
}
