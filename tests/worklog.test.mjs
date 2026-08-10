// Persistent work-log system tests.
// Covers: task lifecycle, checkpoint creation, resume after interruption,
// event append, duplicate task prevention, completed-task verification,
// stale heartbeat detection, session restart recovery.
//
// Each test uses an isolated temp .agent/ dir (never touches the real one).

import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, existsSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { WorkLogManager, TASK_STATUSES } from '../src/agent/WorkLogManager.mjs'
import { ResumeManager } from '../src/agent/ResumeManager.mjs'

function makeMgr() {
  const root = join(mkdtempSync(join(tmpdir(), 'wl-')), '.agent')
  return new WorkLogManager({ root })
}

// ── task lifecycle ─────────────────────────────────────────────────────────
test('task lifecycle — create → start → complete with verification', () => {
  const w = makeMgr()
  const t = w.createTask({ id: 'T1', title: 'Test task', verification: 'npm test' })
  assert.equal(t.status, 'pending')
  assert.ok(TASK_STATUSES.includes(t.status))

  w.startTask('T1', 'working')
  assert.equal(w.tasks()[0].status, 'in_progress')

  w.completeTask('T1', 'node --test passed')
  const done = w.tasks()[0]
  assert.equal(done.status, 'completed')
  assert.ok(done.completedAt)
})

// ── verification gate ──────────────────────────────────────────────────────
test('task — cannot complete without verification evidence', () => {
  const w = makeMgr()
  w.createTask({ id: 'T2', title: 'Needs proof' })
  w.startTask('T2')
  assert.throws(() => w.completeTask('T2'), /verification/)
  assert.equal(w.tasks()[0].status, 'in_progress', 'still in progress after rejected completion')
})

// ── duplicate task prevention ──────────────────────────────────────────────
test('task — duplicate id rejected (atomic registry)', () => {
  const w = makeMgr()
  w.createTask({ id: 'DUP', title: 'first' })
  assert.throws(() => w.createTask({ id: 'DUP', title: 'second' }), /duplicate/)
  assert.equal(w.tasks().length, 1)
})

// ── invalid status rejected ────────────────────────────────────────────────
test('task — invalid status rejected', () => {
  const w = makeMgr()
  assert.throws(() => w.createTask({ id: 'BAD', title: 'x', status: 'bogus' }), /invalid status/)
})

// ── checkpoint creation ────────────────────────────────────────────────────
test('checkpoint — records exact restart position', () => {
  const w = makeMgr()
  w.createTask({ id: 'C1', title: 'Checkpoint task' })
  w.startTask('C1')
  const cp = w.checkpoint({
    task: 'C1',
    action: 'ran test',
    command: 'node --test tests/x.test.mjs',
    result: '3 passed',
    filesChanged: ['src/a.mjs'],
    tests: { passed: 3, failed: 0, lastCommand: 'node --test' },
    blockers: ['network down'],
    nextAction: 'retry upload',
  })
  assert.equal(cp.currentTask, 'C1')
  assert.equal(cp.lastCommand, 'node --test tests/x.test.mjs')
  assert.equal(cp.nextExactAction, 'retry upload')
  assert.deepEqual(cp.blockers, ['network down'])
  const onDisk = JSON.parse(readFileSync(w.checkpointFile, 'utf-8'))
  assert.equal(onDisk.currentTask, 'C1')
})

// ── events append ─────────────────────────────────────────────────────────
test('events — append-only journal grows, never truncates', () => {
  const w = makeMgr()
  w.recordEvent('session.heartbeat', 'hb1')
  w.recordEvent('command.executed', 'node --version')
  w.recordEvent('test.completed', '5 passed')
  const ev = w.recentEvents(10)
  assert.equal(ev.length, 3)
  assert.equal(ev[1].type, 'command.executed')
  assert.equal(ev[2].type, 'test.completed')
  assert.throws(() => w.recordEvent('bogus.type'), /unknown event/)
})

