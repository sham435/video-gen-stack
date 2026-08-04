// AgentTaskStore — persistent conversation + task state for the dashboard AI.
//
// Fixes the stateless-chat problem: each conversation carries a task record
// (status, stage, progress, current action, partial result, accumulated tool
// evidence, bounded history) so "proceed"/"continue" resumes the same task
// instead of starting a brand-new unrelated request.
//
// Persisted to data/agent-tasks.json (gitignored).

import fs from 'fs'
import path from 'path'

const DEFAULT_FILE = path.resolve(process.cwd(), 'data', 'agent-tasks.json')

const RESUME_PATTERN = /^(please\s+)?(continue|proceed|resume|go ahead|keep going|keep it going|carry on|continue on|keep going on|continue with)\b/i

export class AgentTaskStore {
  constructor({ file = DEFAULT_FILE } = {}) {
    this.file = file
    this.tasks = new Map()
    this._load()
  }

  _load() {
    try {
      if (fs.existsSync(this.file)) {
        const rows = JSON.parse(fs.readFileSync(this.file, 'utf-8'))
        if (Array.isArray(rows)) for (const t of rows) if (t?.conversation_id) this.tasks.set(t.conversation_id, t)
      }
    } catch { /* corrupt or missing — start clean */ }
  }

  _save() {
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true })
      fs.writeFileSync(this.file, JSON.stringify([...this.tasks.values()], null, 2))
    } catch { /* persistence is best-effort */ }
  }

  get(conversationId) {
    return this.tasks.get(conversationId) || null
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
    this.tasks.set(conversationId, task)
    this._save()
    return task
  }

  update(conversationId, patch) {
    const task = this.get(conversationId) || this.create(conversationId)
    Object.assign(task, patch, { updated_at: new Date().toISOString() })
    this._save()
    return task
  }

  // "proceed" → resume the active task instead of starting a new request
  static resumeIntent(message) {
    return RESUME_PATTERN.test(String(message || '').trim())
  }
}

// AgentEventBus — in-memory event stream per conversation, powering the SSE
// endpoint (GET /api/ai/task/:cid/events). Monotonic per-conversation ids let
// late/reconnecting EventSource subscribers replay missed events via lastId.
export class AgentEventBus {
  constructor() {
    this._buffers = new Map()
    this._waiters = new Map()
  }

  emit(conversationId, event) {
    const buf = this._buffers.get(conversationId) || []
    const prev = buf.length ? buf[buf.length - 1].id : 0
    const ev = { id: prev + 1, time: Date.now(), ...event, conversation_id: conversationId }
    buf.push(ev)
    if (buf.length > 200) buf.splice(0, buf.length - 200)
    this._buffers.set(conversationId, buf)
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
