import { describe, it, before } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { ProductionHistoryReader } from '../src/orchestrator/ProductionHistoryReader.mjs'
import { CapacityEvidenceCollector } from '../src/orchestrator/CapacityEvidenceCollector.mjs'

describe('ProductionHistoryReader', () => {
  it('reads production jobs from data directory', () => {
    const reader = new ProductionHistoryReader()
    const { jobs, summary } = reader.readProductionJobs()

    assert.ok(Array.isArray(jobs), 'jobs should be an array')
    assert.ok(typeof summary === 'object', 'summary should be an object')
    assert.ok(summary.total >= 0, 'total should be non-negative')
  })

  it('reads pipeline events and computes stage timings', () => {
    const reader = new ProductionHistoryReader()
    const { events, stageTimings } = reader.readPipelineEvents()

    assert.ok(Array.isArray(events), 'events should be an array')
    assert.ok(typeof stageTimings === 'object', 'stageTimings should be an object')

    // If events exist, render timing should be computed
    if (events.length > 0 && stageTimings.render) {
      assert.ok(stageTimings.render.source === 'observed', 'render timing should be observed')
      assert.ok(typeof stageTimings.render.p50Ms === 'number', 'p50 should be a number')
      assert.ok(typeof stageTimings.render.p95Ms === 'number', 'p95 should be a number')
    }
  })

  it('reads publish events and counts real videos', () => {
    const reader = new ProductionHistoryReader()
    const { events, daily, totalReal } = reader.readPublishEvents()

    assert.ok(Array.isArray(events), 'events should be an array')
    assert.ok(typeof daily === 'object', 'daily should be an object')
    assert.ok(typeof totalReal === 'number', 'totalReal should be a number')
    assert.ok(totalReal >= 0, 'totalReal should be non-negative')
  })

  it('reads asset registry', () => {
    const reader = new ProductionHistoryReader()
    const registry = reader.readAssetRegistry()

    assert.ok(typeof registry === 'object', 'registry should be an object')
    assert.ok(typeof registry.scripts === 'number', 'scripts should be a number')
    assert.ok(typeof registry.images === 'number', 'images should be a number')
    assert.ok(typeof registry.music === 'number', 'music should be a number')
  })

  it('reads batch outputs', () => {
    const reader = new ProductionHistoryReader()
    const batches = reader.readBatchOutputs()

    assert.ok(typeof batches === 'object', 'batches should be an object')
    assert.ok(typeof batches.batchCount === 'number', 'batchCount should be a number')
    assert.ok(typeof batches.finalMp4Count === 'number', 'finalMp4Count should be a number')
  })

  it('produces complete history report', () => {
    const reader = new ProductionHistoryReader()
    const report = reader.collect()

    assert.ok(report.window, 'should have window')
    assert.ok(report.throughput, 'should have throughput')
    assert.ok(report.timing, 'should have timing')
    assert.ok(report.resources, 'should have resources')
    assert.ok(report.failures, 'should have failures')
    assert.ok(report._sources, 'should have _sources')

    // Classifications
    assert.ok(report.throughput.completed !== undefined, 'completed should be defined')
    assert.ok(report.throughput.videosPerDay !== undefined, 'videosPerDay should be defined')
  })

  it('uses temp dir with no data gracefully', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'phr-test-'))
    try {
      const reader = new ProductionHistoryReader({ dataDir: tmpDir, outputDir: tmpDir })
      const report = reader.collect()

      assert.equal(report.throughput.completed, 0)
      assert.equal(report.throughput.videosPerDay, 0)
      assert.equal(report.resources.assets.scripts, 0)
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true })
    }
  })
})

describe('CapacityEvidenceCollector', () => {
  it('collects complete evidence report', () => {
    const collector = new CapacityEvidenceCollector()
    const evidence = collector.collect()

    assert.ok(evidence.collectedAt, 'should have collectedAt timestamp')
    assert.ok(evidence.window, 'should have window')
    assert.ok(evidence.throughput, 'should have throughput')
    assert.ok(evidence.timing, 'should have timing')
    assert.ok(evidence.providers, 'should have providers')
    assert.ok(evidence.uniqueness, 'should have uniqueness')
    assert.ok(evidence.scheduler, 'should have scheduler')
    assert.ok(evidence.ai, 'should have ai')
    assert.ok(evidence.capacity, 'should have capacity')
    assert.ok(evidence.failures, 'should have failures')
    assert.ok(evidence._sources, 'should have _sources')
  })

  it('provider evidence has all providers', () => {
    const collector = new CapacityEvidenceCollector()
    const evidence = collector.collect()

    const expected = ['youtube', 'elevenlabs', 'pexels', 'newsapi', 'rapidnews', 'gemini']
    for (const p of expected) {
      assert.ok(evidence.providers[p], `should have ${p} provider`)
      assert.ok(typeof evidence.providers[p].dailyLimit === 'number', `${p} should have dailyLimit`)
      assert.ok(typeof evidence.providers[p].theoreticalMaxPerDay === 'number', `${p} should have theoreticalMaxPerDay`)
    }
  })

  it('uniqueness evidence identifies script gap', () => {
    const collector = new CapacityEvidenceCollector()
    const evidence = collector.collect()

    const scriptGate = evidence.uniqueness.gates['script-within-video']
    assert.ok(scriptGate, 'should have script-within-video gate')
    assert.equal(scriptGate.enforcement, 'NOT_ENFORCED', 'script gate should be NOT_ENFORCED')
    assert.ok(scriptGate.note.includes('not wired'), 'should note that it is not wired')
  })

  it('capacity model has three capacity values', () => {
    const collector = new CapacityEvidenceCollector()
    const evidence = collector.collect()

    assert.ok(typeof evidence.capacity.theoreticalCapacity === 'number', 'theoretical should be a number')
    assert.ok(typeof evidence.capacity.demonstratedCapacity === 'number', 'demonstrated should be a number')
    assert.ok(typeof evidence.capacity.safeCapacity === 'number', 'safe should be a number')
    assert.ok(evidence.capacity.bottleneck, 'should identify bottleneck')
    assert.ok(Array.isArray(evidence.capacity.limits), 'limits should be an array')
  })

  it('safe capacity <= theoretical capacity', () => {
    const collector = new CapacityEvidenceCollector()
    const evidence = collector.collect()

    assert.ok(
      evidence.capacity.safeCapacity <= evidence.capacity.theoreticalCapacity,
      `safe (${evidence.capacity.safeCapacity}) should be <= theoretical (${evidence.capacity.theoreticalCapacity})`
    )
  })

  it('reports 48-day achievable status', () => {
    const collector = new CapacityEvidenceCollector()
    const evidence = collector.collect()

    assert.ok(typeof evidence.capacity.achievable48 === 'boolean', 'achievable48 should be boolean')
    // Whether true or false, it must match the safe capacity calculation
    assert.equal(
      evidence.capacity.achievable48,
      evidence.capacity.safeCapacity >= 48,
      'achievable48 should match safeCapacity >= 48'
    )
  })

  it('uses temp dir with no data gracefully', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cec-test-'))
    try {
      const collector = new CapacityEvidenceCollector({ dataDir: tmpDir, outputDir: tmpDir })
      const evidence = collector.collect()

      assert.equal(evidence.throughput.completed, 0)
      assert.equal(evidence.capacity.demonstratedCapacity, 0)
      assert.ok(evidence.capacity.theoreticalCapacity >= 0, 'theoretical should be non-negative')
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true })
    }
  })
})
