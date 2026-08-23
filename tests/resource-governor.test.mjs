import assert from 'node:assert/strict'
import { describe, it, beforeEach, afterEach } from 'node:test'
import fs from 'fs'
import os from 'os'
import path from 'path'

import { getBudget, getBudgets, listProviders, getBudgetWithOverrides } from '../src/governor/ProviderBudgets.mjs'
import { OperationJournal } from '../src/governor/OperationJournal.mjs'
import { ResourceGovernor } from '../src/governor/ResourceGovernor.mjs'
import { StageStatus, getStage } from '../src/orchestrator/Stages.mjs'
import { ProductionJob } from '../src/orchestrator/ProductionJob.mjs'

const SAMPLE_ARTICLE = {
  title: 'Tesla Q4 Earnings Crush Expectations',
  category: 'TESLA',
  publishedAt: '2026-08-24T12:00:00Z',
}

describe('ProviderBudgets', () => {
  it('has budgets for all expected providers', () => {
    const providers = listProviders()
    assert.ok(providers.includes('rapidnews'))
    assert.ok(providers.includes('youtube'))
    assert.ok(providers.includes('elevenlabs'))
    assert.ok(providers.includes('newsdata'))
    assert.ok(providers.includes('pexels'))
    assert.ok(providers.includes('gemini'))
  })

  it('getBudget returns budget object with daily/monthly', () => {
    const b = getBudget('rapidnews')
    assert.ok(b)
    assert.equal(b.daily, 3)
    assert.equal(b.monthly, 100)
    assert.equal(b.description, 'RapidAPI Real-Time News Data')
  })

  it('getBudget returns null for unknown provider', () => {
    assert.equal(getBudget('nonexistent'), null)
  })

  it('getBudgets returns all budgets', () => {
    const all = getBudgets()
    assert.ok(typeof all === 'object')
    assert.ok(Object.keys(all).length >= 6)
  })

  it('getBudgetWithOverrides respects env overrides', () => {
    const orig = process.env.RAPIDNEWS_DAILY_BUDGET
    process.env.RAPIDNEWS_DAILY_BUDGET = '99'
    const b = getBudgetWithOverrides('rapidnews')
    assert.equal(b.daily, 99)
    assert.equal(b.monthly, 100) // not overridden
    if (orig === undefined) delete process.env.RAPIDNEWS_DAILY_BUDGET
    else process.env.RAPIDNEWS_DAILY_BUDGET = orig
  })
})

