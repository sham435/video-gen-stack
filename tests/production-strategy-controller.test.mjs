import assert from 'node:assert/strict'
import { describe, it, beforeEach } from 'node:test'
import { ProductionStrategyController } from '../src/ai/ProductionStrategyController.mjs'
import { CategoryProductionProfiles, getProfile } from '../src/production/CategoryProductionProfiles.mjs'

// ── Mock PerformanceMemory ──────────────────────────────────────────

class MockPerformanceMemory {
  constructor(data = {}) {
    this._nicheStats = data.nicheStats || {}
    this._hookStats = data.hookStats || {}
    this._thumbStats = data.thumbStats || {}
    this._recent = data.recent || []
    this._recorded = []
  }
  nicheStats() { return this._nicheStats }
  hookStats() { return this._hookStats }
  thumbnailStats() { return this._thumbStats }
  recent(n) { return this._recent.slice(0, n) }
  record(obs) { this._recorded.push(obs) }
}

// ── Mock ProfileOptimizer ───────────────────────────────────────────

class MockProfileOptimizer {
  constructor(overrides = {}) {
    this._overrides = overrides
  }
  getProfileWithOverrides(niche, canonical) {
    const ov = this._overrides[niche]
    if (!ov) return canonical
    return { ...canonical, ...ov }
  }
}

// ── Mock ResourceGovernor ───────────────────────────────────────────

class MockResourceGovernor {
  constructor(status = {}) {
    this._status = status
  }
  statusAll() { return this._status }
}

const ARTICLE = {
  title: 'OpenAI Announces GPT-5 with Breakthrough Reasoning Capabilities',
  description: 'OpenAI has unveiled GPT-5, its next-generation language model.',
  category: 'AI',
  publishedAt: new Date().toISOString(),
}

// ── Tests ───────────────────────────────────────────────────────────

