import assert from 'node:assert/strict'
import { describe, it, beforeEach } from 'node:test'
import { ProductionStrategyController } from '../src/ai/ProductionStrategyController.mjs'
import { CategoryProductionProfiles, getProfile } from '../src/production/CategoryProductionProfiles.mjs'
import { StrategyValidator } from '../src/ai/StrategyValidator.mjs'

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

  // ── AI integration tests ──────────────────────────────────────────

  describe('AI optimization integration', () => {
    it('valid AI recommendation changes the plan', async () => {
      const aiLayer = {
        async optimize() {
          return {
            recommendations: [
              { field: 'hookStrategy.style', suggestedValue: 'reveal', confidence: 0.78, reason: 'test' },
            ],
            provider: 'TestAI',
            latencyMs: 150,
            error: null,
          }
        },
      }
      const ctrl = new ProductionStrategyController({ aiLayer })
      const plan = await ctrl.planProduction(ARTICLE)

      // AI profile has hookStyle='curiosity', AI recommends 'reveal'
      assert.equal(plan.hookStrategy.style, 'reveal')
      assert.equal(plan.hookStrategy.source, 'ai_optimized')

      const trace = ctrl.getDecisionTrace()
      assert.equal(trace.aiCalled, true)
      assert.equal(trace.recommendationsReceived, 1)
      assert.equal(trace.recommendationsAccepted, 1)
      assert.equal(trace.source, 'ai_optimized')
    })

    it('invalid AI recommendation is rejected', async () => {
      const aiLayer = {
        async optimize() {
          return {
            recommendations: [
              { field: 'qualityTargets.compositionScore', suggestedValue: '30', confidence: 0.9, reason: 'lower quality' },
            ],
            provider: 'TestAI',
            latencyMs: 100,
            error: null,
          }
        },
      }
      const ctrl = new ProductionStrategyController({ aiLayer })
      const plan = await ctrl.planProduction(ARTICLE)

      // Quality targets must remain at system defaults
      assert.equal(plan.qualityTargets.compositionScore, 70)

      const trace = ctrl.getDecisionTrace()
      assert.equal(trace.recommendationsReceived, 1)
      assert.equal(trace.recommendationsAccepted, 0)
      assert.equal(trace.recommendationsRejected, 1)
    })

    it('AI error result falls back to deterministic strategy', async () => {
      const aiLayer = {
        async optimize() {
          // AI layer reports error in result (not exception)
          return {
            recommendations: [],
            provider: 'TestAI',
            latencyMs: 50,
            error: 'provider rate limited',
          }
        },
      }
      const ctrl = new ProductionStrategyController({ aiLayer })
      const plan = await ctrl.planProduction(ARTICLE)

      // Plan should still be valid
      const validation = StrategyValidator.validate(plan)
      assert.equal(validation.valid, true)

      const trace = ctrl.getDecisionTrace()
      assert.equal(trace.aiCalled, true)
      assert.equal(trace.fallbackUsed, true)
      assert.equal(trace.recommendationsAccepted, 0)
    })

    it('AI exception falls back to deterministic strategy', async () => {
      const aiLayer = {
        async optimize() {
          throw new Error('provider crashed')
        },
      }
      const ctrl = new ProductionStrategyController({ aiLayer })
      const plan = await ctrl.planProduction(ARTICLE)

      const validation = StrategyValidator.validate(plan)
      assert.equal(validation.valid, true)

      const trace = ctrl.getDecisionTrace()
      assert.equal(trace.aiCalled, true)
      assert.equal(trace.fallbackUsed, true)
    })

    it('AI returns valid recommendation succeeds', async () => {
      const aiLayer = {
        async optimize() {
          return {
            recommendations: [
              { field: 'hookStrategy.style', suggestedValue: 'reveal', confidence: 0.78, reason: 'test' },
            ],
            provider: 'TestAI',
            latencyMs: 150,
            error: null,
          }
        },
      }
      const ctrl = new ProductionStrategyController({ aiLayer })
      const plan = await ctrl.planProduction(ARTICLE)
      assert.equal(plan.hookStrategy.style, 'reveal')
    })

    it('memory optimization still works without AI', async () => {
      const mem = new MockPerformanceMemory({
        thumbStats: {
          bold: { avgCtr: 0.09, sampleCount: 8, grade: 'A' },
          'futuristic-tech': { avgCtr: 0.03, sampleCount: 6, grade: 'D' },
        },
      })
      const ctrl = new ProductionStrategyController({ performanceMemory: mem })
      const plan = await ctrl.planProduction(ARTICLE)

      assert.equal(plan.thumbnailStrategy.layout, 'bold')
      assert.equal(plan.thumbnailStrategy.source, 'memory_optimized')

      const trace = ctrl.getDecisionTrace()
      assert.equal(trace.aiCalled, false)
    })

    it('decision trace is captured correctly', async () => {
      const aiLayer = {
        async optimize() {
          return {
            recommendations: [
              { field: 'hookStrategy.style', suggestedValue: 'data', confidence: 0.82, reason: 'data works for crypto' },
              { field: 'sceneStrategy.density', suggestedValue: 'low', confidence: 0.65, reason: 'slower pacing' },
            ],
            provider: 'Gemini (flash)',
            latencyMs: 320,
            error: null,
          }
        },
      }
      const ctrl = new ProductionStrategyController({ aiLayer })
      const plan = await ctrl.planProduction(ARTICLE)

      const trace = ctrl.getDecisionTrace()
      assert.equal(trace.aiCalled, true)
      assert.equal(trace.aiProvider, 'Gemini (flash)')
      assert.equal(trace.aiLatencyMs, 320)
      assert.equal(trace.recommendationsReceived, 2)
      assert.equal(trace.recommendationsAccepted, 2)
      assert.equal(trace.recommendationsRejected, 0)
      assert.equal(trace.source, 'ai_optimized')
      assert.ok(typeof trace.confidence === 'number')
      assert.ok(Array.isArray(trace.memorySignals))
    })

    it('deterministic constraints cannot be overridden by AI', async () => {
      const aiLayer = {
        async optimize() {
          return {
            recommendations: [
              { field: 'hookStrategy.style', suggestedValue: 'reveal', confidence: 0.9, reason: 'test' },
              // These should be rejected
              { field: 'niche.key', suggestedValue: 'TESLA', confidence: 0.9, reason: 'override niche' },
              { field: 'qualityTargets.compositionScore', suggestedValue: '20', confidence: 0.9, reason: 'lower quality' },
            ],
            provider: 'TestAI',
            latencyMs: 100,
            error: null,
          }
        },
      }
      const ctrl = new ProductionStrategyController({ aiLayer })
      const plan = await ctrl.planProduction(ARTICLE)

      // AI hook change accepted
      assert.equal(plan.hookStrategy.style, 'reveal')
      // Niche not overridden
      assert.equal(plan.niche.key, 'AI')
      // Quality target not lowered
      assert.equal(plan.qualityTargets.compositionScore, 70)

      const trace = ctrl.getDecisionTrace()
      assert.equal(trace.recommendationsReceived, 3)
      assert.equal(trace.recommendationsAccepted, 1)
      assert.equal(trace.recommendationsRejected, 2)
    })

    it('works without aiLayer (no AI)', async () => {
      const ctrl = new ProductionStrategyController({})
      const plan = await ctrl.planProduction(ARTICLE)
      assert.ok(plan.hookStrategy)
      assert.ok(plan.sceneStrategy)
      const trace = ctrl.getDecisionTrace()
      assert.equal(trace.aiCalled, false)
    })

    it('AI recommendation that fails validation causes revert', async () => {
      const aiLayer = {
        async optimize() {
          return {
            recommendations: [
              { field: 'hookStrategy.style', suggestedValue: 'reveal', confidence: 0.78, reason: 'test' },
              // This will make the plan invalid after application
              { field: 'sceneStrategy.density', suggestedValue: 'ultra-extreme', confidence: 0.9, reason: 'test' },
            ],
            provider: 'TestAI',
            latencyMs: 100,
            error: null,
          }
        },
      }
      const ctrl = new ProductionStrategyController({ aiLayer })
      const plan = await ctrl.planProduction(ARTICLE)

      // The invalid recommendation is filtered by StrategyValidator.validateRecommendations
      // before application, so it never reaches the plan. Plan remains valid.
      const validation = StrategyValidator.validate(plan)
      assert.equal(validation.valid, true)
    })
  })

  describe('strategy validator integration', () => {
    it('plan passes StrategyValidator', async () => {
      const ctrl = new ProductionStrategyController()
      const plan = await ctrl.planProduction(ARTICLE)
      const result = StrategyValidator.validate(plan)
      assert.equal(result.valid, true)
      assert.equal(result.errors.length, 0)
    })

    it('AI-optimized plan still passes StrategyValidator', async () => {
      const aiLayer = {
        async optimize() {
          return {
            recommendations: [
              { field: 'hookStrategy.style', suggestedValue: 'reveal', confidence: 0.78, reason: 'test' },
              { field: 'thumbnailStrategy.layout', suggestedValue: 'bold', confidence: 0.65, reason: 'test' },
            ],
            provider: 'TestAI',
            latencyMs: 150,
            error: null,
          }
        },
      }
      const ctrl = new ProductionStrategyController({ aiLayer })
      const plan = await ctrl.planProduction(ARTICLE)
      const result = StrategyValidator.validate(plan)
      assert.equal(result.valid, true)
    })
  })
})
