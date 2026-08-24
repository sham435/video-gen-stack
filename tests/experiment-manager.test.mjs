import assert from 'node:assert/strict'
import { describe, it, beforeEach, afterEach } from 'node:test'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { ExperimentManager } from '../src/experiment/ExperimentManager.mjs'

describe('ExperimentManager', () => {
  let tmpDir

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'experiment-test-'))
  })

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  describe('variant assignment', () => {
    it('assigns deterministic variant based on title', () => {
      const mgr = new ExperimentManager({ enabled: true, filePath: path.join(tmpDir, 'test.json') })
      const v1 = mgr.assignVariant('OpenAI announces GPT-5')
      const v2 = mgr.assignVariant('OpenAI announces GPT-5')
      assert.equal(v1.variant, v2.variant)
      assert.ok(v1.hash)
      assert.ok(typeof v1.bucket === 'number')
    })

    it('produces balanced distribution', () => {
      const mgr = new ExperimentManager({ enabled: true, filePath: path.join(tmpDir, 'test.json') })
      let control = 0, treatment = 0
      for (let i = 0; i < 200; i++) {
        const { variant } = mgr.assignVariant(`article-${i}`)
        if (variant === 'control') control++
        else treatment++
      }
      // ~50/50 with some tolerance
      assert.ok(control > 70 && control < 130, `control=${control} not balanced`)
      assert.ok(treatment > 70 && treatment < 130, `treatment=${treatment} not balanced`)
    })

    it('returns control when experiment disabled', () => {
      const mgr = new ExperimentManager({ enabled: false, filePath: path.join(tmpDir, 'test.json') })
      const v = mgr.assignVariant('any article')
      assert.equal(v.variant, 'control')
      assert.equal(v.reason, 'experiment_disabled')
    })

    it('shouldUseAI returns true only for treatment', () => {
      const mgr = new ExperimentManager({ enabled: true, filePath: path.join(tmpDir, 'test.json') })
      const titles = Array.from({ length: 100 }, (_, i) => `Test Article ${i}`)
      const aiCount = titles.filter(t => mgr.shouldUseAI(t)).length
      assert.ok(aiCount > 20 && aiCount < 80, `aiCount=${aiCount} not balanced`)
    })
  })

  describe('recordOutcome', () => {
    it('records a complete outcome', () => {
      const mgr = new ExperimentManager({ enabled: true, filePath: path.join(tmpDir, 'test.json') })
      const record = mgr.recordOutcome({
        experimentId: mgr.experimentId,
        variant: 'treatment',
        artifactId: 'vid-test-001',
        niche: 'AI',
        articleTitle: 'Test article',
        planSource: 'ai_optimized',
        hookStrategy: { style: 'reveal', source: 'ai_optimized' },
        aiProvider: 'Gemini',
        aiLatencyMs: 200,
        aiRecommendationsReceived: 2,
        aiRecommendationsAccepted: 1,
      })
      assert.equal(record.artifactId, 'vid-test-001')
      assert.equal(record.variant, 'treatment')
      assert.equal(record.aiProvider, 'Gemini')
      assert.equal(record.aiLatencyMs, 200)
    })

    it('throws on missing required fields', () => {
      const mgr = new ExperimentManager({ enabled: true, filePath: path.join(tmpDir, 'test.json') })
      assert.throws(() => mgr.recordOutcome({}), /missing experimentId/)
      assert.throws(() => mgr.recordOutcome({ experimentId: 'x' }), /missing variant/)
      assert.throws(() => mgr.recordOutcome({ experimentId: 'x', variant: 'control' }), /missing artifactId/)
    })

    it('persists to disk', () => {
      const filePath = path.join(tmpDir, 'test.json')
      const mgr = new ExperimentManager({ enabled: true, filePath })
      mgr.recordOutcome({ experimentId: 'exp-1', variant: 'control', artifactId: 'v1', niche: 'AI' })

      const mgr2 = new ExperimentManager({ enabled: true, filePath })
      assert.equal(mgr2._data.outcomes.length, 1)
      assert.equal(mgr2._data.outcomes[0].artifactId, 'v1')
    })
  })

  describe('updateAnalytics', () => {
    it('updates YouTube metrics for matching artifact', () => {
      const mgr = new ExperimentManager({ enabled: true, filePath: path.join(tmpDir, 'test.json') })
      mgr.recordOutcome({ experimentId: 'exp-1', variant: 'control', artifactId: 'v1', niche: 'AI' })
      const updated = mgr.updateAnalytics('v1', { impressions: 1000, ctr: 0.045, views: 500 })
      assert.equal(updated.impressions, 1000)
      assert.equal(updated.ctr, 0.045)
      assert.equal(updated.views, 500)
    })

    it('returns null for unknown artifact', () => {
      const mgr = new ExperimentManager({ enabled: true, filePath: path.join(tmpDir, 'test.json') })
      assert.equal(mgr.updateAnalytics('nonexistent', {}), null)
    })
  })

  describe('getResults', () => {
    it('returns empty when no data', () => {
      const mgr = new ExperimentManager({ enabled: true, filePath: path.join(tmpDir, 'test.json') })
      const results = mgr.getResults()
      assert.equal(results.totalOutcomes, 0)
      assert.equal(results.control.count, 0)
      assert.equal(results.treatment.count, 0)
    })

    it('computes aggregated results per variant', () => {
      const mgr = new ExperimentManager({ enabled: true, filePath: path.join(tmpDir, 'test.json') })
      for (let i = 0; i < 10; i++) {
        mgr.recordOutcome({
          experimentId: 'exp-1',
          variant: i < 5 ? 'control' : 'treatment',
          artifactId: `v${i}`,
          niche: 'AI',
          ctr: i < 5 ? 0.03 : 0.05,
          averagePercentageViewed: i < 5 ? 0.4 : 0.55,
          generationDurationMs: 30000,
          aiLatencyMs: i >= 5 ? 200 : 0,
        })
      }
      const results = mgr.getResults()
      assert.equal(results.control.count, 5)
      assert.equal(results.treatment.count, 5)
      assert.ok(results.control.avgCTR < results.treatment.avgCTR)
      assert.ok(results.control.avgRetention < results.treatment.avgRetention)
    })

    it('returns INSUFFICIENT_DATA verdict with < 5 per group', () => {
      const mgr = new ExperimentManager({ enabled: true, filePath: path.join(tmpDir, 'test.json') })
      for (let i = 0; i < 3; i++) {
        mgr.recordOutcome({
          experimentId: 'exp-1',
          variant: i < 2 ? 'control' : 'treatment',
          artifactId: `v${i}`,
          niche: 'AI',
          ctr: 0.04,
        })
      }
      const results = mgr.getResults()
      assert.equal(results.comparison.sufficient, false)
      assert.equal(results.comparison.verdict, 'INSUFFICIENT_DATA')
    })
  })

  describe('getSummary', () => {
    it('returns compact summary for logging', () => {
      const mgr = new ExperimentManager({ enabled: true, filePath: path.join(tmpDir, 'test.json') })
      mgr.recordOutcome({ experimentId: 'exp-1', variant: 'control', artifactId: 'v1', niche: 'AI', ctr: 0.03 })
      mgr.recordOutcome({ experimentId: 'exp-1', variant: 'treatment', artifactId: 'v2', niche: 'AI', ctr: 0.05 })
      const summary = mgr.getSummary()
      assert.equal(summary.total, 2)
      assert.equal(summary.controlCount, 1)
      assert.equal(summary.treatmentCount, 1)
      assert.ok(summary.experimentId)
    })
  })
})
