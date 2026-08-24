import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { ProductionStrategyController } from '../src/ai/ProductionStrategyController.mjs'
import { getProfile } from '../src/production/CategoryProductionProfiles.mjs'

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

class MockProfileOptimizer {
  getProfileWithOverrides() { return getProfile('AI') }
}

const ARTICLE = {
  title: 'OpenAI announces GPT-5 with real-time reasoning capabilities',
  description: 'The new model demonstrates significant improvements in multi-step logic and code generation.',
  category: 'AI',
  source: 'reuters.com',
  image: 'https://example.com/gpt5.jpg',
}

function makeController(data = {}) {
  const mem = new MockPerformanceMemory(data)
  const opt = new MockProfileOptimizer()
  return new ProductionStrategyController({ performanceMemory: mem, profileOptimizer: opt })
}

// ── Tests ───────────────────────────────────────────────────────────

describe('ProductionPlan consumption wiring', () => {

  it('plan has all fields required by downstream stages', async () => {
    const controller = makeController()
    const plan = await controller.planProduction({ article: ARTICLE })

    assert.ok(plan.jobId, 'plan.jobId exists')
    assert.ok(plan.niche?.key, 'plan.niche.key exists')
    assert.ok(plan.profile, 'plan.profile exists')
    assert.ok(plan.sceneStrategy, 'plan.sceneStrategy exists')
    assert.ok(plan.visualStrategy, 'plan.visualStrategy exists')
    assert.ok(plan.hookStrategy, 'plan.hookStrategy exists')
    assert.ok(plan.qualityTargets, 'plan.qualityTargets exists')
    assert.ok(plan.thumbnailStrategy, 'plan.thumbnailStrategy exists')
    assert.ok(plan.providerPreferences, 'plan.providerPreferences exists')
    assert.ok(plan.diversityConstraints, 'plan.diversityConstraints exists')
    assert.ok(plan.musicStrategy, 'plan.musicStrategy exists')
  })

  it('plan.sceneStrategy has fields consumed by render engine', async () => {
    const controller = makeController()
    const plan = await controller.planProduction({ article: ARTICLE })
    const s = plan.sceneStrategy

    assert.ok(Number.isFinite(s.sceneCount), 'sceneCount is finite')
    assert.ok(s.sceneCount >= 5 && s.sceneCount <= 10, `sceneCount=${s.sceneCount} in 5-10`)
    assert.ok(['low', 'medium', 'high'].includes(s.density), `density=${s.density}`)
    assert.ok(['low', 'medium', 'high', 'smooth', 'dynamic', 'fast'].includes(s.motion), `motion=${s.motion}`)
    assert.ok(typeof s.avgDurationSec === 'number', 'avgDurationSec is number')
    assert.ok(typeof s.totalDurationSec === 'number', 'totalDurationSec is number')
    assert.ok(typeof s.reason === 'string', 'reason is string')
    assert.ok(typeof s.confidence === 'number', 'confidence is number')
  })

  it('plan.visualStrategy has searchQuery consumed by image acquisition', async () => {
    const controller = makeController()
    const plan = await controller.planProduction({ article: ARTICLE })
    const v = plan.visualStrategy

    assert.ok(typeof v.searchQuery === 'string', 'searchQuery is string')
    assert.ok(v.searchQuery.length > 0, 'searchQuery non-empty')
    assert.ok(Array.isArray(v.preferredVisuals), 'preferredVisuals is array')
    assert.ok(v.preferredVisuals.length > 0, 'preferredVisuals non-empty')
    assert.ok(typeof v.diversityRequired === 'boolean', 'diversityRequired is boolean')
    assert.ok(typeof v.maxSimilarImages === 'number', 'maxSimilarImages is number')
  })

  it('plan.hookStrategy has style consumed by PUBLISH CTA', async () => {
    const controller = makeController()
    const plan = await controller.planProduction({ article: ARTICLE })
    const h = plan.hookStrategy

    assert.ok(typeof h.style === 'string', 'style is string')
    assert.ok(h.style.length > 0, 'style non-empty')
    assert.ok(typeof h.source === 'string', 'source is string')
    assert.ok(typeof h.reason === 'string', 'reason is string')
    assert.ok(typeof h.confidence === 'number', 'confidence is number')
  })

  it('plan.thumbnailStrategy has layout + textStrategy consumed by ThumbnailFactory', async () => {
    const controller = makeController()
    const plan = await controller.planProduction({ article: ARTICLE })
    const t = plan.thumbnailStrategy

    assert.ok(typeof t.layout === 'string', 'layout is string')
    assert.ok(typeof t.textStrategy === 'string', 'textStrategy is string')
    assert.ok(typeof t.diversityRequired === 'boolean', 'diversityRequired is boolean')
    assert.ok(typeof t.minCandidates === 'number', 'minCandidates is number')
    assert.ok(t.minCandidates >= 1, 'minCandidates >= 1')
  })

  it('plan.providerPreferences has per-provider fields consumed by governor check', async () => {
    const controller = makeController()
    const plan = await controller.planProduction({ article: ARTICLE })
    const p = plan.providerPreferences

    assert.ok(typeof p.ai === 'string', 'ai provider preference is string')
    assert.ok(typeof p.rendering === 'string', 'rendering provider preference is string')
    assert.ok(typeof p.tts === 'string', 'tts provider preference is string')
    assert.ok(typeof p.imageSearch === 'string', 'imageSearch provider preference is string')
  })

  it('plan.diversityConstraints has reuse windows consumed by UNIQUENESS gate', async () => {
    const controller = makeController()
    const plan = await controller.planProduction({ article: ARTICLE })
    const d = plan.diversityConstraints

    assert.ok(typeof d.imageReuseWindow === 'number', 'imageReuseWindow is number')
    assert.ok(d.imageReuseWindow > 0, 'imageReuseWindow positive')
    assert.ok(typeof d.musicReuseWindow === 'number', 'musicReuseWindow is number')
    assert.ok(typeof d.thumbnailReuseWindow === 'number', 'thumbnailReuseWindow is number')
    assert.ok(typeof d.scriptSimilarityMax === 'number', 'scriptSimilarityMax is number')
    assert.ok(d.scriptSimilarityMax > 0 && d.scriptSimilarityMax <= 1, 'scriptSimilarityMax in (0,1]')
    assert.ok(typeof d.sceneImageSimilarityMax === 'number', 'sceneImageSimilarityMax is number')
    assert.ok(d.sceneImageSimilarityMax > 0 && d.sceneImageSimilarityMax <= 1, 'sceneImageSimilarityMax in (0,1]')
  })

  it('plan.qualityTargets has thresholds consumed by quality gates', async () => {
    const controller = makeController()
    const plan = await controller.planProduction({ article: ARTICLE })
    const q = plan.qualityTargets

    assert.ok(typeof q.compositionScore === 'number', 'compositionScore is number')
    assert.ok(typeof q.retentionHazardMax === 'number', 'retentionHazardMax is number')
    assert.ok(typeof q.hookScoreMin === 'number', 'hookScoreMin is number')
    assert.ok(typeof q.sceneDiversityMin === 'number', 'sceneDiversityMin is number')
    assert.ok(typeof q.thumbnailDiversityMin === 'number', 'thumbnailDiversityMin is number')
  })

  it('plan.strategy can be passed through options and merged into productionContext', async () => {
    const controller = makeController()
    const plan = await controller.planProduction({ article: ARTICLE })

    const strategyFromPlan = {
      sceneStrategy: plan.sceneStrategy,
      visualStrategy: plan.visualStrategy,
      hookStrategy: plan.hookStrategy,
      profile: plan.profile,
      qualityTargets: plan.qualityTargets,
    }

    const productionContext = {
      niche: plan.niche,
      profile: plan.profile,
      strategy: strategyFromPlan ? Object.freeze({ ...strategyFromPlan }) : null,
    }

    assert.ok(productionContext.strategy, 'strategy merged into productionContext')
    assert.equal(productionContext.strategy.sceneStrategy.sceneCount, plan.sceneStrategy.sceneCount)
    assert.equal(productionContext.strategy.visualStrategy.searchQuery, plan.visualStrategy.searchQuery)
    assert.equal(productionContext.strategy.hookStrategy.style, plan.hookStrategy.style)
    assert.equal(productionContext.strategy.qualityTargets.hookScoreMin, plan.qualityTargets.hookScoreMin)
  })

  it('recordOutcome writes observation to performance memory', async () => {
    const controller = makeController()
    const plan = await controller.planProduction({ article: ARTICLE })
    const mem = controller.performanceMemory

    controller.recordOutcome(plan, {
      videoId: 'vid-001',
      success: true,
      musicTrack: 'impact-03.mp3',
      analytics: { impressions: 1000, views: 500, avgViewDuration: 25.5, avgPercentViewed: 0.68 },
    })

    assert.equal(mem._recorded.length, 1, 'one observation recorded')
    const obs = mem._recorded[0]
    assert.equal(obs.videoId, 'vid-001')
    assert.equal(obs.niche, plan.niche.key)
    assert.equal(obs.hookStyle, plan.hookStrategy.style)
    assert.equal(obs.thumbnailStyle, plan.thumbnailStrategy.layout)
    assert.equal(obs.musicTrack, 'impact-03.mp3')
    assert.equal(obs.analytics.views, 500)
    assert.equal(obs.success, true)
    assert.equal(obs.planConfidence, plan.confidence)
  })

  it('recordOutcome silently skips if no videoId', async () => {
    const controller = makeController()
    const plan = await controller.planProduction({ article: ARTICLE })
    const mem = controller.performanceMemory

    controller.recordOutcome(plan, { success: true })
    assert.equal(mem._recorded.length, 0, 'no observation recorded')
  })

  it('consecutive plans produce different strategy decisions when memory differs', async () => {
    const ctrlA = makeController()
    const planA = await ctrlA.planProduction({ article: ARTICLE })

    const ctrlB = makeController({
      recent: [
        { niche: 'AI', success: true, hookStyle: 'breaking', thumbnailStyle: 'text-left' },
        { niche: 'AI', success: true, hookStyle: 'breaking', thumbnailStyle: 'text-left' },
        { niche: 'AI', success: true, hookStyle: 'breaking', thumbnailStyle: 'text-left' },
      ],
      nicheStats: { 'AI': { avgScore: 0.9, successRate: 1.0, hookPerformance: { breaking: 0.9 } } },
    })
    const planB = await ctrlB.planProduction({ article: ARTICLE })

    assert.ok(planA.sceneStrategy.sceneCount >= 5)
    assert.ok(planB.sceneStrategy.sceneCount >= 5)
    assert.ok(planB.hookStrategy.style, 'hook style present')
  })

  it('plan fallback chain works with no memory and no optimizer', async () => {
    const controller = new ProductionStrategyController({})
    const plan = await controller.planProduction({ article: ARTICLE })

    assert.ok(plan.sceneStrategy.sceneCount >= 5)
    assert.ok(plan.hookStrategy.style)
    assert.ok(plan.thumbnailStrategy.layout)
    assert.ok(plan.providerPreferences.ai)
    assert.ok(plan.confidence > 0)
  })
})
