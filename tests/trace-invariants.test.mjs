import { describe, it, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

/**
 * Phase 1 hardening — telemetry invariants the trace must never violate.
 *
 * trace-and-gate.test.mjs proves records exist. This file proves they are
 * *sound*: one terminal record per attempt, honest timestamps, no holes for
 * non-executing stages, and real artifact provenance for RENDER/THUMBNAIL.
 */

const TERMINAL = new Set(['SUCCEEDED', 'FAILED', 'SKIPPED', 'QUARANTINED'])

/** Assert the core invariant: RUNNING → exactly one terminal, per attempt. */
function assertOneTerminalPerAttempt(trace) {
  const byAttempt = new Map()
  for (const r of trace) {
    const key = `${r.stage}#${r.attempt}`
    if (!byAttempt.has(key)) byAttempt.set(key, [])
    byAttempt.get(key).push(r)
  }
  for (const [key, records] of byAttempt) {
    const terminals = records.filter(r => TERMINAL.has(r.status))
    assert.equal(
      terminals.length, 1,
      `${key}: expected exactly 1 terminal record, got ${terminals.length} (${terminals.map(t => t.status).join(', ')})`
    )
  }
  return byAttempt
}

let tmpDir
beforeEach(() => { tmpDir = mkdtempSync(join(tmpdir(), 'trace-inv-')) })
afterEach(() => { rmSync(tmpDir, { recursive: true, force: true }) })

// ──────────────────────────────────────────────────────────────────
// One terminal record per attempt
// ──────────────────────────────────────────────────────────────────
describe('Trace invariant: exactly one terminal record per attempt', () => {
  it('holds for an all-succeeding pipeline', async () => {
    const { ProductionJob } = await import('../src/orchestrator/ProductionJob.mjs')
    const { STAGES } = await import('../src/orchestrator/Stages.mjs')

    const job = new ProductionJob({ title: 'happy path', category: 'tech' }, { outDir: tmpDir, checkpointDir: tmpDir })
    for (const s of STAGES) job.onStage(s.id, async () => ({ ok: true }))
    await job.run()

    assertOneTerminalPerAttempt(job.store.getTrace())
    job.cleanup()
  })

  it('holds across retries — FAILED then SUCCEEDED on a later attempt', async () => {
    const { ProductionJob } = await import('../src/orchestrator/ProductionJob.mjs')
    const { STAGES } = await import('../src/orchestrator/Stages.mjs')

    const job = new ProductionJob({ title: 'retry then pass', category: 'tech' }, { outDir: tmpDir, checkpointDir: tmpDir })
    let calls = 0
    for (const s of STAGES) {
      if (s.id === 'RENDER') {
        job.onStage(s.id, async () => {
          calls++
          if (calls === 1) throw new Error('ETIMEDOUT transient blip')
          return { ok: true }
        })
      } else {
        job.onStage(s.id, async () => ({ ok: true }))
      }
    }
    await job.run()

    const trace = job.store.getTrace()
    assertOneTerminalPerAttempt(trace)

    const render = trace.filter(r => r.stage === 'RENDER')
    assert.equal(render.filter(r => r.status === 'FAILED').length, 1, 'attempt 0 must be FAILED')
    assert.equal(render.filter(r => r.status === 'SUCCEEDED').length, 1, 'attempt 1 must be SUCCEEDED')
    assert.equal(render.find(r => r.status === 'FAILED').attempt, 0)
    assert.equal(render.find(r => r.status === 'SUCCEEDED').attempt, 1)

    job.cleanup()
  })

  it('does not double-record the final attempt when retries are exhausted', async () => {
    const { ProductionJob } = await import('../src/orchestrator/ProductionJob.mjs')
    const { STAGES } = await import('../src/orchestrator/Stages.mjs')

    const job = new ProductionJob({ title: 'exhaust retries', category: 'tech' }, { outDir: tmpDir, checkpointDir: tmpDir })
    for (const s of STAGES) {
      job.onStage(s.id, async () => {
        if (s.id === 'RENDER') throw new Error('ETIMEDOUT always fails')
        return { ok: true }
      })
    }
    const result = await job.run()
    assert.equal(result.success, false)

    const trace = job.store.getTrace()
    // The regression this guards: the last attempt used to emit FAILED *and*
    // QUARANTINED, giving one attempt two terminal records.
    assertOneTerminalPerAttempt(trace)

    const render = trace.filter(r => r.stage === 'RENDER')
    const quarantined = render.filter(r => r.status === 'QUARANTINED')
    assert.equal(quarantined.length, 1, 'exactly one QUARANTINED record')
    assert.equal(quarantined[0].metadata.exhaustedRetries, true)

    const lastAttempt = Math.max(...render.map(r => r.attempt))
    assert.equal(quarantined[0].attempt, lastAttempt, 'quarantine belongs to the final attempt')

    job.cleanup()
  })

  it('every RUNNING record is followed by a terminal record for the same attempt', async () => {
    const { ProductionJob } = await import('../src/orchestrator/ProductionJob.mjs')
    const { STAGES } = await import('../src/orchestrator/Stages.mjs')

    const job = new ProductionJob({ title: 'pairing', category: 'tech' }, { outDir: tmpDir, checkpointDir: tmpDir })
    for (const s of STAGES) job.onStage(s.id, async () => ({ ok: true }))
    await job.run()

    const trace = job.store.getTrace()
    for (const running of trace.filter(r => r.status === 'RUNNING')) {
      const terminal = trace.find(r => r.stage === running.stage && r.attempt === running.attempt && TERMINAL.has(r.status))
      assert.ok(terminal, `${running.stage}#${running.attempt}: RUNNING with no terminal record`)
    }
    job.cleanup()
  })
})

// ──────────────────────────────────────────────────────────────────
// Timestamp honesty
// ──────────────────────────────────────────────────────────────────
describe('Trace invariant: timestamps describe the real attempt window', () => {
  it('startedAt is the attempt start, not the moment the record was written', async () => {
    const { ProductionJob } = await import('../src/orchestrator/ProductionJob.mjs')
    const { STAGES } = await import('../src/orchestrator/Stages.mjs')

    const job = new ProductionJob({ title: 'timing', category: 'tech' }, { outDir: tmpDir, checkpointDir: tmpDir })
    for (const s of STAGES) {
      job.onStage(s.id, async () => {
        if (s.id === 'RENDER') await new Promise(r => setTimeout(r, 60))
        return { ok: true }
      })
    }
    await job.run()

    const trace = job.store.getTrace()
    const running = trace.find(r => r.stage === 'RENDER' && r.status === 'RUNNING')
    const succeeded = trace.find(r => r.stage === 'RENDER' && r.status === 'SUCCEEDED')

    // The bug this guards: startedAt was stamped as "now" on the terminal
    // record, so a 60ms stage reported a zero-width window.
    assert.equal(succeeded.startedAt, running.startedAt, 'terminal record must reuse the attempt start')
    assert.ok(succeeded.durationMs >= 50, `durationMs should reflect the 60ms stage, got ${succeeded.durationMs}`)

    const span = new Date(succeeded.completedAt) - new Date(succeeded.startedAt)
    assert.ok(span >= 50, `completedAt - startedAt should span the work, got ${span}ms`)

    job.cleanup()
  })

  it('terminal records carry completedAt; RUNNING records do not', async () => {
    const { ProductionJob } = await import('../src/orchestrator/ProductionJob.mjs')
    const { STAGES } = await import('../src/orchestrator/Stages.mjs')

    const job = new ProductionJob({ title: 'completedAt', category: 'tech' }, { outDir: tmpDir, checkpointDir: tmpDir })
    for (const s of STAGES) job.onStage(s.id, async () => ({ ok: true }))
    await job.run()

    for (const r of job.store.getTrace()) {
      if (TERMINAL.has(r.status)) {
        assert.ok(r.completedAt, `${r.stage}#${r.attempt} ${r.status}: terminal record needs completedAt`)
        assert.ok(!Number.isNaN(Date.parse(r.completedAt)), `${r.stage}: completedAt must be a valid ISO date`)
      } else {
        assert.equal(r.completedAt, undefined, `${r.stage}: RUNNING must not have completedAt`)
      }
    }
    job.cleanup()
  })
})

// ──────────────────────────────────────────────────────────────────
// No holes: stages that do not execute are still traced
// ──────────────────────────────────────────────────────────────────
describe('Trace invariant: non-executing stages leave a record, not a hole', () => {
  it('a stage with no registered handler is traced SKIPPED', async () => {
    const { ProductionJob } = await import('../src/orchestrator/ProductionJob.mjs')

    const job = new ProductionJob({ title: 'no handlers', category: 'tech' }, { outDir: tmpDir, checkpointDir: tmpDir })
    job.onStage('DISCOVER', async () => ({ ok: true }))
    await job.run()

    const trace = job.store.getTrace()
    const renderTrace = trace.filter(r => r.stage === 'RENDER')
    assert.equal(renderTrace.length, 1, 'handler-less stage must still be traced')
    assert.equal(renderTrace[0].status, 'SKIPPED')
    assert.equal(renderTrace[0].metadata.reason, 'no handler registered')

    job.cleanup()
  })

  it('stages replayed from a checkpoint are traced SKIPPED', async () => {
    const { ProductionJob } = await import('../src/orchestrator/ProductionJob.mjs')
    const { STAGES } = await import('../src/orchestrator/Stages.mjs')

    const article = { title: 'resume trace', category: 'tech' }

    // First run: quarantine at UPLOAD so earlier stages persist as completed.
    const first = new ProductionJob(article, { outDir: tmpDir, checkpointDir: tmpDir })
    for (const s of STAGES) {
      first.onStage(s.id, async () => {
        if (s.id === 'UPLOAD') throw new Error('invalid_grant auth failure')
        return { ok: true }
      })
    }
    await first.run()

    // Force a replay from the top: DISCOVER is already complete, so the job
    // must record the skip rather than silently falling through.
    const second = new ProductionJob(article, { outDir: tmpDir, checkpointDir: tmpDir })
    let executed = 0
    for (const s of STAGES) second.onStage(s.id, async () => { executed++; return { ok: true } })
    await second.run(STAGES[0])

    const skipped = second.store.getStageTrace('DISCOVER').filter(r => r.status === 'SKIPPED')
    assert.equal(skipped.length, 1, 'replayed stage must be traced SKIPPED')
    assert.equal(skipped[0].metadata.reason, 'completed in previous run')
    assert.ok(executed < STAGES.length, 'completed stages must not re-execute')

    second.cleanup()
  })

  it('resuming past completed stages preserves their original trace records', async () => {
    const { ProductionJob } = await import('../src/orchestrator/ProductionJob.mjs')
    const { STAGES } = await import('../src/orchestrator/Stages.mjs')

    const article = { title: 'cumulative trace', category: 'tech' }

    const first = new ProductionJob(article, { outDir: tmpDir, checkpointDir: tmpDir })
    for (const s of STAGES) {
      first.onStage(s.id, async () => {
        if (s.id === 'UPLOAD') throw new Error('invalid_grant auth failure')
        return { ok: true }
      })
    }
    await first.run()
    const beforeResume = first.store.getStageTrace('DISCOVER').length
    assert.ok(beforeResume >= 2, 'first run traced DISCOVER')

    // A natural resume starts after the last completed stage, so DISCOVER is
    // never revisited. The audit history must survive in the job file anyway.
    const second = new ProductionJob(article, { outDir: tmpDir, checkpointDir: tmpDir })
    for (const s of STAGES) second.onStage(s.id, async () => ({ ok: true }))
    await second.run()

    const after = second.store.getStageTrace('DISCOVER')
    assert.equal(after.length, beforeResume, 'trace is append-only across runs, never truncated')
    assert.ok(after.some(r => r.status === 'SUCCEEDED'), 'original terminal record still present')

    second.cleanup()
  })

  it('a quota-blocked stage is traced with RATE_LIMITED classification', async () => {
    const { ProductionJob } = await import('../src/orchestrator/ProductionJob.mjs')
    const { STAGES } = await import('../src/orchestrator/Stages.mjs')
    const { FailureClass } = await import('../src/orchestrator/Stages.mjs')

    const blockedStage = STAGES.find(s => s.provider)
    assert.ok(blockedStage, 'fixture requires at least one provider-backed stage')

    const governor = {
      wasCompleted: () => null,
      canExecute: () => ({ allowed: false, reason: 'daily cap reached', nextEligibleAt: '2026-08-27T00:00:00.000Z' }),
      reserve: () => {},
      release: () => {},
    }

    const job = new ProductionJob({ title: 'quota blocked', category: 'tech' }, { outDir: tmpDir, checkpointDir: tmpDir, governor })
    for (const s of STAGES) job.onStage(s.id, async () => ({ ok: true }))
    const result = await job.run()

    assert.equal(result.waiting, true)
    const waitTrace = job.store.getStageTrace(blockedStage.id).filter(r => r.metadata?.waiting)
    assert.equal(waitTrace.length, 1, 'quota block must leave a trace record')
    assert.equal(waitTrace[0].status, 'SKIPPED')
    assert.equal(waitTrace[0].errorClassification, FailureClass.RATE_LIMITED)
    assert.equal(waitTrace[0].metadata.nextEligibleAt, '2026-08-27T00:00:00.000Z')

    job.cleanup()
  })
})

// ──────────────────────────────────────────────────────────────────
// Artifact provenance
// ──────────────────────────────────────────────────────────────────
describe('Trace invariant: canonical artifacts are attributed', () => {
  it('RENDER and THUMBNAIL record artifact ids for their real result shapes', async () => {
    const { ProductionJob } = await import('../src/orchestrator/ProductionJob.mjs')
    const { STAGES } = await import('../src/orchestrator/Stages.mjs')

    const job = new ProductionJob({ title: 'artifact shapes', category: 'tech' }, { outDir: tmpDir, checkpointDir: tmpDir })
    for (const s of STAGES) {
      job.onStage(s.id, async () => {
        // Shapes taken verbatim from scripts/composer.mjs.
        if (s.id === 'RENDER') return { engine: { finalPath: `${tmpDir}/final.mp4` }, renderTimeMs: 1234 }
        if (s.id === 'THUMBNAIL') return { candidates: [], selected: { path: `${tmpDir}/thumbnail.png`, width: 1280, height: 720 }, strategy: 'engine-generated' }
        if (s.id === 'UPLOAD') return { videoId: 'abc123' }
        return { ok: true }
      })
    }
    await job.run()

    const trace = job.store.getTrace()
    const render = trace.find(r => r.stage === 'RENDER' && r.status === 'SUCCEEDED')
    const thumb = trace.find(r => r.stage === 'THUMBNAIL' && r.status === 'SUCCEEDED')
    const upload = trace.find(r => r.stage === 'UPLOAD' && r.status === 'SUCCEEDED')

    // The gap this guards: RENDER returns {engine}, THUMBNAIL returns
    // {selected}, so the original path-only extractor recorded nothing for
    // exactly the two artifacts the publish gate depends on.
    assert.ok(render.artifactIds.some(id => id.startsWith('video:')), `RENDER must attribute a video artifact, got ${JSON.stringify(render.artifactIds)}`)
    assert.ok(thumb.artifactIds.some(id => id === `thumbnail:${tmpDir}/thumbnail.png`), `THUMBNAIL must attribute the selected thumbnail, got ${JSON.stringify(thumb.artifactIds)}`)
    assert.ok(upload.artifactIds.includes('youtube:abc123'))

    job.cleanup()
  })

  it('artifact ids are deduplicated', async () => {
    const { StageTraceRecorder } = await import('../src/orchestrator/StageTraceRecorder.mjs')
    const { CheckpointStore } = await import('../src/orchestrator/CheckpointStore.mjs')

    const recorder = new StageTraceRecorder('job-dedup', new CheckpointStore('job-dedup', tmpDir), { outDir: tmpDir })
    const ids = recorder.artifactIdsFor('RENDER', { videoPath: `${tmpDir}/final.mp4`, engine: { finalPath: `${tmpDir}/final.mp4` } })
    assert.deepEqual(ids, [`video:${tmpDir}/final.mp4`])
  })

  it('artifacts are indexed in the job file alongside checkpoint and trace', async () => {
    const { ProductionJob } = await import('../src/orchestrator/ProductionJob.mjs')
    const { STAGES } = await import('../src/orchestrator/Stages.mjs')

    const job = new ProductionJob({ title: 'artifact index', category: 'tech' }, { outDir: tmpDir, checkpointDir: tmpDir })
    for (const s of STAGES) {
      job.onStage(s.id, async () => {
        if (s.id === 'RENDER') return { engine: { finalPath: `${tmpDir}/final.mp4` } }
        if (s.id === 'THUMBNAIL') return { selected: { path: `${tmpDir}/thumbnail.png` } }
        return { ok: true }
      })
    }
    await job.run()

    const state = job.store.load()
    assert.ok(state.stages, 'job file holds the checkpoint')
    assert.ok(Array.isArray(state.stageTrace), 'job file holds stageTrace[]')
    assert.ok(state.artifacts, 'job file holds artifacts')

    const artifacts = job.store.getArtifacts()
    assert.ok(artifacts.RENDER?.ids?.length, 'RENDER artifacts indexed')
    assert.ok(artifacts.THUMBNAIL?.ids?.length, 'THUMBNAIL artifacts indexed')
    assert.ok(artifacts.RENDER.recordedAt, 'artifact entries are timestamped')

    // Ids only — never the raw stage result, which carries whole engine objects.
    assert.deepEqual(Object.keys(artifacts.RENDER).sort(), ['ids', 'recordedAt'])

    job.cleanup()
  })
})

// ──────────────────────────────────────────────────────────────────
// Gate matrix
// ──────────────────────────────────────────────────────────────────
describe('PublishabilityGate: input handling and determinism', () => {
  const complete = () => ({
    RENDER: { engine: {} },
    THUMBNAIL: { selected: { path: '/tmp/thumbnail.png' } },
    C2PA: { signed: true, path: '/tmp/thumbnail.png' },
    UNIQUENESS: { pass: true },
    UPLOAD: { videoId: 'abc123' },
  })

  it('accepts a raw results map', async () => {
    const { PublishabilityGate } = await import('../src/orchestrator/PublishabilityGate.mjs')
    const result = new PublishabilityGate().evaluate(complete())
    assert.equal(result.valid, true)
    assert.deepEqual(result.missing, [])
  })

  it('accepts a ProductionJob and reads its results', async () => {
    const { PublishabilityGate } = await import('../src/orchestrator/PublishabilityGate.mjs')
    const { ProductionJob } = await import('../src/orchestrator/ProductionJob.mjs')

    const job = new ProductionJob({ title: 'gate on job', category: 'tech' }, { outDir: tmpDir, checkpointDir: tmpDir })
    job.results = complete()

    const result = new PublishabilityGate().evaluate(job)
    assert.equal(result.valid, true, `gate must read job.results, got missing=${JSON.stringify(result.missing)}`)
    job.cleanup()
  })

  it('reports every failing check, not just the first', async () => {
    const { PublishabilityGate } = await import('../src/orchestrator/PublishabilityGate.mjs')
    const results = complete()
    delete results.UPLOAD
    delete results.THUMBNAIL

    const result = new PublishabilityGate().evaluate(results)
    assert.equal(result.valid, false)
    assert.deepEqual(result.missing, ['thumbnail', 'upload'], 'missing must be complete and in required-check order')
  })

  it('missing order is stable regardless of results key order', async () => {
    const { PublishabilityGate } = await import('../src/orchestrator/PublishabilityGate.mjs')
    const gate = new PublishabilityGate()

    const a = gate.evaluate({ UPLOAD: {}, RENDER: {} })
    const b = gate.evaluate({ RENDER: {}, UPLOAD: {} })
    assert.deepEqual(a.missing, b.missing, 'gate output must not depend on input key order')
  })

  it('every check exposes a machine-readable pass flag and a reason', async () => {
    const { PublishabilityGate } = await import('../src/orchestrator/PublishabilityGate.mjs')
    const result = new PublishabilityGate().evaluate({})

    for (const key of ['video', 'thumbnail', 'c2pa', 'uniqueness', 'upload']) {
      assert.equal(typeof result.checks[key].pass, 'boolean', `${key}.pass must be boolean`)
      assert.equal(typeof result.checks[key].reason, 'string', `${key}.reason must be a string`)
    }
    assert.equal(result.valid, false)
    assert.deepEqual(result.missing, ['video', 'thumbnail', 'c2pa', 'uniqueness', 'upload'])
  })

  it('an empty gate call never throws', async () => {
    const { PublishabilityGate } = await import('../src/orchestrator/PublishabilityGate.mjs')
    const gate = new PublishabilityGate()
    assert.equal(gate.evaluate().valid, false)
    assert.equal(gate.evaluate(null).valid, false)
    assert.equal(gate.evaluate({}).valid, false)
  })
})
