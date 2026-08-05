// AgentTaskStore — persistent conversation + task state for the dashboard AI.
//
// Fixes the stateless-chat problem: each conversation carries a task record
// (status, stage, progress, current action, partial result, accumulated tool
// evidence, bounded history) so "proceed"/"continue" resumes the same task
// instead of starting a brand-new unrelated request.
//
// Persistence: SQLite — agent_tasks / agent_events / approvals tables in the
// production newsroom DB (packages/database/news-engine.mjs v3 migration).
// Solves concurrency, crash recovery, and multi-process reads that the old
// data/agent-tasks.json could not. A one-shot migration imports existing JSON
// rows; if SQLite is unavailable the store degrades to in-memory JSON.

import fs from 'fs'
import path from 'path'
import { getDb, initSchema } from '../database/news-engine.mjs'

const DEFAULT_FILE = path.resolve(process.cwd(), 'data', 'agent-tasks.json')

const RESUME_PATTERN = /^(please\s+)?(continue|proceed|resume|go ahead|keep going|keep it going|carry on|continue on|keep going on|continue with)\b/i

function payloadOf(row) {
  if (!row) return null
  let payload = {}
  try { payload = JSON.parse(row.payload || '{}') } catch { /* ignore corrupt */ }
  const { payload: _drop, ...base } = row
  return { ...base, ...payload }
}

export class AgentTaskStore {
  // db: a getDb()-style better-sqlite3 connection (schema must be initialized).
  // file: legacy JSON path read once for migration, then unused.
  constructor({ db = null, file = DEFAULT_FILE } = {}) {
    this.file = file
    this.db = null
    this._mem = new Map() // fallback when SQLite is unavailable
    try {
      this.db = db || getDb()
      initSchema(this.db)
      this._prepared = {
        get: this.db.prepare('SELECT * FROM agent_tasks WHERE conversation_id = ?'),
        upsert: this.db.prepare(`INSERT INTO agent_tasks (conversation_id, task_id, status, stage, progress, current_action, payload, created_at, updated_at)
          VALUES (@conversation_id, @task_id, @status, @stage, @progress, @current_action, @payload, @created_at, @updated_at)
          ON CONFLICT(conversation_id) DO UPDATE SET task_id=@task_id, status=@status, stage=@stage, progress=@progress,
            current_action=@current_action, payload=@payload, updated_at=@updated_at`),
      }
      this._migrateJson()
    } catch (e) {
      console.warn('[AgentTaskStore] SQLite unavailable, falling back to in-memory JSON:', e.message)
      this.db = null
    }
  }

  _migrateJson() {
    try {
      if (!fs.existsSync(this.file)) return
      const rows = JSON.parse(fs.readFileSync(this.file, 'utf-8'))
      if (!Array.isArray(rows)) return
      let imported = 0
      const exists = this.db.prepare('SELECT 1 FROM agent_tasks WHERE conversation_id = ?')
      for (const t of rows) {
        if (!t?.conversation_id || exists.get(t.conversation_id)) continue
        this._upsert(t)
        imported++
      }
      if (imported) console.log(`[AgentTaskStore] migrated ${imported} task(s) from ${this.file}`)
    } catch (e) {
      console.warn('[AgentTaskStore] legacy JSON migration skipped:', e.message)
    }
  }

  _upsert(task) {
    const payload = JSON.stringify({
      partial_result: task.partial_result || '',
      history: task.history || [],
      tool_calls: task.tool_calls || [],
      approvals: task.approvals || [],
    })
    this._prepared.upsert.run({
      conversation_id: task.conversation_id,
      task_id: task.task_id || `task-${Date.now().toString(36)}-${String(task.conversation_id).slice(0, 6)}`,
      status: task.status || 'idle',
      stage: task.stage || 0,
      progress: task.progress || 0,
      current_action: task.current_action || '',
      payload,
      created_at: task.created_at || new Date().toISOString(),
      updated_at: task.updated_at || new Date().toISOString(),
    })
  }

  get(conversationId) {
    if (this.db) return payloadOf(this._prepared.get.get(conversationId)) || null
    return this._mem.get(conversationId) || null
  }

  create(conversationId) {
    const task = {
      conversation_id: conversationId,
      task_id: `task-${Date.now().toString(36)}-${String(conversationId).slice(0, 6)}`,
      status: 'idle',
      stage: 0,
      progress: 0,
      current_action: '',
      partial_result: '',
      history: [],
      tool_calls: [],
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }
    if (this.db) {
      this._upsert(task)
    } else {
      this._mem.set(conversationId, task)
    }
    return this.get(conversationId) || task
  }

  update(conversationId, patch) {
    const task = this.get(conversationId) || this.create(conversationId)
    Object.assign(task, patch, { updated_at: new Date().toISOString() })
    if (this.db) {
      this._upsert(task)
    } else {
      this._mem.set(conversationId, task)
    }
    return task
  }

  // "proceed" → resume the active task instead of starting a new request
  static resumeIntent(message) {
    return RESUME_PATTERN.test(String(message || '').trim())
  }
}

// AgentEventBus — per-conversation event stream powering the SSE endpoint
// (GET /api/ai/task/:cid/events). Monotonic per-conversation ids let
// late/reconnecting EventSource subscribers replay missed events via lastId.
// Every event is ALSO appended to the agent_events table (best-effort) so the
// audit trail survives restarts.
export class AgentEventBus {
  constructor({ db = null } = {}) {
    this._buffers = new Map()
    this._waiters = new Map()
    this._ins = null
    try {
      this.db = db || getDb()
      this._ins = this.db.prepare('INSERT INTO agent_events (conversation_id, event_type, payload) VALUES (?, ?, ?)')
    } catch { this.db = null }
  }

  emit(conversationId, event) {
    const buf = this._buffers.get(conversationId) || []
    const prev = buf.length ? buf[buf.length - 1].id : 0
    const ev = { id: prev + 1, time: Date.now(), ...event, conversation_id: conversationId }
    buf.push(ev)
    if (buf.length > 200) buf.splice(0, buf.length - 200)
    this._buffers.set(conversationId, buf)
    if (this._ins) {
      try { this._ins.run(conversationId, ev.type || 'event', JSON.stringify(ev)) } catch { /* best-effort */ }
    }
    const waiters = this._waiters.get(conversationId) || []
    for (const fn of waiters) fn(ev)
  }

  // events after lastId, oldest-first (replay on subscribe)
  events(conversationId, lastId = 0) {
    return (this._buffers.get(conversationId) || []).filter(e => e.id > lastId)
  }

  on(conversationId, fn) {
    const w = this._waiters.get(conversationId) || []
    w.push(fn)
    this._waiters.set(conversationId, w)
    return () => this.off(conversationId, fn)
  }

  off(conversationId, fn) {
    const w = this._waiters.get(conversationId) || []
    this._waiters.set(conversationId, w.filter(f => f !== fn))
  }
}