describe('ProductionStrategyController', () => {
  describe('planProduction', () => {
    it('produces a valid ProductionPlan', async () => {
      const ctrl = new ProductionStrategyController()
      const plan = await ctrl.planProduction(ARTICLE)
      assert.ok(plan.jobId)
      assert.ok(plan.niche)
      assert.ok(plan.profile)
      assert.ok(plan.hookStrategy)
      assert.ok(plan.sceneStrategy)
      assert.ok(plan.visualStrategy)
      assert.ok(plan.musicStrategy)
      assert.ok(plan.thumbnailStrategy)
      assert.ok(plan.providerPreferences)
      assert.ok(plan.qualityTargets)
      assert.ok(plan.diversityConstraints)
      assert.ok(plan.reasoning)
      assert.ok(typeof plan.confidence === 'number')
      assert.ok(Array.isArray(plan.memorySignals))
      assert.ok(Array.isArray(plan.rejectedStrategies))
      assert.ok(plan.createdAt)
    })

    it('resolves niche from article', async () => {
      const ctrl = new ProductionStrategyController()
      const plan = await ctrl.planProduction(ARTICLE)
      assert.equal(plan.niche.key, 'AI')
      assert.ok(plan.niche.source === 'heuristic' || plan.niche.source === 'explicit')
    })

    it('uses category profile for the resolved niche', async () => {
      const ctrl = new ProductionStrategyController()
      const plan = await ctrl.planProduction(ARTICLE)
      const profile = getProfile('AI')
      assert.equal(plan.profile.hookStyle, profile.hookStyle)
      assert.equal(plan.profile.coverStyle, profile.coverStyle)
      assert.equal(plan.profile.accent, profile.accent)
    })

    it('uses GENERAL profile for unknown category', async () => {
      const ctrl = new ProductionStrategyController()
      const plan = await ctrl.planProduction({ ...ARTICLE, title: 'Random story about cats', category: 'general' })
      const profile = getProfile('GENERAL')
      assert.equal(plan.profile.hookStyle, profile.hookStyle)
    })

    it('plan is frozen (immutable)', async () => {
      const ctrl = new ProductionStrategyController()
      const plan = await ctrl.planProduction(ARTICLE)
      assert.ok(Object.isFrozen(plan))
    })

    it('records planDurationMs', async () => {
      const ctrl = new ProductionStrategyController()
      const plan = await ctrl.planProduction(ARTICLE)
      assert.ok(typeof plan.planDurationMs === 'number')
      assert.ok(plan.planDurationMs >= 0)
    })
  })

  describe('memory influence', () => {
    it('optimizes hook style when memory shows better option', async () => {
      const mem = new MockPerformanceMemory({
        hookStats: {
          curiosity: { avgCtr: 0.08, avgRetention: 0.65, sampleCount: 10, grade: 'A' },
          breaking: { avgCtr: 0.04, avgRetention: 0.45, sampleCount: 8, grade: 'C' },
        },
      })
      const ctrl = new ProductionStrategyController({ performanceMemory: mem })
      const plan = await ctrl.planProduction(ARTICLE)
      // AI niche has hookStyle='curiosity', memory also says curiosity is best
      // So it should use curiosity (either from profile or memory)
      assert.ok(['curiosity', 'breaking'].includes(plan.hookStrategy.style))
    })

    it('optimizes thumbnail style when memory shows better option', async () => {
      const mem = new MockPerformanceMemory({
        thumbStats: {
          'bold': { avgCtr: 0.09, sampleCount: 8, grade: 'A' },
          'futuristic-tech': { avgCtr: 0.03, sampleCount: 6, grade: 'D' },
        },
      })
      const ctrl = new ProductionStrategyController({ performanceMemory: mem })
      const plan = await ctrl.planProduction(ARTICLE)
      // Memory says 'bold' is better than 'futuristic-tech' (AI profile)
      assert.equal(plan.thumbnailStrategy.layout, 'bold')
      assert.equal(plan.thumbnailStrategy.source, 'memory_optimized')
    })

    it('falls back to profile when insufficient memory data', async () => {
      const mem = new MockPerformanceMemory({
        hookStats: {
          breaking: { avgCtr: 0.05, sampleCount: 2, grade: 'B' }, // too few samples
        },
      })
      const ctrl = new ProductionStrategyController({ performanceMemory: mem })
      const plan = await ctrl.planProduction(ARTICLE)
      assert.equal(plan.hookStrategy.source, 'profile')
    })

    it('works without performance memory', async () => {
      const ctrl = new ProductionStrategyController()
      const plan = await ctrl.planProduction(ARTICLE)
      assert.ok(plan.hookStrategy)
      assert.ok(plan.thumbnailStrategy)
    })
  })

  describe('profile overrides', () => {
    it('applies ProfileOptimizer overrides', async () => {
      const optimizer = new MockProfileOptimizer({
        AI: { hookStyle: 'shock', visualDensity: 'low' },
      })
      const ctrl = new ProductionStrategyController({ profileOptimizer: optimizer })
      const plan = await ctrl.planProduction(ARTICLE)
      assert.equal(plan.profile.hookStyle, 'shock')
      assert.equal(plan.profile.visualDensity, 'low')
    })

    it('preserves non-overridden fields', async () => {
      const optimizer = new MockProfileOptimizer({
        AI: { hookStyle: 'shock' },
      })
      const ctrl = new ProductionStrategyController({ profileOptimizer: optimizer })
      const plan = await ctrl.planProduction(ARTICLE)
      assert.equal(plan.profile.hookStyle, 'shock')
      assert.equal(plan.profile.accent, getProfile('AI').accent) // unchanged
    })
  })

  describe('resource governor awareness', () => {
    it('falls back AI provider when quota exhausted', async () => {
      const gov = new MockResourceGovernor({
        gemini: { remaining: { daily: 0 } },
      })
      const ctrl = new ProductionStrategyController({ resourceGovernor: gov })
      const plan = await ctrl.planProduction(ARTICLE)
      assert.equal(plan.providerPreferences.ai, 'ollama')
    })

    it('falls back TTS when quota exhausted', async () => {
      const gov = new MockResourceGovernor({
        elevenlabs: { remaining: { daily: 0 } },
      })
      const ctrl = new ProductionStrategyController({ resourceGovernor: gov })
      const plan = await ctrl.planProduction(ARTICLE)
      assert.equal(plan.providerPreferences.tts, 'fallback')
    })

    it('uses defaults when governor unavailable', async () => {
      const ctrl = new ProductionStrategyController()
      const plan = await ctrl.planProduction(ARTICLE)
      assert.equal(plan.providerPreferences.ai, 'auto')
    })
  })

  describe('scene strategy', () => {
    it('high density → 7 scenes', async () => {
      const ctrl = new ProductionStrategyController()
      const plan = await ctrl.planProduction(ARTICLE) // AI profile has visualDensity='high'
      assert.equal(plan.sceneStrategy.sceneCount, 7)
      assert.equal(plan.sceneStrategy.density, 'high')
    })

    it('low density → 5 scenes', async () => {
      const optimizer = new MockProfileOptimizer({
        APPLE: { visualDensity: 'low' },
      })
      const ctrl = new ProductionStrategyController({ profileOptimizer: optimizer })
      const plan = await ctrl.planProduction({ ...ARTICLE, category: 'APPLE' })
      assert.equal(plan.sceneStrategy.sceneCount, 5)
    })
  })

  describe('confidence scoring', () => {
    it('confidence is between 0 and 1', async () => {
      const ctrl = new ProductionStrategyController()
      const plan = await ctrl.planProduction(ARTICLE)
      assert.ok(plan.confidence >= 0 && plan.confidence <= 1)
    })

    it('confidence boosts with sufficient memory data', async () => {
      const mem = new MockPerformanceMemory({
        nicheStats: {
          AI: { avgCtr: 0.06, sampleCount: 10, sufficientData: true, grade: 'A' },
        },
      })
      const ctrl = new ProductionStrategyController({ performanceMemory: mem })
      const plan = await ctrl.planProduction(ARTICLE)
      assert.ok(plan.confidence >= 0.70)
    })
  })

  describe('diversity constraints', () => {
    it('has reuse windows', async () => {
      const ctrl = new ProductionStrategyController()
      const plan = await ctrl.planProduction(ARTICLE)
      assert.ok(plan.diversityConstraints.imageReuseWindow > 0)
      assert.ok(plan.diversityConstraints.musicReuseWindow > 0)
      assert.ok(plan.diversityConstraints.thumbnailReuseWindow > 0)
    })
  })

  describe('quality targets', () => {
    it('has composition and retention thresholds', async () => {
      const ctrl = new ProductionStrategyController()
      const plan = await ctrl.planProduction(ARTICLE)
      assert.ok(plan.qualityTargets.compositionScore > 0)
      assert.ok(plan.qualityTargets.retentionHazardMax > 0)
      assert.ok(plan.qualityTargets.hookScoreMin > 0)
    })
  })

  describe('recordOutcome', () => {
    it('records observation to memory', async () => {
      const mem = new MockPerformanceMemory()
      const ctrl = new ProductionStrategyController({ performanceMemory: mem })
      const plan = await ctrl.planProduction(ARTICLE)
      ctrl.recordOutcome(plan, { videoId: 'vid-123', success: true })
      assert.equal(mem._recorded.length, 1)
      assert.equal(mem._recorded[0].videoId, 'vid-123')
      assert.equal(mem._recorded[0].niche, 'AI')
    })

    it('does not crash when memory unavailable', async () => {
      const ctrl = new ProductionStrategyController()
      const plan = await ctrl.planProduction(ARTICLE)
      ctrl.recordOutcome(plan, { videoId: 'vid-123' }) // no-op, no crash
    })

    it('does not crash when outcome has no videoId', async () => {
      const mem = new MockPerformanceMemory()
      const ctrl = new ProductionStrategyController({ performanceMemory: mem })
      const plan = await ctrl.planProduction(ARTICLE)
      ctrl.recordOutcome(plan, { success: true }) // no-op
      assert.equal(mem._recorded.length, 0)
    })
  })

  describe('niche coverage', () => {
    for (const niche of ['TESLA', 'APPLE', 'AI', 'SAMSUNG', 'GOOGLE', 'MICROSOFT', 'SPACE', 'GAMING', 'CRYPTO', 'GENERAL']) {
      it(`produces valid plan for ${niche}`, async () => {
        const ctrl = new ProductionStrategyController()
        const plan = await ctrl.planProduction({ ...ARTICLE, category: niche })
        assert.equal(plan.niche.key, niche)
        assert.ok(plan.hookStrategy.style)
        assert.ok(plan.sceneStrategy.sceneCount >= 3)
        assert.ok(plan.thumbnailStrategy.layout)
        assert.ok(plan.musicStrategy.mood)
      })
    }
  })
})