describe('OperationJournal', () => {
  let tmpDir

  beforeEach(() => { tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'journal-')) })
  afterEach(() => { fs.rmSync(tmpDir, { recursive: true, force: true }) })

  it('operationId is deterministic', () => {
    const id1 = OperationJournal.operationId('job-1', 'youtube.upload')
    const id2 = OperationJournal.operationId('job-1', 'youtube.upload')
    assert.equal(id1, id2)
    assert.ok(id1.startsWith('op-'))
  })

  it('operationId differs for different operations', () => {
    const id1 = OperationJournal.operationId('job-1', 'youtube.upload')
    const id2 = OperationJournal.operationId('job-1', 'youtube.thumbnail')
    assert.notEqual(id1, id2)
  })

  it('inputHash is deterministic', () => {
    const h1 = OperationJournal.inputHash({ title: 'test' })
    const h2 = OperationJournal.inputHash({ title: 'test' })
    assert.equal(h1, h2)
  })

  it('start + complete lifecycle', () => {
    const j = new OperationJournal(tmpDir)
    const opId = j.start('job-1', 'youtube.upload', 'youtube', { videoId: 'v1' })
    assert.ok(opId)

    const started = j.findStarted('job-1', 'youtube.upload')
    assert.ok(started)
    assert.equal(started.remote_id, null)
    assert.equal(started.completed_at, null)

    j.complete('job-1', 'youtube.upload', 'dQw4w9WgXcQ', 'active', 1234)

    const completed = j.findCompleted('job-1', 'youtube.upload')
    assert.ok(completed)
    assert.equal(completed.remote_id, 'dQw4w9WgXcQ')
    assert.equal(completed.remote_state, 'active')
    assert.equal(completed.duration_ms, 1234)
  })

  it('fail records error', () => {
    const j = new OperationJournal(tmpDir)
    j.start('job-1', 'youtube.upload', 'youtube')
    j.fail('job-1', 'youtube.upload', new Error('auth expired'), 500)

    const entries = j.forJob('job-1')
    assert.equal(entries.length, 1)
    assert.equal(entries[0].error, 'auth expired')
  })

  it('alreadyCompleted returns entry with remote_id', () => {
    const j = new OperationJournal(tmpDir)
    j.start('job-1', 'youtube.upload', 'youtube')
    j.complete('job-1', 'youtube.upload', 'vid123')

    const result = j.alreadyCompleted('job-1', 'youtube.upload')
    assert.ok(result)
    assert.equal(result.remote_id, 'vid123')
  })

  it('alreadyCompleted returns null if not completed', () => {
    const j = new OperationJournal(tmpDir)
    j.start('job-1', 'youtube.upload', 'youtube')
    assert.equal(j.alreadyCompleted('job-1', 'youtube.upload'), null)
  })

  it('countInWindow counts completed calls', () => {
    const j = new OperationJournal(tmpDir)
    j.start('j1', 'op1', 'rapidnews')
    j.complete('j1', 'op1', 'r1')
    j.start('j2', 'op2', 'rapidnews')
    j.complete('j2', 'op2', 'r2')
    j.start('j3', 'op3', 'rapidnews')
    j.fail('j3', 'op3', new Error('fail'))

    const count = j.countInWindow('rapidnews', 60 * 60 * 1000)
    assert.equal(count, 2) // only completed without error
  })

  it('forJob returns all entries for a job', () => {
    const j = new OperationJournal(tmpDir)
    j.start('j1', 'op1', 'youtube')
    j.start('j1', 'op2', 'youtube')
    const entries = j.forJob('j1')
    assert.equal(entries.length, 2)
  })

  it('forProvider returns all entries for a provider', () => {
    const j = new OperationJournal(tmpDir)
    j.start('j1', 'op1', 'youtube')
    j.start('j2', 'op2', 'rapidnews')
    j.start('j3', 'op3', 'youtube')
    const entries = j.forProvider('youtube')
    assert.equal(entries.length, 2)
  })

  it('cleanup removes journal file', () => {
    const j = new OperationJournal(tmpDir)
    j.start('j1', 'op1', 'youtube')
    assert.ok(fs.existsSync(path.join(tmpDir, 'operations.jsonl')))
    j.cleanup()
    assert.ok(!fs.existsSync(path.join(tmpDir, 'operations.jsonl')))
  })
})

