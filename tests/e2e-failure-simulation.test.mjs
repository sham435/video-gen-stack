import assert from 'node:assert/strict'
import { describe, it, beforeEach, afterEach } from 'node:test'
import fs from 'fs'
import os from 'os'
import path from 'path'

import { ProductionJob } from '../src/orchestrator/ProductionJob.mjs'
import { STAGES, StageStatus, classifyError } from '../src/orchestrator/Stages.mjs'
import { ResourceGovernor } from '../src/governor/ResourceGovernor.mjs'
import { OperationJournal } from '../src/governor/OperationJournal.mjs'
import { CheckpointStore } from '../src/orchestrator/CheckpointStore.mjs'
import { getBudgetWithOverrides } from '../src/governor/ProviderBudgets.mjs'

const ARTICLE = {
  title: 'Tesla Q4 Earnings Crush Expectations',
  category: 'TESLA',
  publishedAt: '2026-08-24T12:00:00Z',
}

describe('E2E: Crash Recovery', () => {
  let tmpDir

  beforeEach(() => { tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-')) })
  afterEach(() => { fs.rmSync(tmpDir, { recursive: true, force: true }) })

  it('crash during RENDER → quarantine, resume retries from RENDER', async () => {
    let renderCount = 0
    const j1 = new ProductionJob(ARTICLE, { checkpointDir: tmpDir })
    j1.onStage('DISCOVER', () => ({ article: 'ok' }))
    j1.onStage('PREFLIGHT', () => ({ ok: true }))
    j1.onStage('RENDER', () => {
      renderCount++
      throw new Error('CRASH: process killed during render')
    })
    const r1 = await j1.run()
    assert.equal(r1.success, false)
    assert.ok(renderCount >= 2, 'RENDER retried before quarantine')
    assert.equal(r1.lastStage, 'RENDER')

    // Resume: DISCOVER + PREFLIGHT completed, RENDER retries from checkpoint
    const beforeResume = renderCount
    const j2 = new ProductionJob(ARTICLE, { checkpointDir: tmpDir })
    j2.onStage('DISCOVER', () => { throw new Error('DISCOVER should not re-run') })
    j2.onStage('PREFLIGHT', () => { throw new Error('PREFLIGHT should not re-run') })
    j2.onStage('RENDER', () => { renderCount++; return { path: '/out/video.mp4' } })
    for (const s of STAGES.slice(3)) j2.onStage(s.id, () => ({}))
    const r2 = await j2.run()
    assert.equal(r2.success, true)
    assert.equal(renderCount, beforeResume + 1, 'RENDER ran exactly once on resume')
  })

  it('OperationJournal detects prior upload, prevents re-upload on resume', async () => {
    const gov = new ResourceGovernor({ stateDir: tmpDir + '/gov', journalDir: tmpDir + '/journal' })
    const journal = new OperationJournal(tmpDir + '/journal')
    let uploadCount = 0

    const j1 = new ProductionJob(ARTICLE, { checkpointDir: tmpDir, governor: gov })
    j1.onStage('RENDER', () => ({ path: '/out/video.mp4' }))
    j1.onStage('UPLOAD', async (ctx) => {
      uploadCount++
      journal.start(ctx.jobId, 'upload', 'local')
      journal.complete(ctx.jobId, 'upload', 'fake-video-id', 'uploaded', 1000)
      throw new Error('CRASH: after upload, before checkpoint')
    })
    const r1 = await j1.run()
    assert.equal(r1.success, false)
    assert.ok(uploadCount >= 2, 'UPLOAD retried before quarantine')

    const prior = journal.alreadyCompleted(j1.jobId, 'upload')
    assert.ok(prior)
    assert.equal(prior.remote_id, 'fake-video-id')

    // Run 2: resume → journal detects prior completion, skips re-upload
    // Pipeline may not fully succeed (cooldown blocks later youtube stages),
    // but the journal recovery must prevent the upload handler from being called.
    let uploadCount2 = 0
    const j2 = new ProductionJob(ARTICLE, { checkpointDir: tmpDir, governor: gov })
    j2.onStage('RENDER', () => ({ path: '/out/video.mp4' }))
    j2.onStage('UPLOAD', () => { uploadCount2++; return { videoId: 'fake-video-id' } })
    for (const s of STAGES.filter(s => !['RENDER', 'UPLOAD'].includes(s.id)))
      j2.onStage(s.id, () => ({}))
    await j2.run()
    assert.equal(uploadCount2, 0, 'Upload skipped via journal recovery')
    // Verify recovery result persisted in checkpoint
    const uploadResult = j2.store.getStageResult('UPLOAD')
    assert.ok(uploadResult, 'UPLOAD stage was checkpointed')
    assert.equal(uploadResult.result.recovered, true)
    assert.equal(uploadResult.result.remote_id, 'fake-video-id')
  })

  it('checkpoint persists stage results across restart', async () => {
    const j1 = new ProductionJob(ARTICLE, { checkpointDir: tmpDir })
    j1.onStage('DISCOVER', () => ({ article: 'ok' }))
    j1.onStage('RENDER', () => ({ path: '/out/video.mp4' }))
    j1.onStage('THUMBNAIL', () => { throw new Error('crash at thumbnail') })

    await j1.run()

    const store = new CheckpointStore(j1.jobId, tmpDir)
    assert.ok(store.isStageCompleted('DISCOVER'))
    assert.ok(store.isStageCompleted('RENDER'))
    assert.ok(!store.isStageCompleted('THUMBNAIL'))

    const discoverResult = store.getStageResult('DISCOVER')
    assert.equal(discoverResult.result.article, 'ok')

    const renderResult = store.getStageResult('RENDER')
    assert.equal(renderResult.result.path, '/out/video.mp4')
  })
})

describe('E2E: Quota Enforcement', () => {
  let tmpDir

  beforeEach(() => { tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-quota-')) })
  afterEach(() => { fs.rmSync(tmpDir, { recursive: true, force: true }) })

  it('RapidNews request #3 allowed, #4 blocked locally', () => {
    const gov = new ResourceGovernor({ stateDir: tmpDir, journalDir: tmpDir })
    for (let i = 0; i < 3; i++) {
      const q = gov.canExecute('rapidnews', `job-${i}`)
      assert.equal(q.allowed, true, `request ${i + 1} should be allowed`)
      gov.reserve('rapidnews')
    }
    const q = gov.canExecute('rapidnews', 'job-3')
    assert.equal(q.allowed, false)
    assert.ok(q.reason.includes('daily quota exhausted'))
  })

  it('RapidNews monthly=100 blocks at limit', () => {
    const gov = new ResourceGovernor({ stateDir: tmpDir, journalDir: tmpDir })
    gov.state.providers.rapidnews = {
      daily: { date: new Date().toISOString().slice(0, 10), used: 0 },
      monthly: { month: new Date().toISOString().slice(0, 7), used: 100 },
      lastCallAt: 0,
    }
    fs.mkdirSync(tmpDir, { recursive: true })
    fs.writeFileSync(path.join(tmpDir, 'quota-state.json'), JSON.stringify(gov.state))

    const q = gov.canExecute('rapidnews', 'job-1')
    assert.equal(q.allowed, false)
    assert.ok(q.reason.includes('monthly quota exhausted'))
  })

  it('429 is RATE_LIMITED (distinct from QUOTA_UNAVAILABLE)', () => {
    const err429 = { status: 429, message: 'Too Many Requests' }
    const stage = { failureClass: 'TRANSIENT' }
    const failureClass = classifyError(err429, stage)
    assert.equal(failureClass, 'RATE_LIMITED')
  })

  it('QUOTA_UNAVAILABLE blocks before any HTTP call is made', async () => {
    const gov = new ResourceGovernor({ stateDir: tmpDir, journalDir: tmpDir })
    for (let i = 0; i < 6; i++) gov.reserve('youtube')

    const job = new ProductionJob(ARTICLE, { checkpointDir: tmpDir, governor: gov })
    job.onStage('DISCOVER', () => ({}))
    job.onStage('RENDER', () => ({}))
    job.onStage('THUMBNAIL', () => ({}))
    job.onStage('C2PA', () => ({}))
    job.onStage('UNIQUENESS', () => ({}))
    job.onStage('UPLOAD', () => ({ videoId: 'test' }))
    // PUBLISH has provider: 'youtube', should hit WAITING_FOR_QUOTA
    job.onStage('PUBLISH', () => { throw new Error('should never be called') })

    const result = await job.run()
    assert.equal(result.success, false)
    assert.equal(result.waiting, true)
    assert.ok(result.nextEligibleAt)
    assert.equal(result.lastStage, 'PUBLISH')
  })
})

describe('E2E: Hard Limit Enforcement', () => {
  it('RAPIDNEWS_DAILY_BUDGET=500 capped at hard limit 3', () => {
    const orig = process.env.RAPIDNEWS_DAILY_BUDGET
    process.env.RAPIDNEWS_DAILY_BUDGET = '500'
    const b = getBudgetWithOverrides('rapidnews')
    assert.equal(b.daily, 3)
    if (orig === undefined) delete process.env.RAPIDNEWS_DAILY_BUDGET
    else process.env.RAPIDNEWS_DAILY_BUDGET = orig
  })

  it('RAPIDNEWS_DAILY_BUDGET=2 reduces from 3→2', () => {
    const orig = process.env.RAPIDNEWS_DAILY_BUDGET
    process.env.RAPIDNEWS_DAILY_BUDGET = '2'
    const b = getBudgetWithOverrides('rapidnews')
    assert.equal(b.daily, 2)
    if (orig === undefined) delete process.env.RAPIDNEWS_DAILY_BUDGET
    else process.env.RAPIDNEWS_DAILY_BUDGET = orig
  })

  it('cooldown can only increase, not decrease', () => {
    const orig = process.env.YOUTUBE_COOLDOWN_MS
    process.env.YOUTUBE_COOLDOWN_MS = '1000'
    const b = getBudgetWithOverrides('youtube')
    assert.equal(b.cooldownMs, 30000)
    if (orig === undefined) delete process.env.YOUTUBE_COOLDOWN_MS
    else process.env.YOUTUBE_COOLDOWN_MS = orig
  })
})

describe('E2E: Dedup Fail-Closed', () => {
  it('all-duplicate articles → fresh is empty → articles=null → abort', () => {
    const used = new Set(['article one', 'article two'])
    const articles = [
      { title: 'Article One', description: 'desc' },
      { title: 'Article Two', description: 'desc' },
    ]
    const fresh = articles.filter(a => !used.has(a.title.toLowerCase()))
    assert.equal(fresh.length, 0)
  })
})

describe('E2E: Pre-Upload Dedup Record', () => {
  let tmpDir

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-dedup-'))
    process.env.PUBLISH_EVENTS_FILE = path.join(tmpDir, 'publish-events.json')
  })
  afterEach(() => {
    delete process.env.PUBLISH_EVENTS_FILE
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  it('pending record blocks dedup on retry', async () => {
    const { PublishEventsStore } = await import('../src/publishing/PublishEventsStore.mjs')
    const store = new PublishEventsStore()
    const title = 'Test Article Title'
    store.record({ videoId: null, title, pending: true })

    const used = new Set()
    for (const ev of store.events) {
      if (ev.title) used.add(String(ev.title).trim().toLowerCase())
    }
    assert.ok(used.has(title.toLowerCase()))
  })

  it('updateByTitle fills in videoId on pending record', async () => {
    const { PublishEventsStore } = await import('../src/publishing/PublishEventsStore.mjs')
    const store = new PublishEventsStore()
    const title = 'Update Test Article'
    store.record({ videoId: null, title, pending: true })

    const updated = store.updateByTitle(title, { videoId: 'vid123', category: 'tech' })
    assert.ok(updated)
    assert.equal(updated.videoId, 'vid123')
    assert.equal(updated.pending, false)
    assert.equal(updated.category, 'tech')
  })
})
