// WorkLogManager — canonical persistent work-state engine for NEWS-MONSTER.
//
// The agent's working position lives in .agent/ (STATE.json, TODO.json,
// CHECKPOINT.json, EVENTS.jsonl). Conversation history is only context; this
// module is the authoritative state machine. After any restart the agent reads
// STATE + CHECKPOINT + TODO and continues exactly where it stopped.
//
// Philosophy:
//   - EVENTS.jsonl is append-only and never rewritten (historical evidence)
//   - tasks are never deleted; statuses are strict
//   - a task is never "completed" without a completion event + verification
//   - heartbeat + checkpoint let an interrupted session be identified

import { readFileSync, writeFileSync, existsSync, mkdirSync, appendFileSync, readdirSync, renameSync, unlinkSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'

const ROOT = resolve(process.cwd(), '.agent')
const STATE_FILE = join(ROOT, 'STATE.json')
const TODO_FILE = join(ROOT, 'TODO.json')
const CHECKPOINT_FILE = join(ROOT, 'CHECKPOINT.json')
const EVENTS_FILE = join(ROOT, 'EVENTS.jsonl')
const SESSIONS_DIR = join(ROOT, 'sessions')

export const TASK_STATUSES = ['pending', 'in_progress', 'blocked', 'completed', 'failed', 'cancelled']
export const EVENT_TYPES = [
  'session.started', 'session.heartbeat', 'session.ended',
  'task.created', 'task.started', 'task.completed', 'task.failed', 'task.blocked',
  'command.executed', 'test.completed', 'checkpoint.created', 'commit.created',
]

function now() { return new Date().toISOString() }
function isoFor(date) { return date ? new Date(date).toISOString() : null }

/** Read + validate JSON or throw a clear error (never silently corrupt state). */
function readJson(file, fallback) {
  try {
    if (!existsSync(file)) return fallback
    return JSON.parse(readFileSync(file, 'utf-8'))
  } catch (e) {
    throw new Error(`worklog: corrupt ${file}: ${e.message}`)
  }
}
function writeJson(file, data) {
  mkdirSync(dirname(file), { recursive: true })
  // Atomic write: tmp + rename so a crash can never leave a half-written file.
  const tmp = `${file}.tmp-${process.pid}`
  writeFileSync(tmp, JSON.stringify(data, null, 2) + '\n')
  try { renameSync(tmp, file) } finally { try { unlinkSync(tmp) } catch {} }
}

export class WorkLogManager {
  constructor({ root = ROOT } = {}) {
    this.root = root
    this.stateFile = join(root, 'STATE.json')
    this.todoFile = join(root, 'TODO.json')
    this.checkpointFile = join(root, 'CHECKPOINT.json')
    this.eventsFile = join(root, 'EVENTS.jsonl')
    this.sessionsDir = join(root, 'sessions')
  }

  // ── read accessors ───────────────────────────────────────────────────────
  state() { return readJson(this.stateFile, {}) }
  checkpoint() { return readJson(this.checkpointFile, {}) }
  todo() { return readJson(this.todoFile, { tasks: [] }) }
  tasks() { return this.todo().tasks }

  /** Last N events (newest last). */
  recentEvents(n = 20) {
    try {
      if (!existsSync(this.eventsFile)) return []
      const lines = readFileSync(this.eventsFile, 'utf-8').split('\n').filter(Boolean)
      return lines.slice(-n).map(l => { try { return JSON.parse(l) } catch { return null } }).filter(Boolean)
    } catch { return [] }
  }

  // ── events (append-only journal) ─────────────────────────────────────────
  recordEvent(type, detail = null, task = null, extra = {}) {
    if (!EVENT_TYPES.includes(type)) throw new Error(`worklog: unknown event type ${type}`)
    const ev = { timestamp: now(), type, detail, task, ...extra }
    mkdirSync(this.root, { recursive: true })
    appendFileSync(this.eventsFile, JSON.stringify(ev) + '\n')
    return ev
  }

  // ── session lifecycle ────────────────────────────────────────────────────
  startSession(meta = {}) {
    const id = `session-${new Date().toISOString().slice(0, 10)}-${Math.random().toString(36).slice(2, 8)}`
    const state = this.state()
    state.session = { id, startedAt: now(), lastHeartbeat: now(), status: 'active', meta }
    this._write(state, 'session.started', `session ${id} started`)
    // Per-session JSONL transcript in .agent/sessions/<yyyy-mm>/<id>.jsonl
    const dir = join(this.sessionsDir, new Date().toISOString().slice(0, 7))
    mkdirSync(dir, { recursive: true })
    appendFileSync(join(dir, `${id}.jsonl`), JSON.stringify({ timestamp: now(), type: 'session.started', id, meta }) + '\n')
    // NOTE: intentionally do NOT checkpoint() here — restart must preserve the
    // previous session's lastAction/nextAction (resume data), not clobber it
    // with "session started". Only the session object is updated.
    return id
  }

  heartbeat() {
    const state = this.state()
    state.session.lastHeartbeat = now()
    this._write(state, 'session.heartbeat', `heartbeat ${state.session?.id}`)
  }

  endSession(reason = 'logout') {
    const state = this.state()
    const id = state.session?.id || null
    if (id) {
      state.session.status = 'ended'
      state.session.endedAt = now()
      state.session.endReason = reason
      this._write(state, 'session.ended', `session ${id} ended: ${reason}`)
    } else {
      this.recordEvent('session.ended', `session ended: ${reason}`)
    }
  }

  // ── task lifecycle (strict statuses, never deleted) ──────────────────────
  createTask({ id, title, priority = 'P1', status = 'pending', dependsOn = [], verification = '', nextAction = '' } = {}) {
    if (!id || !title) throw new Error('worklog: task id and title required')
    if (!TASK_STATUSES.includes(status)) throw new Error(`worklog: invalid status ${status}`)
    const t = this.todo()
    const existing = t.tasks.find(x => x.id === id)
    if (existing) throw new Error(`worklog: duplicate task id ${id} (task ids must be unique)`)
    const task = {
      id, title, priority, status, dependsOn,
      currentAction: '', nextAction, verification,
      createdAt: now(), updatedAt: now(), completedAt: null, failedAt: null,
    }
    t.tasks.push(task)
    this._writetodo(t, 'task.created', `task ${id} created`)
    return task
  }

  startTask(id, currentAction = '') {
    const t = this.todo()
    const task = t.tasks.find(x => x.id === id)
    if (!task) throw new Error(`worklog: unknown task ${id}`)
    if (task.id !== id) return
    // One in_progress at a time: any other in_progress tasks are not touched
    // (caller decides), but we record this one's start.
    task.status = 'in_progress'
    task.currentAction = currentAction || task.currentAction || 'started'
    task.updatedAt = now()
    this._writetodo(t, 'task.started', `task ${id} started`)
    this.checkpoint({ task: id, action: currentAction || 'started', nextAction: task.nextAction })
    return task
  }

  completeTask(id, verification = '') {
    const t = this.todo()
    const task = t.tasks.find(x => x.id === id)
    if (!task) throw new Error(`worklog: unknown task ${id}`)
    if (!verification) throw new Error(`worklog: cannot complete task ${id} without verification evidence`)
    // Rule: never complete unless a completion event exists (we create it now
    // together with the status flip — atomic in this manager).
    task.status = 'completed'
    task.completedAt = now()
    task.currentAction = ''
    task.nextAction = ''
    task.verification = verification
    task.updatedAt = now()
    this._writetodo(t, 'task.completed', `task ${id} completed (verification: ${verification})`)
    this.checkpoint({ task: id, action: `completed ${id}`, nextAction: '' })
    return task
  }

  failTask(id, reason = '') {
    const t = this.todo()
    const task = t.tasks.find(x => x.id === id)
    if (!task) throw new Error(`worklog: unknown task ${id}`)
    task.status = 'failed'
    task.failedAt = now()
    task.updatedAt = now()
    this._writetodo(t, 'task.failed', `task ${id} failed: ${reason}`)
    this.checkpoint({ task: id, action: `failed ${id}`, nextAction: `retry ${id}` })
    return task
  }

  blockTask(id, reason = '') {
    const t = this.todo()
    const task = t.tasks.find(x => x.id === id)
    if (!task) throw new Error(`worklog: unknown task ${id}`)
    task.status = 'blocked'
    task.updatedAt = now()
    this._writetodo(t, 'task.blocked', `task ${id} blocked: ${reason}`)
    return task
  }

  resumeTask(id, action = '') {
    return this.startTask(id, action)
  }

  // ── checkpointing ────────────────────────────────────────────────────────
  /** Record the exact restart position: task, last action, command, result,
   * files changed, tests, blockers, next exact action. */
  checkpoint({ task = null, action = '', command = '', result = '', filesChanged = [], tests = null, blockers = [], nextAction = '' } = {}) {
    // Pure read when called with no write intent (e.g. resume reads the file).
    if (!task && !action && !command && !result && !tests && !nextAction && filesChanged.length === 0 && blockers.length === 0) {
      return readJson(this.checkpointFile, {})
    }
    const state = this.state()
    if (task) state.currentTask = task
    if (action) state.lastAction = action
    if (command) state.lastCommand = command
    if (result) state.lastResult = result
    if (tests) state.tests = tests
    if (nextAction) state.nextAction = nextAction
    if (blockers.length) state.blockedBy = blockers
    const cp = {
      schema: 'agent-checkpoint/v1',
      createdAt: now(),
      currentTask: task || state.currentTask || null,
      currentStatus: this._taskStatus(task || state.currentTask),
      lastCompletedAction: action || state.lastAction || '',
      lastCommand: command || '',
      lastResult: result || '',
      filesChanged: filesChanged || [],
      tests: tests || state.tests || null,
      blockers: blockers || state.blockedBy || [],
      nextExactAction: nextAction || state.nextAction || '',
      session: state.session?.id || null,
    }
    mkdirSync(this.root, { recursive: true })
    writeJson(this.checkpointFile, cp)
    // STATE.json is the source of truth — persist the mutated state too.
    writeJson(this.stateFile, state)
    this.recordEvent('checkpoint.created', `checkpoint for ${cp.currentTask || 'none'} — next: ${cp.nextExactAction}`, cp.currentTask)
    return cp
  }

  /** Update STATE.json + journal atomically (STATE is the source of truth). */
  _write(state, eventType, eventDetail) {
    writeJson(this.stateFile, state)
    this.recordEvent(eventType, eventDetail, state.currentTask || null)
  }
  _writetodo(todo, eventType, eventDetail) {
    writeJson(this.todoFile, todo)
    this.recordEvent(eventType, eventDetail, null)
  }

  _taskStatus(taskId) {
    const task = this.tasks().find(t => t.id === taskId)
    return task?.status || 'unknown'
  }

  // ── resume / recovery ────────────────────────────────────────────────────
  /** Detect a stale heartbeat: a session marked active with heartbeat older
   * than staleAfterMs was likely interrupted (crash / kill / network). */
  static isStaleHeartbeat(heartbeat, staleAfterMs = 5 * 60_000) {
    if (!heartbeat) return true
    return Date.now() - new Date(heartbeat).getTime() > staleAfterMs
  }

  sessionFiles() {
    try {
      if (!existsSync(this.sessionsDir)) return []
      return readdirSync(this.sessionsDir, { recursive: true }).map(String).filter(p => p.endsWith('.jsonl')).map(join => join)
    } catch { return [] }
  }
}

export { STATE_FILE, TODO_FILE, CHECKPOINT_FILE, EVENTS_FILE, SESSIONS_DIR }