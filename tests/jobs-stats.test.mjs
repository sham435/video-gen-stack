import { test } from 'node:test'
import assert from 'node:assert/strict'
import express from 'express'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// Optimization item 2 regression: /api/jobs observability. The stats route must
// (a) return read-only aggregate status counts — no payloads/results, (b) be
// matched BEFORE /jobs/:id (Express ordering: 'stats' must not be captured as
// an id → 404), (c) honor the DB isolation env so tests never touch the real
// ledger.
//
// NEWS_DB_PATH must be set BEFORE the jobs module chain is first loaded —
// packages/database/news-engine.mjs captures DB_PATH at module load time.
const dbDir = mkdtempSync(join(tmpdir(), 'jobs-stats-'))
process.env.NEWS_DB_PATH = join(dbDir, 'stats.db')

const { jobDb, enqueue, complete } = await import('../packages/database/jobs.mjs')
const { default: videoRoutes } = await import('../apps/api/routes/video.js')

function withApp(fn) {
  const app = express()
  app.use(express.json())
  app.use('/api', videoRoutes)
  const server = app.listen(0)
  return fn(`http://127.0.0.1:${server.address().port}`).finally(() => server.close())
}

test('jobs stats: aggregates counts by status without payload leakage', async () => {
  const db = jobDb()
  // Deterministic seeding via direct SQL on the isolated DB (claim() picks the
  // OLDEST queued job and would make the distribution order-dependent).
  const jQ = enqueue(db, { type: 'video_generate', payload: { topic: 'queued-one' } }) // queued
  const jR = enqueue(db, { type: 'video_generate', payload: { topic: 'running-one' } })
  db.prepare('UPDATE jobs SET status = ? WHERE id = ?').run('running', jR.id) // running
  const jD = enqueue(db, { type: 'video_generate', payload: { topic: 'done-one' } })
  complete(db, jD.id, { resultPath: '/tmp/out.mp4' }) // done
  const jF = enqueue(db, { type: 'video_generate', payload: { topic: 'failed-one' } })
  db.prepare('UPDATE jobs SET status = ? WHERE id = ?').run('failed', jF.id) // failed

  await withApp(async (base) => {
    const res = await fetch(`${base}/api/jobs/stats`)
    assert.equal(res.status, 200)
    const body = await res.json()
    assert.deepEqual(Object.keys(body).sort(), ['byStatus', 'total'])
    assert.equal(body.total, 4)
    assert.equal(body.byStatus.queued ?? 0, 1)
    assert.equal(body.byStatus.running ?? 0, 1)
    assert.equal(body.byStatus.done ?? 0, 1)
    assert.equal(body.byStatus.failed ?? 0, 1)
    // Observability contract: no payload/result bytes anywhere in the response.
    assert.equal(JSON.stringify(body).includes('topic'), false)
  })
})

test('jobs stats: route ordering — "stats" is not captured by /jobs/:id', async () => {
  await withApp(async (base) => {
    const res = await fetch(`${base}/api/jobs/stats`)
    assert.equal(res.status, 200)
    const body = await res.json()
    assert.ok(body.byStatus && typeof body.total === 'number')
  })
})

test('jobs stats: single-job view still works and strips payloads', async () => {
  const db = jobDb()
  const job = enqueue(db, { type: 'video_generate', payload: { topic: 'secret-content' } })
  await withApp(async (base) => {
    const res = await fetch(`${base}/api/jobs/${job.id}`)
    assert.equal(res.status, 200)
    const meta = await res.json()
    assert.equal(meta.id, job.id)
    assert.equal(meta.payload, undefined, 'job meta must not expose payload')
  })
})