import { describe, it, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

/**
 * Phase 1 acceptance criteria — the deterministic gating contract.
 *
 * Covers the criteria that the trace-invariant suite does not:
 *   - PUBLISH cannot execute when any publishability predicate is false
 *   - the trace records the exact failed predicate
 *   - the trace survives a real process restart
 *   - no provider-specific logic inside the gate
 *   - the recorder is the only trace writer (no second state store)
 */

const REPO = new URL('..', import.meta.url).pathname

let tmpDir
beforeEach(() => { tmpDir = mkdtempSync(join(tmpdir(), 'phase1-')) })
afterEach(() => { rmSync(tmpDir, { recursive: true, force: true }) })

const completeResults = () => ({
  RENDER: { engine: {} },
  THUMBNAIL: { selected: { path: '/tmp/thumbnail.png' } },
  C2PA: { signed: true, path: '/tmp/thumbnail.png' },
  UNIQUENESS: { pass: true },
  UPLOAD: { videoId: 'abc123' },
})

// ──────────────────────────────────────────────────────────────────
// PUBLISH is not executed when the gate fails
// ──────────────────────────────────────────────────────────────────
describe('Publishability gating: PUBLISH cannot execute on a false predicate', () => {
  /** Wire a job the way composer.mjs does: gate as precondition, not in-handler. */
  async function gatedJob(article, stageResults, { onPublish } = {}) {
    const { ProductionJob } = await import('../src/orchestrator/ProductionJob.mjs')
    const { STAGES } = await import('../src/orchestrator/Stages.mjs')
    const { PublishabilityGate } = await import('../src/orchestrator/PublishabilityGate.mjs')

    const job = new ProductionJob(article, { outDir: tmpDir, checkpointDir: tmpDir })
    const gate = new PublishabilityGate()
    job.onPrecondition('PUBLISH', (ctx) => gate.evaluate(ctx.results))

    for (const s of STAGES) {
      job.onStage(s.id, async () => {
        if (s.id === 'PUBLISH') { onPublish?.(); return { published: true } }
        return stageResults[s.id] ?? { ok: true }
      })
    }
    return { job, STAGES }
  }

  it('does not invoke the PUBLISH handler when upload is missing', async () => {
    let publishRan = false
    const results = completeResults()
    delete results.UPLOAD

    const { job } = await gatedJob({ title: 'no upload', category: 'tech' }, results, { onPublish: () => { publishRan = true } })
    const outcome = await job.run()

    assert.equal(publishRan, false, 'PUBLISH handler must never be invoked')
    assert.equal(outcome.success, false)
    assert.equal(outcome.lastStage, 'PUBLISH')
    job.cleanup()
  })

  it('records the exact failed predicates, not just an error string', async () => {
    const results = completeResults()
    delete results.UPLOAD
    delete results.C2PA

    const { job } = await gatedJob({ title: 'two predicates', category: 'tech' }, results)
    await job.run()

    const blocked = job.store.getStageTrace('PUBLISH').find(r => r.status === 'QUARANTINED')
    assert.ok(blocked, 'blocked PUBLISH must be traced')
    assert.deepEqual(blocked.metadata.failedPredicates, ['c2pa', 'upload'], 'trace must name every failed predicate')
    assert.equal(blocked.metadata.handlerInvoked, false, 'trace must state the handler never ran')
    assert.equal(blocked.errorClassification, 'DEPENDENCY', 'gate failure is a normalized classification, not a raw string')

    // Per-check reasons ride along so the failure is diagnosable from the trace alone.
    assert.equal(blocked.metadata.checks.upload.pass, false)
    assert.equal(typeof blocked.metadata.checks.upload.reason, 'string')
    job.cleanup()
  })

  it('emits no RUNNING record for a stage that never executed', async () => {
    const results = completeResults()
    delete results.UPLOAD

    const { job } = await gatedJob({ title: 'no running', category: 'tech' }, results)
    await job.run()

    const publishTrace = job.store.getStageTrace('PUBLISH')
    assert.equal(publishTrace.filter(r => r.status === 'RUNNING').length, 0, 'a non-executed stage must not report RUNNING')
    assert.equal(publishTrace.length, 1, 'exactly one record: the block')
    job.cleanup()
  })

  it('executes PUBLISH when every predicate holds', async () => {
    let publishRan = false
    const { job } = await gatedJob({ title: 'all pass', category: 'tech' }, completeResults(), { onPublish: () => { publishRan = true } })
    const outcome = await job.run()

    assert.equal(publishRan, true, 'PUBLISH must run when the gate passes')
    assert.equal(outcome.success, true)

    const publishTrace = job.store.getStageTrace('PUBLISH')
    assert.ok(publishTrace.some(r => r.status === 'RUNNING'))
    assert.ok(publishTrace.some(r => r.status === 'SUCCEEDED'))
    job.cleanup()
  })

  it('a gate failure does not retry — the predicate will not change on its own', async () => {
    let publishAttempts = 0
    const results = completeResults()
    delete results.UPLOAD

    const { job } = await gatedJob({ title: 'no retry', category: 'tech' }, results, { onPublish: () => { publishAttempts++ } })
    await job.run()

    assert.equal(publishAttempts, 0)
    assert.equal(job.store.getStageTrace('PUBLISH').length, 1, 'blocked stage must not produce retry attempts')
    job.cleanup()
  })

  it('preconditions are policy-free in the job — the validator supplies the predicate', async () => {
    const { ProductionJob } = await import('../src/orchestrator/ProductionJob.mjs')
    const { STAGES } = await import('../src/orchestrator/Stages.mjs')

    // An arbitrary non-publish predicate proves the mechanism is generic.
    const job = new ProductionJob({ title: 'generic precondition', category: 'tech' }, { outDir: tmpDir, checkpointDir: tmpDir })
    let ran = false
    job.onPrecondition('VERIFY', () => ({ valid: false, missing: ['arbitrary-predicate'] }))
    for (const s of STAGES) job.onStage(s.id, async () => { if (s.id === 'VERIFY') ran = true; return { ok: true } })

    await job.run()
    assert.equal(ran, false)
    const blocked = job.store.getStageTrace('VERIFY').find(r => r.status === 'QUARANTINED')
    assert.deepEqual(blocked.metadata.failedPredicates, ['arbitrary-predicate'])
    job.cleanup()
  })
})

// ──────────────────────────────────────────────────────────────────
// Durability across a real process boundary
// ──────────────────────────────────────────────────────────────────
describe('Trace durability: survives process restart', () => {
  it('a second OS process reads the trace written by the first', async () => {
    const article = JSON.stringify({ title: 'restart durability', category: 'tech' })

    // Process 1: run until UPLOAD quarantines, then exit.
    const writer = `
      import { ProductionJob } from '${REPO}src/orchestrator/ProductionJob.mjs'
      import { STAGES } from '${REPO}src/orchestrator/Stages.mjs'
      const job = new ProductionJob(${article}, { outDir: '${tmpDir}', checkpointDir: '${tmpDir}' })
      for (const s of STAGES) job.onStage(s.id, async () => {
        if (s.id === 'UPLOAD') throw new Error('invalid_grant auth failure')
        if (s.id === 'RENDER') return { engine: { finalPath: '${tmpDir}/final.mp4' } }
        return { ok: true }
      })
      await job.run()
      console.log(JSON.stringify({ jobId: job.jobId, records: job.store.getTrace().length }))
    `
    const writerPath = join(tmpDir, 'writer.mjs')
    writeFileSync(writerPath, writer)
    const written = JSON.parse(execFileSync('node', [writerPath], { encoding: 'utf-8' }).trim().split('\n').pop())
    assert.ok(written.records > 0, 'first process wrote trace records')

    // Process 2: fresh runtime, no shared memory — read the trace back.
    const reader = `
      import { CheckpointStore } from '${REPO}src/orchestrator/CheckpointStore.mjs'
      const store = new CheckpointStore('${written.jobId}', '${tmpDir}')
      const trace = store.getTrace()
      console.log(JSON.stringify({
        records: trace.length,
        quarantined: trace.filter(r => r.status === 'QUARANTINED').map(r => r.stage),
        classifications: [...new Set(trace.map(r => r.errorClassification).filter(Boolean))],
        artifacts: Object.keys(store.getArtifacts()),
      }))
    `
    const readerPath = join(tmpDir, 'reader.mjs')
    writeFileSync(readerPath, reader)
    const readBack = JSON.parse(execFileSync('node', [readerPath], { encoding: 'utf-8' }).trim())

    assert.equal(readBack.records, written.records, 'every record survived the restart')
    assert.ok(readBack.quarantined.includes('UPLOAD'), 'the failure is still attributable after restart')
    assert.ok(readBack.classifications.length > 0, 'normalized classifications survived')
    assert.ok(readBack.artifacts.includes('RENDER'), 'artifact index survived')
  })

  it('the trace lives in the checkpoint file — no second state store', async () => {
    const { ProductionJob } = await import('../src/orchestrator/ProductionJob.mjs')
    const { STAGES } = await import('../src/orchestrator/Stages.mjs')

    const job = new ProductionJob({ title: 'single store', category: 'tech' }, { outDir: tmpDir, checkpointDir: tmpDir })
    for (const s of STAGES) job.onStage(s.id, async () => ({ ok: true }))
    await job.run()

    const onDisk = JSON.parse(readFileSync(job.store.filePath, 'utf-8'))
    assert.ok(onDisk.stages, 'checkpoint')
    assert.ok(Array.isArray(onDisk.stageTrace), 'stageTrace[]')
    assert.ok('artifacts' in onDisk || onDisk.stageTrace.length > 0, 'artifacts')

    // The recorder must not have opened a file of its own.
    const strays = execFileSync('find', [tmpDir, '-name', '*.json'], { encoding: 'utf-8' })
      .trim().split('\n').filter(Boolean)
    assert.equal(strays.length, 1, `expected exactly one state file, found: ${strays.join(', ')}`)
    job.cleanup()
  })
})

// ──────────────────────────────────────────────────────────────────
// Gate purity
// ──────────────────────────────────────────────────────────────────
describe('PublishabilityGate: no provider-specific logic', () => {
  it('the gate source names no provider', async () => {
    const src = readFileSync(join(REPO, 'src/orchestrator/PublishabilityGate.mjs'), 'utf-8')
    for (const provider of ['youtube', 'linkedin', 'elevenlabs', 'openai', 'anthropic', 'tiktok', 'instagram']) {
      assert.ok(!new RegExp(provider, 'i').test(src), `gate must not reference provider "${provider}"`)
    }
  })

  it('the gate imports nothing from providers, publishers, or apps', async () => {
    const src = readFileSync(join(REPO, 'src/orchestrator/PublishabilityGate.mjs'), 'utf-8')
    const imports = [...src.matchAll(/from\s+['"]([^'"]+)['"]/g)].map(m => m[1])
    for (const spec of imports) {
      assert.ok(
        !/publisher|provider|apps\//i.test(spec),
        `gate must stay policy-only, found import of "${spec}"`
      )
    }
    assert.deepEqual(imports, ['./Stages.mjs'], 'gate depends only on the stage vocabulary')
  })

  it('evaluates purely from stage results — no env, no filesystem', async () => {
    const { PublishabilityGate } = await import('../src/orchestrator/PublishabilityGate.mjs')
    const src = readFileSync(join(REPO, 'src/orchestrator/PublishabilityGate.mjs'), 'utf-8')
    assert.ok(!/process\.env/.test(src), 'gate must not branch on environment')
    assert.ok(!/existsSync|readFile/.test(src), 'gate must not touch the filesystem')

    // Same input → same verdict, regardless of ambient state.
    const gate = new PublishabilityGate()
    const a = gate.evaluate(completeResults())
    const b = gate.evaluate(completeResults())
    assert.deepEqual(a.checks, b.checks)
    assert.deepEqual(a.missing, b.missing)
    assert.equal(a.valid, b.valid)
  })
})

// ──────────────────────────────────────────────────────────────────
// Recorder boundary
// ──────────────────────────────────────────────────────────────────
describe('StageTraceRecorder: owns record shape, not lifecycle', () => {
  it('produces the target schema', async () => {
    const { StageTraceRecorder } = await import('../src/orchestrator/StageTraceRecorder.mjs')
    const { CheckpointStore } = await import('../src/orchestrator/CheckpointStore.mjs')

    const store = new CheckpointStore('job-schema', tmpDir)
    const recorder = new StageTraceRecorder('job-schema', store, { outDir: tmpDir })
    const started = new Date(Date.now() - 250).toISOString()
    const record = recorder.succeeded('RENDER', 0, started, 250, { engine: { finalPath: `${tmpDir}/final.mp4` } })

    for (const field of ['jobId', 'stage', 'attempt', 'startedAt', 'completedAt', 'status', 'durationMs', 'artifactIds', 'errorClassification']) {
      assert.ok(field in record, `record must expose ${field}`)
    }
    assert.equal(record.startedAt, started, 'recorder must not invent a start time')
    assert.equal(new Date(record.completedAt) - new Date(record.startedAt), 250)
    assert.deepEqual(record.artifactIds, [`video:${tmpDir}/final.mp4`])
  })

  it('exposes no lifecycle decisions', async () => {
    const { StageTraceRecorder } = await import('../src/orchestrator/StageTraceRecorder.mjs')
    const api = Object.getOwnPropertyNames(StageTraceRecorder.prototype)

    // The recorder describes; it must not decide whether to retry or quarantine.
    for (const forbidden of ['retry', 'shouldRetry', 'execute', 'run', 'markStart', 'markDone']) {
      assert.ok(!api.includes(forbidden), `recorder must not expose ${forbidden}()`)
    }
  })

  it('ProductionJob writes trace only through the recorder', async () => {
    const src = readFileSync(join(REPO, 'src/orchestrator/ProductionJob.mjs'), 'utf-8')
    assert.ok(!/this\.store\.appendTrace/.test(src), 'job must not write trace records directly')
    assert.ok(/this\.trace\./.test(src), 'job must delegate to the recorder')

    // No remnants of the pre-recorder trace path.
    assert.ok(!/_trace\s*\(/.test(src), 'obsolete _trace() path must be gone')
    assert.ok(!/_artifactsFor/.test(src), 'obsolete _artifactsFor() path must be gone')
  })

  it('artifact identity lives only in the recorder', async () => {
    const job = readFileSync(join(REPO, 'src/orchestrator/ProductionJob.mjs'), 'utf-8')
    const recorder = readFileSync(join(REPO, 'src/orchestrator/StageTraceRecorder.mjs'), 'utf-8')

    // The regression this guards: an artifact-extraction copy left behind in
    // the job, so `video:`/`thumbnail:` id construction lived in two places.
    assert.ok(/video:/.test(recorder), 'recorder builds artifact ids')
    assert.ok(!/`video:|`thumbnail:|`c2pa:/.test(job), 'job must not construct artifact ids')
    assert.ok(!/_extractArtifactIds/.test(job), 'job must not carry an artifact-extraction shim')
  })

  it('no orchestrator class defines the same method twice', async () => {
    // A duplicate definition silently wins over the earlier one, so a stale
    // copy can shadow a delegating method and pass every behavioural test.
    const files = execFileSync('find', [join(REPO, 'src/orchestrator'), '-name', '*.mjs'], { encoding: 'utf-8' })
      .trim().split('\n').filter(Boolean)

    for (const file of files) {
      const seen = new Map()
      for (const [, name] of readFileSync(file, 'utf-8').matchAll(/^ {2}(?:async\s+)?([A-Za-z_][\w]*)\s*\(/gm)) {
        if (['if', 'for', 'while', 'switch', 'catch', 'return'].includes(name)) continue
        seen.set(name, (seen.get(name) || 0) + 1)
      }
      const dupes = [...seen].filter(([, n]) => n > 1).map(([name]) => name)
      assert.deepEqual(dupes, [], `${file.split('/').pop()}: duplicate method definition(s): ${dupes.join(', ')}`)
    }
  })
})
