import assert from 'node:assert/strict'
import { describe, it, beforeEach, afterEach } from 'node:test'
import fs from 'fs'
import os from 'os'
import path from 'path'

import { STAGES, StageStatus, FailureClass, getStage, stageIndex, nextStage, classifyError } from '../src/orchestrator/Stages.mjs'
import { articleId, stageArtifactId, thumbnailArtifactId, videoArtifactId, c2paArtifactId, buildJobId } from '../src/orchestrator/ArtifactID.mjs'
import { nextDelay, shouldRetry, classifyDecision } from '../src/orchestrator/RetryPolicy.mjs'
import { CheckpointStore } from '../src/orchestrator/CheckpointStore.mjs'
import { ProductionJob } from '../src/orchestrator/ProductionJob.mjs'

const SAMPLE_ARTICLE = {
  title: 'Tesla Q4 Earnings Crush Expectations',
  category: 'TESLA',
  publishedAt: '2026-08-24T12:00:00Z',
}

describe('Stages', () => {
  it('has 9 stages in correct order', () => {
    assert.equal(STAGES.length, 9)
    const ids = STAGES.map(s => s.id)
    assert.deepEqual(ids, ['DISCOVER', 'RENDER', 'THUMBNAIL', 'C2PA', 'UNIQUENESS', 'UPLOAD', 'PUBLISH', 'VERIFY', 'ANALYTICS'])
  })

  it('every stage has a failureClass', () => {
    for (const s of STAGES) {
      assert.ok(Object.values(FailureClass).includes(s.failureClass), `${s.id} missing failureClass`)
    }
  })

  it('every stage has maxRetries', () => {
    for (const s of STAGES) {
      assert.ok(typeof s.maxRetries === 'number', `${s.id} missing maxRetries`)
      assert.ok(s.maxRetries >= 1, `${s.id} maxRetries must be >= 1`)
    }
  })

  it('getStage returns by id', () => {
    assert.equal(getStage('RENDER').id, 'RENDER')
    assert.equal(getStage('NONEXIST'), undefined)
  })

  it('stageIndex returns -1 for unknown', () => {
    assert.equal(stageIndex('DISCOVER'), 0)
    assert.equal(stageIndex('ANALYTICS'), 8)
    assert.equal(stageIndex('NOPE'), -1)
  })

  it('nextStage returns next or null', () => {
    assert.equal(nextStage('DISCOVER').id, 'RENDER')
    assert.equal(nextStage('ANALYTICS'), null)
    assert.equal(nextStage('NONEXIST'), null)
  })

  it('classifyError detects 429 as RATE_LIMITED', () => {
    const err = { status: 429, message: 'rate limit' }
    assert.equal(classifyError(err, getStage('UPLOAD')), FailureClass.RATE_LIMITED)
  })

  it('classifyError detects 401 as PERMANENT', () => {
    const err = { status: 401, message: 'unauthorized' }
    assert.equal(classifyError(err, getStage('UPLOAD')), FailureClass.PERMANENT)
  })

  it('classifyError detects render failure as INVALID_ARTIFACT', () => {
    const err = { message: 'Render validation failed: stage=final-copy' }
    assert.equal(classifyError(err, getStage('RENDER')), FailureClass.INVALID_ARTIFACT)
  })

  it('classifyError defaults to stage failureClass', () => {
    const err = { message: 'something weird happened' }
    assert.equal(classifyError(err, getStage('UPLOAD')), FailureClass.RATE_LIMITED)
  })
})

describe('ArtifactID', () => {
  it('articleId is deterministic', () => {
    const a = articleId(SAMPLE_ARTICLE)
    assert.equal(a, articleId(SAMPLE_ARTICLE))
    assert.ok(a.startsWith('art-'))
  })

  it('articleId differs for different articles', () => {
    const a1 = articleId({ title: 'Article One', category: 'TECH' })
    const a2 = articleId({ title: 'Article Two', category: 'TECH' })
    assert.notEqual(a1, a2)
  })

  it('stageArtifactId combines stage + article', () => {
    const id = stageArtifactId('art-abc', 'RENDER')
    assert.equal(id, 'RENDER-art-abc')
  })

  it('thumbnailArtifactId includes candidate index', () => {
    assert.equal(thumbnailArtifactId('art-abc', 0), 'thumb-art-abc-0')
    assert.equal(thumbnailArtifactId('art-abc', 3), 'thumb-art-abc-3')
  })

  it('videoArtifactId is prefixed', () => {
    assert.equal(videoArtifactId('art-abc'), 'video-art-abc')
  })

  it('c2paArtifactId is prefixed', () => {
    assert.equal(c2paArtifactId('art-abc'), 'c2pa-art-abc')
  })

  it('buildJobId wraps articleId', () => {
    const jid = buildJobId(SAMPLE_ARTICLE)
    assert.ok(jid.startsWith('job-art-'))
    assert.equal(jid, `job-${articleId(SAMPLE_ARTICLE)}`)
  })
})