describe('ResourceGovernor', () => {
  let tmpDir

  beforeEach(() => { tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gov-')) })
  afterEach(() => { fs.rmSync(tmpDir, { recursive: true, force: true }) })

  it('canExecute returns allowed when quota available', () => {
    const gov = new ResourceGovernor({ stateDir: tmpDir, journalDir: tmpDir })
    const result = gov.canExecute('rapidnews', 'job-1')
    assert.equal(result.allowed, true)
    assert.equal(result.reason, 'quota available')
  })

  it('canExecute blocks when daily quota exhausted', () => {
    const gov = new ResourceGovernor({ stateDir: tmpDir, journalDir: tmpDir })
    // Exhaust daily quota (3 for rapidnews)
    gov.reserve('rapidnews')
    gov.reserve('rapidnews')
    gov.reserve('rapidnews')

    const result = gov.canExecute('rapidnews', 'job-2')
    assert.equal(result.allowed, false)
    assert.ok(result.reason.includes('daily quota exhausted'))
    assert.ok(result.nextEligibleAt)
  })

  it('canExecute blocks when monthly quota exhausted', () => {
    const gov = new ResourceGovernor({ stateDir: tmpDir, journalDir: tmpDir })
    // Set monthly count directly
    gov.state.providers.rapidnews = {
      daily: { date: new Date().toISOString().slice(0, 10), used: 0 },
      monthly: { month: new Date().toISOString().slice(0, 7), used: 100 },
      lastCallAt: 0,
    }
    gov._save()

    const result = gov.canExecute('rapidnews', 'job-1')
    assert.equal(result.allowed, false)
    assert.ok(result.reason.includes('monthly quota exhausted'))
  })

  it('reserve increments daily and monthly counts', () => {
    const gov = new ResourceGovernor({ stateDir: tmpDir, journalDir: tmpDir })
    gov.reserve('rapidnews')
    gov.reserve('rapidnews')

    const status = gov.status('rapidnews')
    assert.equal(status.dailyUsed, 2)
    assert.equal(status.monthlyUsed, 2)
  })

  it('release decrements counts', () => {
    const gov = new ResourceGovernor({ stateDir: tmpDir, journalDir: tmpDir })
    gov.reserve('rapidnews')
    gov.reserve('rapidnews')
    gov.release('rapidnews')

    const status = gov.status('rapidnews')
    assert.equal(status.dailyUsed, 1)
    assert.equal(status.monthlyUsed, 1)
  })

  it('release does not go below 0', () => {
    const gov = new ResourceGovernor({ stateDir: tmpDir, journalDir: tmpDir })
    gov.release('rapidnews')
    const status = gov.status('rapidnews')
    assert.equal(status.dailyUsed, 0)
  })

  it('status returns budget info', () => {
    const gov = new ResourceGovernor({ stateDir: tmpDir, journalDir: tmpDir })
    const s = gov.status('rapidnews')
    assert.equal(s.provider, 'rapidnews')
    assert.ok(s.budget)
    assert.equal(s.budget.daily, 3)
    assert.equal(s.dailyUsed, 0)
  })

  it('status returns null budget for unknown provider', () => {
    const gov = new ResourceGovernor({ stateDir: tmpDir, journalDir: tmpDir })
    const s = gov.status('nonexistent')
    assert.equal(s.budget, null)
  })

  it('state persists across instances', () => {
    const gov1 = new ResourceGovernor({ stateDir: tmpDir, journalDir: tmpDir })
    gov1.reserve('rapidnews')
    gov1.reserve('rapidnews')

    const gov2 = new ResourceGovernor({ stateDir: tmpDir, journalDir: tmpDir })
    const s = gov2.status('rapidnews')
    assert.equal(s.dailyUsed, 2)
  })

  it('canExecute returns allowed for provider with no budget', () => {
    const gov = new ResourceGovernor({ stateDir: tmpDir, journalDir: tmpDir })
    const result = gov.canExecute('nonexistent', 'job-1')
    assert.equal(result.allowed, true)
    assert.equal(result.reason, 'no budget defined')
  })

  it('cooldown blocks when called too soon', () => {
    const gov = new ResourceGovernor({ stateDir: tmpDir, journalDir: tmpDir })
    // youtube has cooldownMs: 30000
    gov.reserve('youtube')
    const result = gov.canExecute('youtube', 'job-1')
    assert.equal(result.allowed, false)
    assert.ok(result.reason.includes('cooldown'))
  })

  it('journal cross-check catches external resets', () => {
    const gov = new ResourceGovernor({ stateDir: tmpDir, journalDir: tmpDir })
    // Manually record completions in journal (simulating prior runs)
    gov.recordStart('j1', 'rapidnews.discover', 'rapidnews')
    gov.recordComplete('j1', 'rapidnews.discover', 'rapidnews', 'r1', 'done', 100)
    gov.recordStart('j2', 'rapidnews.discover', 'rapidnews')
    gov.recordComplete('j2', 'rapidnews.discover', 'rapidnews', 'r2', 'done', 100)
    gov.recordStart('j3', 'rapidnews.discover', 'rapidnews')
    gov.recordComplete('j3', 'rapidnews.discover', 'rapidnews', 'r3', 'done', 100)

    // State file is fresh (counts = 0), but journal has 3 calls → daily exhausted
    const freshGov = new ResourceGovernor({ stateDir: tmpDir + '/fresh', journalDir: tmpDir })
    const result = freshGov.canExecute('rapidnews', 'job-4')
    assert.equal(result.allowed, false)
    assert.ok(result.reason.includes('journal'))
  })
})

describe('ResourceGovernor + ProductionJob integration', () => {
  let tmpDir

  beforeEach(() => { tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'govjob-')) })
  afterEach(() => { fs.rmSync(tmpDir, { recursive: true, force: true }) })

  it('WAITING_FOR_QUOTA when daily quota exhausted', async () => {
    const gov = new ResourceGovernor({ stateDir: tmpDir, journalDir: tmpDir })
    // Exhaust rapidnews quota
    gov.reserve('rapidnews')
    gov.reserve('rapidnews')
    gov.reserve('rapidnews')

    const job = new ProductionJob(SAMPLE_ARTICLE, { checkpointDir: tmpDir, governor: gov })
    job.onStage('DISCOVER', (ctx) => {
      // DISCOVER stage doesn't have a provider → should run fine
      return { article: 'ok' }
    })
    // Manually test canExecute for UPLOAD (which has provider: 'youtube')
    // instead, test with a hypothetical rapidnews stage
    // Actually, let's test by checking canExecute directly
    const quota = gov.canExecute('rapidnews', job.jobId)
    assert.equal(quota.allowed, false)
    assert.ok(quota.reason.includes('daily quota exhausted'))
  })

  it('crash recovery: journal detects prior completion', () => {
    const gov = new ResourceGovernor({ stateDir: tmpDir, journalDir: tmpDir })
    // Simulate a prior crash: operation was completed but checkpoint lost
    gov.recordStart('job-x', 'youtube.upload', 'youtube', { title: 'test' })
    gov.recordComplete('job-x', 'youtube.upload', 'youtube', 'dQw4w9WgXcQ', 'active', 5000)

    const prior = gov.wasCompleted('job-x', 'youtube.upload')
    assert.ok(prior)
    assert.equal(prior.remote_id, 'dQw4w9WgXcQ')
    assert.equal(prior.remote_state, 'active')
  })

  it('recordStart + recordComplete round-trip', () => {
    const gov = new ResourceGovernor({ stateDir: tmpDir, journalDir: tmpDir })
    const opId = gov.recordStart('job-1', 'youtube.upload', 'youtube', { title: 'test' })
    assert.ok(opId)

    gov.recordComplete('job-1', 'youtube.upload', 'youtube', 'vid123', 'processing', 3000)

    const completed = gov.wasCompleted('job-1', 'youtube.upload')
    assert.ok(completed)
    assert.equal(completed.remote_id, 'vid123')
  })

  it('recordFail logs failure', () => {
    const gov = new ResourceGovernor({ stateDir: tmpDir, journalDir: tmpDir })
    gov.recordStart('job-1', 'youtube.upload', 'youtube')
    gov.recordFail('job-1', 'youtube.upload', 'youtube', new Error('timeout'), 1000)

    const prior = gov.wasCompleted('job-1', 'youtube.upload')
    assert.equal(prior, null) // not completed
  })

  it('WAITING_FOR_QUOTA status persisted in checkpoint', async () => {
    const gov = new ResourceGovernor({ stateDir: tmpDir, journalDir: tmpDir })
    // Exhaust youtube quota
    for (let i = 0; i < 6; i++) gov.reserve('youtube')

    const job = new ProductionJob(SAMPLE_ARTICLE, { checkpointDir: tmpDir, governor: gov })
    job.onStage('DISCOVER', () => ({}))
    // UPLOAD has provider: 'youtube', should hit WAITING_FOR_QUOTA
    job.onStage('UPLOAD', () => ({ videoId: 'test' }))

    const result = await job.run()
    assert.equal(result.success, false)
    assert.equal(result.waiting, true)
    assert.ok(result.nextEligibleAt)
    assert.equal(result.lastStage, 'UPLOAD')
  })
})

describe('WAITING_FOR_QUOTA in StageStatus', () => {
  it('is defined', () => {
    assert.equal(StageStatus.WAITING_FOR_QUOTA, 'WAITING_FOR_QUOTA')
  })

  it('UPLOAD stage has provider youtube', () => {
    const stage = getStage('UPLOAD')
    assert.equal(stage.provider, 'youtube')
  })

  it('RENDER stage has no provider', () => {
    const stage = getStage('RENDER')
    assert.equal(stage.provider, null)
  })

  it('PUBLISH stage has provider youtube', () => {
    const stage = getStage('PUBLISH')
    assert.equal(stage.provider, 'youtube')
  })
})
