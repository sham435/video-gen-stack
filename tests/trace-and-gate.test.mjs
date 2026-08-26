import { describe, it, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

/**
 * Phase 1 — Stage trace + PublishabilityGate tests.
 *
 * Validates:
 *   1. Every executed stage produces trace records
 *   2. Trace schema matches spec
 *   3. Failure classification includes DEPENDENCY + CONFIGURATION
 *   4. PublishabilityGate evaluates correctly
 *   5. Gate rejects incomplete jobs
 *   6. Gate passes complete jobs
 */

let tmpDir

beforeEach(() => { tmpDir = mkdtempSync(join(tmpdir(), 'trace-')) })
afterEach(() => { rmSync(tmpDir, { recursive: true, force: true }) })

// ──────────────────────────────────────────────────────────────────
// 1. Stage trace schema + completeness
// ──────────────────────────────────────────────────────────────────
describe('StageTrace: schema and completeness', () => {
  it('every executed stage produces trace records', async () => {
    const { ProductionJob } = await import('../src/orchestrator/ProductionJob.mjs')
    const { STAGES } = await import('../src/orchestrator/Stages.mjs')

    const article = { title: 'Trace test', category: 'tech' }
    const job = new ProductionJob(article, { outDir: tmpDir, checkpointDir: tmpDir })

    for (const s of STAGES) {
      job.onStage(s.id, async () => ({ ok: true, stageId: s.id }))
    }

    await job.run()
    const trace = job.store.getTrace()

    // Every stage must have RUNNING + SUCCEEDED
    for (const s of STAGES) {
      const stageTrace = trace.filter(r => r.stage === s.id)
      assert.ok(stageTrace.length >= 2, `${s.id}: expected >=2 trace records (RUNNING + SUCCEEDED), got ${stageTrace.length}`)

      const running = stageTrace.find(r => r.status === 'RUNNING')
      assert.ok(running, `${s.id}: must have RUNNING record`)
      assert.equal(running.attempt, 0, `${s.id}: RUNNING attempt must be 0`)

      const succeeded = stageTrace.find(r => r.status === 'SUCCEEDED')
      assert.ok(succeeded, `${s.id}: must have SUCCEEDED record`)
      assert.equal(typeof succeeded.durationMs, 'number', `${s.id}: SUCCEEDED must have durationMs`)
    }

    job.cleanup()
  })

  it('trace records match the target schema', async () => {
    const { ProductionJob } = await import('../src/orchestrator/ProductionJob.mjs')

    const article = { title: 'Schema test', category: 'tech' }
    const job = new ProductionJob(article, { outDir: tmpDir, checkpointDir: tmpDir })
    job.onStage('DISCOVER', async () => ({ plan: { niche: { key: 'tech' } } }))
    await job.run()

    const trace = job.store.getTrace()
    const record = trace[0]

    // Required fields
    assert.equal(typeof record.jobId, 'string', 'jobId must be string')
    assert.equal(typeof record.stage, 'string', 'stage must be string')
    assert.equal(typeof record.attempt, 'number', 'attempt must be number')
    assert.equal(typeof record.status, 'string', 'status must be string')
    assert.ok(Array.isArray(record.artifactIds), 'artifactIds must be array')
    assert.ok(typeof record.metadata === 'object' && record.metadata !== null, 'metadata must be object')

    // Terminal records must have completedAt + durationMs
    const succeeded = trace.find(r => r.status === 'SUCCEEDED')
    assert.ok(succeeded.completedAt, 'SUCCEEDED must have completedAt')
    assert.equal(typeof succeeded.durationMs, 'number', 'SUCCEEDED must have durationMs')

    job.cleanup()
  })

  it('failed stage produces FAILED trace with errorClassification', async () => {
    const { ProductionJob } = await import('../src/orchestrator/ProductionJob.mjs')
    const { FailureClass } = await import('../src/orchestrator/Stages.mjs')

    const article = { title: 'Fail test', category: 'tech' }
    const job = new ProductionJob(article, { outDir: tmpDir, checkpointDir: tmpDir })

    // DISCOVER: fail with a rate-limited error
    job.onStage('DISCOVER', async () => {
      const err = new Error('rate limit exceeded')
      err.status = 429
      throw err
    })

    await job.run()
    const trace = job.store.getTrace()
    const failedRecords = trace.filter(r => r.stage === 'DISCOVER' && r.status === 'FAILED')

    assert.ok(failedRecords.length > 0, 'DISCOVER must have FAILED records')
    for (const r of failedRecords) {
      assert.equal(r.errorClassification, FailureClass.RATE_LIMITED, 'FAILED must have errorClassification')
      assert.equal(typeof r.durationMs, 'number', 'FAILED must have durationMs')
    }

    job.cleanup()
  })

  it('quarantined stage produces QUARANTINED terminal record', async () => {
    const { ProductionJob } = await import('../src/orchestrator/ProductionJob.mjs')

    const article = { title: 'Quarantine test', category: 'tech' }
    const job = new ProductionJob(article, { outDir: tmpDir, checkpointDir: tmpDir })

    // DISCOVER: permanent failure
    job.onStage('DISCOVER', async () => {
      const err = new Error('unauthorized')
      err.status = 401
      throw err
    })

    await job.run()
    const trace = job.store.getTrace()
    const quarantined = trace.filter(r => r.stage === 'DISCOVER' && r.status === 'QUARANTINED')

    assert.ok(quarantined.length >= 1, 'DISCOVER must have QUARANTINED record')

    job.cleanup()
  })
})

// ──────────────────────────────────────────────────────────────────
// 2. Failure classification
// ──────────────────────────────────────────────────────────────────
describe('FailureClass: extended classification', () => {
  it('includes DEPENDENCY and CONFIGURATION', async () => {
    const { FailureClass } = await import('../src/orchestrator/Stages.mjs')
    assert.equal(FailureClass.DEPENDENCY, 'DEPENDENCY')
    assert.equal(FailureClass.CONFIGURATION, 'CONFIGURATION')
  })

  it('classifyError detects DEPENDENCY errors', async () => {
    const { classifyError, FailureClass, getStage } = await import('../src/orchestrator/Stages.mjs')
    const stage = getStage('UPLOAD')
    const err = new Error('UPLOAD_REQUIRES_THUMBNAIL dependency failed')
    assert.equal(classifyError(err, stage), FailureClass.DEPENDENCY)
  })

  it('classifyError detects CONFIGURATION errors', async () => {
    const { classifyError, FailureClass, getStage } = await import('../src/orchestrator/Stages.mjs')
    const stage = getStage('UPLOAD')
    const err = new Error('missing env var YOUTUBE_REFRESH_TOKEN')
    assert.equal(classifyError(err, stage), FailureClass.CONFIGURATION)
  })
})

// ──────────────────────────────────────────────────────────────────
// 3. Checkpoint persistence
// ──────────────────────────────────────────────────────────────────
describe('CheckpointStore: trace persistence', () => {
  it('persists stageTrace in checkpoint file', async () => {
    const { CheckpointStore } = await import('../src/orchestrator/CheckpointStore.mjs')
    const store = new CheckpointStore('test-persist', tmpDir)

    store.appendTrace({ jobId: 'test-persist', stage: 'DISCOVER', attempt: 0, status: 'RUNNING' })
    store.appendTrace({ jobId: 'test-persist', stage: 'DISCOVER', attempt: 0, status: 'SUCCEEDED', durationMs: 100 })

    const data = JSON.parse(readFileSync(join(tmpDir, 'test-persist.json'), 'utf-8'))
    assert.ok(Array.isArray(data.stageTrace), 'checkpoint must have stageTrace array')
    assert.equal(data.stageTrace.length, 2, 'stageTrace must have 2 records')

    // Reload and verify
    const reloaded = new CheckpointStore('test-persist', tmpDir)
    const trace = reloaded.getTrace()
    assert.equal(trace.length, 2)
    assert.equal(trace[0].status, 'RUNNING')
    assert.equal(trace[1].status, 'SUCCEEDED')
  })

  it('getStageTrace filters by stage', async () => {
    const { CheckpointStore } = await import('../src/orchestrator/CheckpointStore.mjs')
    const store = new CheckpointStore('test-filter', tmpDir)

    store.appendTrace({ jobId: 'test-filter', stage: 'DISCOVER', attempt: 0, status: 'RUNNING' })
    store.appendTrace({ jobId: 'test-filter', stage: 'RENDER', attempt: 0, status: 'RUNNING' })
    store.appendTrace({ jobId: 'test-filter', stage: 'DISCOVER', attempt: 0, status: 'SUCCEEDED' })

    const discoverTrace = store.getStageTrace('DISCOVER')
    assert.equal(discoverTrace.length, 2)
    assert.ok(discoverTrace.every(r => r.stage === 'DISCOVER'))
  })
})

// ──────────────────────────────────────────────────────────────────
// 4. PublishabilityGate
// ──────────────────────────────────────────────────────────────────
describe('PublishabilityGate: evaluation', () => {
  it('rejects empty results', async () => {
    const { PublishabilityGate } = await import('../src/orchestrator/PublishabilityGate.mjs')
    const gate = new PublishabilityGate()
    const result = gate.evaluate({})

    assert.equal(result.valid, false)
    assert.ok(result.missing.includes('video'))
    assert.ok(result.missing.includes('thumbnail'))
    assert.ok(result.missing.includes('c2pa'))
    assert.ok(result.missing.includes('uniqueness'))
    assert.ok(result.missing.includes('upload'))
  })

  it('passes when all stages succeeded', async () => {
    const { PublishabilityGate } = await import('../src/orchestrator/PublishabilityGate.mjs')
    const gate = new PublishabilityGate()
    const result = gate.evaluate({
      RENDER: { engine: {} },
      THUMBNAIL: { selected: { path: '/tmp/thumb.png' } },
      C2PA: { signed: true, path: '/tmp/signed.png' },
      UNIQUENESS: { pass: true },
      UPLOAD: { videoId: 'abc123' },
    })

    assert.equal(result.valid, true)
    assert.deepEqual(result.missing, [])
  })

  it('rejects when upload missing', async () => {
    const { PublishabilityGate } = await import('../src/orchestrator/PublishabilityGate.mjs')
    const gate = new PublishabilityGate()
    const result = gate.evaluate({
      RENDER: { engine: {} },
      THUMBNAIL: { selected: { path: '/tmp/thumb.png' } },
      C2PA: { signed: true, path: '/tmp/signed.png' },
      UNIQUENESS: { pass: true },
      UPLOAD: null,
    })

    assert.equal(result.valid, false)
    assert.deepEqual(result.missing, ['upload'])
  })

  it('rejects when thumbnail missing', async () => {
    const { PublishabilityGate } = await import('../src/orchestrator/PublishabilityGate.mjs')
    const gate = new PublishabilityGate()
    const result = gate.evaluate({
      RENDER: { engine: {} },
      THUMBNAIL: { selected: null },
      C2PA: { signed: true, path: '/tmp/signed.png' },
      UNIQUENESS: { pass: true },
      UPLOAD: { videoId: 'abc123' },
    })

    assert.equal(result.valid, false)
    assert.deepEqual(result.missing, ['thumbnail'])
  })

  it('rejects when c2pa required but not signed', async () => {
    const { PublishabilityGate } = await import('../src/orchestrator/PublishabilityGate.mjs')
    const gate = new PublishabilityGate()
    const result = gate.evaluate({
      RENDER: { engine: {} },
      THUMBNAIL: { selected: { path: '/tmp/thumb.png' } },
      C2PA: { signed: false, path: null },
      UNIQUENESS: { pass: true },
      UPLOAD: { videoId: 'abc123' },
    })

    assert.equal(result.valid, false)
    assert.deepEqual(result.missing, ['c2pa'])
  })

  it('accepts skipped c2pa (not required)', async () => {
    const { PublishabilityGate } = await import('../src/orchestrator/PublishabilityGate.mjs')
    const gate = new PublishabilityGate()
    const result = gate.evaluate({
      RENDER: { engine: {} },
      THUMBNAIL: { selected: { path: '/tmp/thumb.png' } },
      C2PA: { skipped: true },
      UNIQUENESS: { pass: true },
      UPLOAD: { videoId: 'abc123' },
    })

    assert.equal(result.valid, true)
  })

  it('rejects when uniqueness failed', async () => {
    const { PublishabilityGate } = await import('../src/orchestrator/PublishabilityGate.mjs')
    const gate = new PublishabilityGate()
    const result = gate.evaluate({
      RENDER: { engine: {} },
      THUMBNAIL: { selected: { path: '/tmp/thumb.png' } },
      C2PA: { signed: true, path: '/tmp/signed.png' },
      UNIQUENESS: { pass: false, violations: [{ type: 'DUPLICATE' }] },
      UPLOAD: { videoId: 'abc123' },
    })

    assert.equal(result.valid, false)
    assert.deepEqual(result.missing, ['uniqueness'])
  })

  it('rejects when upload blocked by governor', async () => {
    const { PublishabilityGate } = await import('../src/orchestrator/PublishabilityGate.mjs')
    const gate = new PublishabilityGate()
    const result = gate.evaluate({
      RENDER: { engine: {} },
      THUMBNAIL: { selected: { path: '/tmp/thumb.png' } },
      C2PA: { signed: true, path: '/tmp/signed.png' },
      UNIQUENESS: { pass: true },
      UPLOAD: { blocked: true, reason: 'quota exceeded' },
    })

    assert.equal(result.valid, false)
    assert.deepEqual(result.missing, ['upload'])
  })

  it('result has timestamp', async () => {
    const { PublishabilityGate } = await import('../src/orchestrator/PublishabilityGate.mjs')
    const gate = new PublishabilityGate()
    const result = gate.evaluate({})

    assert.ok(result.timestamp, 'result must have timestamp')
    assert.ok(!isNaN(Date.parse(result.timestamp)), 'timestamp must be valid ISO')
  })
})

// ──────────────────────────────────────────────────────────────────
// 5. Integration: gate blocks PUBLISH in orchestrator
// ──────────────────────────────────────────────────────────────────
describe('PublishabilityGate: orchestrator integration', () => {
  it('PUBLISH stage fails when gate check fails', async () => {
    const { ProductionJob } = await import('../src/orchestrator/ProductionJob.mjs')
    const { PublishabilityGate, ProductionError } = await import('../src/orchestrator/PublishabilityGate.mjs')

    const article = { title: 'Gate test', category: 'tech' }
    const job = new ProductionJob(article, { outDir: tmpDir, checkpointDir: tmpDir })

    job.onStage('DISCOVER', async () => ({ plan: {} }))
    job.onStage('RENDER', async () => ({ engine: {} }))
    job.onStage('THUMBNAIL', async () => ({ selected: null }))
    job.onStage('C2PA', async () => ({ skipped: true }))
    job.onStage('UNIQUENESS', async () => ({ pass: true }))
    job.onStage('UPLOAD', async () => ({ videoId: null }))  // no videoId
    job.onStage('PUBLISH', async (ctx) => {
      const gate = new PublishabilityGate()
      const result = gate.evaluate(ctx.results)
      if (!result.valid) throw new ProductionError('PUBLISHABILITY_GATE_FAILED', result.missing)
      return { published: true }
    })

    const runResult = await job.run()
    assert.equal(runResult.success, false, 'job must fail when PUBLISH gate fails')
    assert.ok(runResult.quarantineReason.includes('PUBLISH'), 'quarantine reason must mention PUBLISH')

    job.cleanup()
  })
})