describe('RetryPolicy', () => {
  it('nextDelay returns 0 for first attempt', () => {
    assert.equal(nextDelay(0, FailureClass.TRANSIENT), 0)
  })

  it('nextDelay grows exponentially for TRANSIENT', () => {
    const d1 = nextDelay(1, FailureClass.TRANSIENT)
    const d2 = nextDelay(2, FailureClass.TRANSIENT)
    assert.ok(d2 > d1)
  })

  it('RATE_LIMITED has longer base than TRANSIENT', () => {
    assert.ok(nextDelay(1, FailureClass.RATE_LIMITED) > nextDelay(1, FailureClass.TRANSIENT))
  })

  it('INVALID_ARTIFACT returns 0 (regenerate, no backoff)', () => {
    assert.equal(nextDelay(1, FailureClass.INVALID_ARTIFACT), 0)
  })

  it('PERMANENT returns null', () => {
    assert.equal(nextDelay(1, FailureClass.PERMANENT), null)
  })

  it('backoff is capped at 60s', () => {
    const d = nextDelay(10, FailureClass.RATE_LIMITED)
    assert.ok(d <= 60_000)
  })

  it('shouldRetry respects PERMANENT', () => {
    assert.equal(shouldRetry(0, 3, FailureClass.PERMANENT), false)
  })

  it('shouldRetry respects maxRetries', () => {
    assert.equal(shouldRetry(3, 3, FailureClass.TRANSIENT), false)
    assert.equal(shouldRetry(2, 3, FailureClass.TRANSIENT), true)
  })

  it('classifyDecision returns quarantine for PERMANENT', () => {
    const d = classifyDecision(FailureClass.PERMANENT, 0, 3)
    assert.equal(d.action, 'quarantine')
  })

  it('classifyDecision returns quarantine when exhausted', () => {
    const d = classifyDecision(FailureClass.TRANSIENT, 3, 3)
    assert.equal(d.action, 'quarantine')
  })

  it('classifyDecision returns regenerate for INVALID_ARTIFACT', () => {
    const d = classifyDecision(FailureClass.INVALID_ARTIFACT, 0, 3)
    assert.equal(d.action, 'regenerate')
  })

  it('classifyDecision returns retry for TRANSIENT', () => {
    const d = classifyDecision(FailureClass.TRANSIENT, 0, 3)
    assert.equal(d.action, 'retry')
    assert.ok(typeof d.delayMs === 'number')
  })
})

