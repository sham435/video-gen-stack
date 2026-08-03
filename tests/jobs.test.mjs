import { test } from 'node:test'
import assert from 'node:assert/strict'
import Database from 'better-sqlite3'
import { initSchema } from '../packages/database/news-engine.mjs'
import { enqueue, claim, complete, fail, cancel, requeueStale, getJob, listJobs } from '../packages/database/jobs.mjs'
import { SessionManager } from '../src/video-studio/SessionManager.mjs'

function freshDb() {
  const db = new Database(':memory:')
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')
  initSchema(db)
  return db
}

function runnableJob(payload = { prompt: 'test' }) {
  return { type: 'video_generate', payload, contentHash: 'h-' + Math.random().toString(36).slice(2) }
}

test('jobs: full lifecycle enqueue -> claim -> complete', () => {
  const db = freshDb()
  const job = enqueue(db, runnableJob())
  assert.equal(job.status, 'queued')
  assert.equal(getJob(db, job.id).status, 'queued')

  const claimed = claim(db)
  assert.equal(claimed.id, job.id)
  assert.equal(claimed.status, 'running')
  assert.equal(claimed.attempts, 1)
  assert.ok(claimed.started_at)

  const done = complete(db, job.id, { resultPath: '/tmp/v.mp4', result: { videos: [{ url: 'file:///tmp/v.mp4' }] }, durationMs: 1234 })
  assert.equal(done.status, 'done')
  assert.equal(done.result_path, '/tmp/v.mp4')
  assert.equal(done.result.videos[0].url, 'file:///tmp/v.mp4')
  assert.equal(done.duration_ms, 1234)
  assert.ok(done.finished_at)

  assert.equal(claim(db), null, 'no queued jobs left after claim')
  db.close()
})

test('jobs: enqueue is idempotent on content_hash (no duplicate work)', () => {
  const db = freshDb()
  const spec = runnableJob()
  const first = enqueue(db, spec)
  const second = enqueue(db, spec)
  assert.equal(first.id, second.id)
  assert.equal(db.prepare('SELECT COUNT(*) c FROM jobs').get().c, 1)
  db.close()
})

test('jobs: 10 concurrent enqueues -> 10 distinct claims, zero collisions', () => {
  const db = freshDb()
  const jobs = []
  for (let i = 0; i < 10; i++) jobs.push(enqueue(db, runnableJob({ prompt: `job-${i}` })))
  assert.equal(new Set(jobs.map(j => j.id)).size, 10)

  const claimed = new Set()
  for (let i = 0; i < 10; i++) {
    const c = claim(db)
    assert.ok(c, `claim ${i} should succeed`)
    claimed.add(c.id)
  }
  assert.equal(claimed.size, 10, 'each job claimed exactly once')
  assert.equal(claim(db), null, 'queue empty after 10 claims')
  db.close()
})

test('jobs: fail with retries left -> queued with backoff; exhausted -> failed', () => {
  const db = freshDb()
  const job = enqueue(db, runnableJob())
  claim(db)
  const back = fail(db, job.id, 'boom')
  assert.equal(back.status, 'queued')
  assert.equal(back.error, 'boom')
  assert.ok(back.next_retry_at, 'backoff scheduled')

  // Force the retry window open and claim again
  db.prepare("UPDATE jobs SET next_retry_at = datetime('now', '-1 seconds') WHERE id = ?").run(job.id)
  claim(db)
  const back2 = fail(db, job.id, 'boom2')
  assert.ok(back2.next_retry_at > back.next_retry_at, 'backoff grows (2x)')

  // Exhaust attempts
  const limited = enqueue(db, { ...runnableJob(), maxAttempts: 1 })
  claim(db)
  const failed = fail(db, limited.id, 'fatal')
  assert.equal(failed.status, 'failed')
  assert.equal(failed.error, 'fatal')
  assert.ok(failed.finished_at)
  db.close()
})

test('jobs: cancel stops a queued job; stale running jobs are requeued', () => {
  const db = freshDb()
  const job = enqueue(db, runnableJob())
  cancel(db, job.id)
  assert.equal(getJob(db, job.id).status, 'cancelled')
  assert.equal(claim(db), null)

  const stale = enqueue(db, runnableJob())
  claim(db)
  db.prepare("UPDATE jobs SET started_at = datetime('now', '-20 minutes') WHERE id = ?").run(stale.id)
  const n = requeueStale(db, 15 * 60 * 1000)
  assert.equal(n, 1)
  assert.equal(getJob(db, stale.id).status, 'queued')
  db.close()
})

test('jobs: list filters by status and type', () => {
  const db = freshDb()
  enqueue(db, runnableJob())
  enqueue(db, { type: 'news_video', payload: { topic: 'x' } })
  assert.equal(listJobs(db, { status: 'queued' }).length, 2)
  assert.equal(listJobs(db, { type: 'video_generate' }).length, 1)
  assert.equal(listJobs(db, { status: 'done' }).length, 0)
  db.close()
})

test('sessions: DB-backed SessionManager keeps file-free state machine', () => {
  const db = freshDb()
  const mgr = new SessionManager(db)
  const s = mgr.create('Test Session', 'technology')
  assert.equal(s.status, 'GENERATED')
  assert.ok(s.history[0].action === 'GENERATED')
  assert.deepEqual(mgr.queue(), { generated: 1, readyForReview: 0, editing: 0, approved: 0, published: 0 })

  const review = mgr.transition(s.id, 'READY_FOR_REVIEW')
  assert.equal(review.status, 'READY_FOR_REVIEW')
  assert.ok(review.editingWindow, '15-min editing window set on ready-for-review')
  assert.equal(mgr.queue().readyForReview, 1)

  mgr.transition(s.id, 'APPROVED_FOR_PUBLISH')
  mgr.transition(s.id, 'PUBLISHED')
  mgr.updateScore(s.id, { retention: 92 })
  mgr.setPublishUrl(s.id, 'https://youtu.be/abc')
  const got = mgr.get(s.id)
  assert.equal(got.status, 'PUBLISHED')
  assert.equal(got.scores.retention, 92)
  assert.equal(got.publishUrl, 'https://youtu.be/abc')
  assert.equal(got.history.length, 4)

  assert.throws(() => mgr.transition(s.id, 'GENERATED'), /Cannot transition/)
  assert.equal(mgr.list('PUBLISHED').length, 1)
  db.close()
})

test('sessions: editing windows expire to auto-approved', () => {
  const db = freshDb()
  const mgr = new SessionManager(db)
  const s = mgr.create('Old Session', 'science')
  mgr.transition(s.id, 'READY_FOR_REVIEW')
  mgr.transition(s.id, 'EDITING_SESSION_ACTIVE')
  // Backdate the window so it has expired
  db.prepare("UPDATE sessions SET editing_window = ? WHERE id = ?").run(JSON.stringify({ startedAt: new Date(Date.now() - 2e6).toISOString(), expiresAt: new Date(Date.now() - 1e6).toISOString() }), s.id)
  mgr.expireWindows()
  assert.equal(mgr.get(s.id).status, 'APPROVED_FOR_PUBLISH')
  assert.equal(mgr.get(s.id).history[0].action, 'AUTO_APPROVED_TIMEOUT')
  db.close()
})
