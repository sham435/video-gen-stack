import { test } from 'node:test'
import assert from 'node:assert/strict'
import Database from 'better-sqlite3'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { initSchema } from '../packages/database/news-engine.mjs'
import { AgentTaskStore, AgentEventBus } from '../packages/dashboard/agentTasks.mjs'

function freshDb() {
  const db = new Database(':memory:')
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')
  initSchema(db)
  return db
}

test('agent-store: create/update/get roundtrip persists columns + payload', () => {
  const db = freshDb()
  const store = new AgentTaskStore({ db })
  const t = store.create('conv-1')
  assert.equal(t.status, 'idle')
  store.update('conv-1', { status: 'running', stage: 2, progress: 45, current_action: 'scanning', partial_result: 'part', history: [{ role: 'user', content: 'hi' }], tool_calls: [{ tool: 'repo_stats', ok: true }], approvals: ['modify-secrets'] })
  const got = store.get('conv-1')
  assert.equal(got.status, 'running')
  assert.equal(got.stage, 2)
  assert.equal(got.progress, 45)
  assert.equal(got.current_action, 'scanning')
  assert.equal(got.partial_result, 'part')
  assert.equal(got.history.length, 1)
  assert.equal(got.tool_calls[0].tool, 'repo_stats')
  assert.deepEqual(got.approvals, ['modify-secrets'])
  assert.equal(got.task_id, t.task_id)
  db.close()
})

test('agent-store: persisted across connections (crash recovery)', () => {
  const tmp = path.join(os.tmpdir(), `agent-store-${Date.now()}.db`)
  const db1 = new Database(tmp)
  initSchema(db1)
  const s1 = new AgentTaskStore({ db: db1 })
  s1.update('conv-2', { status: 'interrupted', progress: 85, current_action: 'paused' })
  db1.close()
  const db2 = new Database(tmp)
  initSchema(db2)
  const s2 = new AgentTaskStore({ db: db2 })
  assert.equal(s2.get('conv-2').status, 'interrupted')
  assert.equal(s2.get('conv-2').progress, 85)
  db2.close()
  fs.unlinkSync(tmp)
})

test('agent-store: legacy JSON file migrates once into SQLite', () => {
  const tmp = path.join(os.tmpdir(), `agent-tasks-${Date.now()}.json`)
  fs.writeFileSync(tmp, JSON.stringify([{ conversation_id: 'legacy-1', status: 'running', stage: 1, progress: 30, partial_result: 'x', history: [], tool_calls: [], approvals: [] }]))
  const db = freshDb()
  const store = new AgentTaskStore({ db, file: tmp })
  assert.equal(store.get('legacy-1').status, 'running')
  assert.equal(store.get('legacy-1').partial_result, 'x')
  const rows = db.prepare("SELECT COUNT(*) AS n FROM agent_tasks").get()
  assert.equal(rows.n, 1)
  fs.unlinkSync(tmp)
  db.close()
})

test('agent-store: resume intent matches continuation phrasing only', () => {
  for (const ok of ['continue', 'proceed', 'go ahead', 'please proceed now', 'please continue the audit', 'Keep going', 'resume']) {
    assert.equal(AgentTaskStore.resumeIntent(ok), true, `should match: ${ok}`)
  }
  for (const no of ['explain the pipeline', 'what is a video', 'hello', 'proceeding to step 2 is good', '']) {
    assert.equal(AgentTaskStore.resumeIntent(no), false, `should NOT match: ${no}`)
  }
})

test('agent-events: persistent waiters, monotonic ids, replay, off, DB append', () => {
  const db = freshDb()
  const bus = new AgentEventBus({ db })
  const got = []
  bus.on('conv-3', ev => got.push(ev.type))
  bus.emit('conv-3', { type: 'task_started' })
  bus.emit('conv-3', { type: 'tool_started', tool: 'repo_stats' })
  bus.emit('conv-3', { type: 'task_finished', status: 'completed' })
  assert.deepEqual(got, ['task_started', 'tool_started', 'task_finished'])
  assert.deepEqual(bus.events('conv-3', 0).map(e => e.id), [1, 2, 3])
  assert.equal(bus.events('conv-3', 1).length, 2)
  const off = bus.on('conv-3', () => {})
  off()
  bus.emit('conv-3', { type: 'x' })
  assert.equal(bus.events('conv-3', 0).length, 4)
  const rows = db.prepare("SELECT COUNT(*) AS n FROM agent_events WHERE conversation_id = 'conv-3'").get()
  assert.equal(rows.n, 4)
  db.close()
})