describe('CheckpointStore', () => {
  let tmpDir

  beforeEach(() => { tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ckpt-')) })
  afterEach(() => { fs.rmSync(tmpDir, { recursive: true, force: true }) })

  it('does not exist before first save', () => {
    const store = new CheckpointStore('job-test', tmpDir)
    assert.equal(store.exists(), false)
    assert.equal(store.load(), null)
  })

  it('save creates file and load reads it', () => {
    const store = new CheckpointStore('job-1', tmpDir)
    store.save({ status: 'RUNNING' })
    const loaded = store.load()
    assert.equal(loaded.jobId, 'job-1')
    assert.equal(loaded.status, 'RUNNING')
    assert.ok(loaded.savedAt)
  })

  it('updateStage patches specific stage', () => {
    const store = new CheckpointStore('job-2', tmpDir)
    store.updateStage('RENDER', { status: 'RUNNING' })
    store.updateStage('RENDER', { status: 'COMPLETED', result: { path: '/out/video.mp4' } })
    const stage = store.getStageResult('RENDER')
    assert.equal(stage.status, 'COMPLETED')
    assert.equal(stage.result.path, '/out/video.mp4')
  })

  it('markStageCompleted writes completed status', () => {
    const store = new CheckpointStore('job-3', tmpDir)
    store.markStageCompleted('DISCOVER', { article: 'test' })
    assert.equal(store.isStageCompleted('DISCOVER'), true)
    assert.equal(store.isStageCompleted('RENDER'), false)
  })

  it('markStageQuarantined writes quarantine reason', () => {
    const store = new CheckpointStore('job-4', tmpDir)
    store.markStageQuarantined('UPLOAD', 'auth expired')
    const stage = store.getStageResult('UPLOAD')
    assert.equal(stage.status, StageStatus.QUARANTINED)
    assert.equal(stage.quarantineReason, 'auth expired')
  })

  it('resumeFrom returns next incomplete stage', () => {
    const store = new CheckpointStore('job-5', tmpDir)
    store.markStageCompleted('DISCOVER', {})
    store.markStageCompleted('RENDER', {})
    const next = store.resumeFrom()
    assert.equal(next.id, 'THUMBNAIL')
  })

  it('resumeFrom returns null when all done', () => {
    const store = new CheckpointStore('job-6', tmpDir)
    for (const s of STAGES) store.markStageCompleted(s.id, {})
    assert.equal(store.resumeFrom(), null)
  })

  it('cleanup removes checkpoint file', () => {
    const store = new CheckpointStore('job-7', tmpDir)
    store.save({ status: 'RUNNING' })
    assert.ok(store.exists())
    store.cleanup()
    assert.equal(store.exists(), false)
  })

  it('getLastCompletedStage returns highest index completed', () => {
    const store = new CheckpointStore('job-8', tmpDir)
    store.markStageCompleted('DISCOVER', { x: 1 })
    store.markStageCompleted('THUMBNAIL', { x: 3 })
    const last = store.getLastCompletedStage()
    assert.equal(last.id, 'THUMBNAIL')
  })
})

describe('ProductionJob', () => {
  let tmpDir

  beforeEach(() => { tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pjob-')) })
  afterEach(() => { fs.rmSync(tmpDir, { recursive: true, force: true }) })

  it('generates deterministic jobId from article', () => {
    const j1 = new ProductionJob(SAMPLE_ARTICLE, { checkpointDir: tmpDir })
    const j2 = new ProductionJob(SAMPLE_ARTICLE, { checkpointDir: tmpDir })
    assert.equal(j1.jobId, j2.jobId)
  })

  it('run executes all stages in order', async () => {
    const order = []
    const job = new ProductionJob(SAMPLE_ARTICLE, { checkpointDir: tmpDir })
    for (const s of STAGES) {
      job.onStage(s.id, () => { order.push(s.id) })
    }
    const result = await job.run()
    assert.equal(result.success, true)
    assert.deepEqual(order, STAGES.map(s => s.id))
  })

  it('skip stages that failed and quarantine', async () => {
    const job = new ProductionJob(SAMPLE_ARTICLE, { checkpointDir: tmpDir })
    job.onStage('DISCOVER', () => ({ article: 'ok' }))
    job.onStage('RENDER', () => { throw new Error('ffmpeg crashed') })
    job.onStage('THUMBNAIL', () => { throw new Error('should not run') })

    const result = await job.run()
    assert.equal(result.success, false)
    assert.ok(result.quarantineReason.includes('RENDER'))
  })

  it('retries transient failures up to maxRetries', async () => {
    let attempts = 0
    const job = new ProductionJob(SAMPLE_ARTICLE, { checkpointDir: tmpDir })
    job.onStage('DISCOVER', () => {
      attempts++
      if (attempts < 3) throw new Error('network timeout')
      return { article: 'ok' }
    })
    for (const s of STAGES.slice(1)) job.onStage(s.id, () => ({}))

    const result = await job.run()
    assert.equal(result.success, true)
    assert.equal(attempts, 3)
  })

  it('quarantines permanent failure immediately', async () => {
    let attempts = 0
    const job = new ProductionJob(SAMPLE_ARTICLE, { checkpointDir: tmpDir })
    job.onStage('UPLOAD', () => {
      attempts++
      const err = new Error('unauthorized')
      err.status = 401
      throw err
    })

    const result = await job.run()
    assert.equal(result.success, false)
    assert.equal(attempts, 1)
    assert.ok(result.quarantineReason.includes('UPLOAD'))
  })

  it('skip completed stages on resume', async () => {
    const order = []
    // First run: complete only DISCOVER + RENDER
    const j1 = new ProductionJob(SAMPLE_ARTICLE, { checkpointDir: tmpDir })
    j1.onStage('DISCOVER', () => ({ article: 'ok' }))
    j1.onStage('RENDER', () => ({ path: '/out/v.mp4' }))
    await j1.run()

    // Second run: resume — DISCOVER + RENDER skipped, rest run
    const j2 = new ProductionJob(SAMPLE_ARTICLE, { checkpointDir: tmpDir })
    j2.onStage('DISCOVER', () => { order.push('DISCOVER'); return {} })
    j2.onStage('RENDER', () => { order.push('RENDER'); return {} })
    for (const s of STAGES.slice(2)) j2.onStage(s.id, () => { order.push(s.id); return {} })

    await j2.run()
    assert.deepEqual(order, ['THUMBNAIL', 'C2PA', 'UNIQUENESS', 'UPLOAD', 'PUBLISH', 'VERIFY', 'ANALYTICS'])
  })

  it('results accumulate across stages', async () => {
    const job = new ProductionJob(SAMPLE_ARTICLE, { checkpointDir: tmpDir })
    job.onStage('DISCOVER', () => ({ article: 'test' }))
    job.onStage('RENDER', (ctx) => ({ path: '/out/video.mp4', articleId: ctx.results.DISCOVER?.article }))
    job.onStage('THUMBNAIL', (ctx) => ({ strategy: 'hero-hook', videoPath: ctx.results.RENDER?.path }))
    for (const s of STAGES.slice(3)) job.onStage(s.id, (ctx) => ({}))

    const result = await job.run()
    assert.equal(result.success, true)
    assert.equal(result.results.DISCOVER.article, 'test')
    assert.equal(result.results.RENDER.path, '/out/video.mp4')
    assert.equal(result.results.THUMBNAIL.strategy, 'hero-hook')
    assert.equal(result.results.THUMBNAIL.videoPath, '/out/video.mp4')
  })

  it('isComplete returns true when all stages done', async () => {
    const job = new ProductionJob(SAMPLE_ARTICLE, { checkpointDir: tmpDir })
    for (const s of STAGES) job.onStage(s.id, () => ({}))
    assert.equal(job.isComplete(), false)
    await job.run()
    assert.equal(job.isComplete(), true)
  })

  it('no handler = pass-through', async () => {
    const job = new ProductionJob(SAMPLE_ARTICLE, { checkpointDir: tmpDir })
    // Only register DISCOVER, leave rest as pass-through
    job.onStage('DISCOVER', () => ({ article: 'ok' }))
    const result = await job.run()
    assert.equal(result.success, true)
    assert.equal(result.results.DISCOVER.article, 'ok')
  })

  it('stage handler receives context with jobId + article + results', async () => {
    let capturedCtx
    const job = new ProductionJob(SAMPLE_ARTICLE, { checkpointDir: tmpDir })
    job.onStage('DISCOVER', () => ({ article: 'ok' }))
    job.onStage('RENDER', (ctx) => { capturedCtx = ctx; return {} })
    for (const s of STAGES.slice(2)) job.onStage(s.id, () => ({}))

    await job.run()
    assert.ok(capturedCtx)
    assert.equal(capturedCtx.jobId, job.jobId)
    assert.equal(capturedCtx.article, SAMPLE_ARTICLE)
    assert.ok(capturedCtx.results.DISCOVER)
  })

  it('RENDER failure → quarantines, later stages skip', async () => {
    const runOrder = []
    const job = new ProductionJob(SAMPLE_ARTICLE, { checkpointDir: tmpDir })
    job.onStage('DISCOVER', () => { runOrder.push('DISCOVER'); return {} })
    job.onStage('RENDER', () => { runOrder.push('RENDER'); throw new Error('moov atom missing') })
    job.onStage('THUMBNAIL', () => { runOrder.push('THUMBNAIL'); return {} })

    const result = await job.run()
    assert.equal(result.success, false)
    // RENDER has maxRetries=2, so it runs initial + 2 retries = 3 attempts
    assert.deepEqual(runOrder, ['DISCOVER', 'RENDER', 'RENDER', 'RENDER'])
    assert.ok(result.quarantineReason.includes('RENDER'))
  })

  it('regenerate action on INVALID_ARTIFACT retries immediately', async () => {
    let attempts = 0
    const job = new ProductionJob(SAMPLE_ARTICLE, { checkpointDir: tmpDir })
    job.onStage('RENDER', () => {
      attempts++
      if (attempts === 1) throw new Error('Render validation failed: corrupt moov')
      return { path: '/out/video.mp4' }
    })
    for (const s of STAGES.filter(s => s.id !== 'RENDER')) job.onStage(s.id, () => ({}))

    const result = await job.run()
    assert.equal(result.success, true)
    assert.equal(attempts, 2)
  })
})