// ── session lifecycle + events ────────────────────────────────────────────
test('session — start writes session + events, end records ended event', () => {
  const w = makeMgr()
  const sid = w.startSession()
  assert.ok(sid, 'session id returned')
  w.createTask({ id: 'S1', title: 'Session task' })
  w.startTask('S1', 'step one')
  w.checkpoint({ task: 'S1', action: 'step one done', nextAction: 'step two' })
  w.endSession('logout')
  const state = w.state()
  assert.equal(state.session.status, 'ended')
  const ev = w.recentEvents(30)
  assert.ok(ev.some(e => e.type === 'session.started'))
  assert.ok(ev.some(e => e.type === 'session.ended'))
  assert.ok(ev.some(e => e.type === 'checkpoint.created'))
})

// ── stale heartbeat detection ─────────────────────────────────────────────
test('stale heartbeat — old active session detected as interrupted', () => {
  const stale = WorkLogManager.isStaleHeartbeat(new Date(Date.now() - 3600_000).toISOString(), 5 * 60_000)
  assert.equal(stale, true, '1h-old heartbeat is stale')
  const fresh = WorkLogManager.isStaleHeartbeat(new Date().toISOString(), 5 * 60_000)
  assert.equal(fresh, false, 'fresh heartbeat is not stale')
  assert.equal(WorkLogManager.isStaleHeartbeat(null, 5 * 60_000), true, 'missing heartbeat is stale')
})

// ── resume after abrupt termination ───────────────────────────────────────
test('resume — interrupted session restores exact position', () => {
  const w = makeMgr()
  w.createTask({ id: 'R1', title: 'Render task', verification: 'ffprobe' })
  w.startTask('R1', 'started concat')
  w.checkpoint({
    task: 'R1',
    action: 'started concat',
    command: 'ffmpeg concat',
    result: 'final.mp4 written',
    filesChanged: ['output/final.mp4'],
    tests: { passed: 184, failed: 0, lastCommand: 'npm test' },
    nextAction: 'validate mp4',
  })
  // Simulate crash: session left "active" with a stale heartbeat (no endSession).
  const state = w.state()
  state.session = {
    id: 'sess-crash',
    startedAt: new Date(Date.now() - 3600_000).toISOString(),
    lastHeartbeat: new Date(Date.now() - 1200_000).toISOString(),
    status: 'active',
  }
  w._write(state, 'session.heartbeat', 'persist crash state')

  // New session boots a fresh manager against the same root (restart).
  const w2 = new WorkLogManager({ root: w.root })
  const resume = new ResumeManager({ worklog: w2 }).resume()
  assert.equal(resume.currentTask.id, 'R1')
  assert.equal(resume.currentTask.status, 'in_progress')
  assert.equal(resume.nextAction, 'validate mp4')
  assert.equal(resume.session.interrupted, true)
  assert.equal(resume.git.branch, 'main')
  assert.equal(resume.tests.passed, 184)
})

// ── ResumeManager render includes next action ─────────────────────────────
test('resume — render includes NEXT ACTION + blockers', () => {
  const w = makeMgr()
  w.createTask({ id: 'R2', title: 'Task two' })
  w.startTask('R2')
  w.checkpoint({ task: 'R2', action: 'a', nextAction: 'do the thing', blockers: ['no key'] })
  const r2 = new ResumeManager({ worklog: w })
  const text = r2.render(r2.resume())
  assert.ok(text.includes('NEXT ACTION'))
  assert.ok(text.includes('do the thing'))
  assert.ok(text.includes('no key'))
  assert.ok(text.includes('RESUME CHECKPOINT'))
})

// ── failed vs completed never conflated ───────────────────────────────────
test('task — fail status is distinct; completion requires event + verification', () => {
  const w = makeMgr()
  w.createTask({ id: 'F1', title: 'Fail task' })
  w.startTask('F1')
  w.failTask('F1', 'api down')
  assert.equal(w.tasks()[0].status, 'failed')
  // A failed task must not be reported completed by resume.
  const resume = new ResumeManager({ worklog: w }).resume()
  assert.notEqual(resume.currentTask.status, 'completed')
  assert.equal(resume.todo.completed, 0)
})

// ── blocked task tracked ──────────────────────────────────────────────────
test('task — blocked status tracked and surfaced', () => {
  const w = makeMgr()
  w.createTask({ id: 'B1', title: 'Blocked task' })
  w.blockTask('B1', 'waiting on LinkedIn approval')
  const resume = new ResumeManager({ worklog: w }).resume()
  assert.equal(resume.todo.blocked, 1)
})