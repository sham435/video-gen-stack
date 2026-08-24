import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { StrategyValidator } from '../src/ai/StrategyValidator.mjs'

function validPlan() {
  return {
    jobId: 'test-001',
    niche: { key: 'AI', source: 'heuristic', confidence: 0.85 },
    profile: { hookStyle: 'curiosity', coverStyle: 'futuristic-tech', visualDensity: 'high', motion: 'fast', tone: 'excited', preferredVisuals: ['robot', 'neural network'] },
    hookStrategy: { style: 'curiosity', source: 'profile', confidence: 0.8 },
    sceneStrategy: { density: 'high', motion: 'fast', sceneCount: 7, avgDurationSec: 3.5, totalDurationSec: 24.5, source: 'profile', confidence: 0.85 },
    visualStrategy: { searchQuery: 'robot neural network', preferredVisuals: ['robot', 'neural network'], diversityRequired: true, maxSimilarImages: 1, source: 'profile', confidence: 0.8 },
    musicStrategy: { mood: 'energetic', tone: 'excited', uniquenessRequired: true, fallbackTrack: 'default', source: 'profile', confidence: 0.85 },
    thumbnailStrategy: { layout: 'futuristic-tech', textStrategy: 'curiosity', diversityRequired: true, minCandidates: 3, source: 'profile', confidence: 0.8 },
    providerPreferences: { ai: 'auto', rendering: 'local', tts: 'auto', imageSearch: 'auto', source: 'governor_aware', confidence: 0.7 },
    qualityTargets: { compositionScore: 70, retentionHazardMax: 0.02, hookScoreMin: 60, sceneDiversityMin: 0.5, thumbnailDiversityMin: 0.3, source: 'defaults', confidence: 0.9 },
    diversityConstraints: { imageReuseWindow: 50, musicReuseWindow: 50, thumbnailReuseWindow: 50, scriptSimilarityMax: 0.80, sceneImageSimilarityMax: 0.85, source: 'defaults', confidence: 0.95 },
    confidence: 0.85,
  }
}

describe('StrategyValidator', () => {
  describe('validate — valid plan', () => {
    it('accepts a fully valid plan', () => {
      const result = StrategyValidator.validate(validPlan())
      assert.equal(result.valid, true)
      assert.equal(result.errors.length, 0)
    })

    it('accepts plan with minimal fields', () => {
      const result = StrategyValidator.validate({ niche: { key: 'AI' }, hookStrategy: { style: 'breaking' } })
      assert.equal(result.valid, true)
    })

    it('rejects null/undefined plan', () => {
      assert.equal(StrategyValidator.validate(null).valid, false)
      assert.equal(StrategyValidator.validate(undefined).valid, false)
      assert.equal(StrategyValidator.validate('string').valid, false)
    })
  })

  describe('validate — sceneStrategy', () => {
    it('rejects sceneCount below 5', () => {
      const plan = validPlan()
      plan.sceneStrategy.sceneCount = 3
      const result = StrategyValidator.validate(plan)
      assert.equal(result.valid, false)
      assert.ok(result.errors.some(e => e.includes('sceneCount')))
    })

    it('rejects sceneCount above 10', () => {
      const plan = validPlan()
      plan.sceneStrategy.sceneCount = 12
      const result = StrategyValidator.validate(plan)
      assert.equal(result.valid, false)
      assert.ok(result.errors.some(e => e.includes('sceneCount')))
    })

    it('rejects non-finite sceneCount', () => {
      const plan = validPlan()
      plan.sceneStrategy.sceneCount = NaN
      const result = StrategyValidator.validate(plan)
      assert.equal(result.valid, false)
    })

    it('rejects invalid density', () => {
      const plan = validPlan()
      plan.sceneStrategy.density = 'extreme'
      const result = StrategyValidator.validate(plan)
      assert.equal(result.valid, false)
      assert.ok(result.errors.some(e => e.includes('density')))
    })

    it('rejects invalid motion', () => {
      const plan = validPlan()
      plan.sceneStrategy.motion = 'teleport'
      const result = StrategyValidator.validate(plan)
      assert.equal(result.valid, false)
    })

    it('warns on unusual total duration', () => {
      const plan = validPlan()
      plan.sceneStrategy.sceneCount = 10
      plan.sceneStrategy.avgDurationSec = 8.5
      const result = StrategyValidator.validate(plan)
      assert.ok(result.warnings.some(w => w.includes('totalDuration')))
    })
  })

  describe('validate — hookStrategy', () => {
    it('rejects invalid hookStyle', () => {
      const plan = validPlan()
      plan.hookStrategy.style = 'clickbait'
      const result = StrategyValidator.validate(plan)
      assert.equal(result.valid, false)
      assert.ok(result.errors.some(e => e.includes('hookStrategy.style')))
    })

    it('accepts all valid hook styles', () => {
      for (const style of ['breaking', 'reveal', 'curiosity', 'shock', 'data']) {
        const plan = validPlan()
        plan.hookStrategy.style = style
        const result = StrategyValidator.validate(plan)
        assert.equal(result.valid, true, `hookStyle=${style} should be valid`)
      }
    })
  })

  describe('validate — thumbnailStrategy', () => {
    it('rejects invalid thumbnail layout', () => {
      const plan = validPlan()
      plan.thumbnailStrategy.layout = 'neon-cyber'
      const result = StrategyValidator.validate(plan)
      assert.equal(result.valid, false)
      assert.ok(result.errors.some(e => e.includes('thumbnailStrategy.layout')))
    })

    it('accepts all valid layouts', () => {
      for (const layout of ['breaking', 'premium-tech', 'futuristic-tech', 'automotive-tech', 'bold', 'cinematic', 'data']) {
        const plan = validPlan()
        plan.thumbnailStrategy.layout = layout
        const result = StrategyValidator.validate(plan)
        assert.equal(result.valid, true, `layout=${layout} should be valid`)
      }
    })
  })

  describe('validate — providerPreferences', () => {
    it('rejects invalid AI provider', () => {
      const plan = validPlan()
      plan.providerPreferences.ai = 'chatgpt-ultra'
      const result = StrategyValidator.validate(plan)
      assert.equal(result.valid, false)
      assert.ok(result.errors.some(e => e.includes('providerPreferences.ai')))
    })

    it('rejects invalid TTS provider', () => {
      const plan = validPlan()
      plan.providerPreferences.tts = 'google-tts'
      const result = StrategyValidator.validate(plan)
      assert.equal(result.valid, false)
    })
  })

  describe('validate — qualityTargets (system policy)', () => {
    it('rejects compositionScore below system minimum', () => {
      const plan = validPlan()
      plan.qualityTargets.compositionScore = 30
      const result = StrategyValidator.validate(plan)
      assert.equal(result.valid, false)
      assert.ok(result.errors.some(e => e.includes('below system minimum')))
    })

    it('rejects retentionHazardMax below system minimum', () => {
      const plan = validPlan()
      plan.qualityTargets.retentionHazardMax = 0.001
      const result = StrategyValidator.validate(plan)
      assert.equal(result.valid, false)
    })

    it('rejects hookScoreMin below system minimum', () => {
      const plan = validPlan()
      plan.qualityTargets.hookScoreMin = 10
      const result = StrategyValidator.validate(plan)
      assert.equal(result.valid, false)
    })

    it('rejects compositionScore above system maximum', () => {
      const plan = validPlan()
      plan.qualityTargets.compositionScore = 150
      const result = StrategyValidator.validate(plan)
      assert.equal(result.valid, false)
    })
  })

  describe('validate — diversityConstraints', () => {
    it('rejects imageReuseWindow below 10', () => {
      const plan = validPlan()
      plan.diversityConstraints.imageReuseWindow = 5
      const result = StrategyValidator.validate(plan)
      assert.equal(result.valid, false)
    })

    it('rejects scriptSimilarityMax above 1', () => {
      const plan = validPlan()
      plan.diversityConstraints.scriptSimilarityMax = 1.5
      const result = StrategyValidator.validate(plan)
      assert.equal(result.valid, false)
    })

    it('rejects scriptSimilarityMax at 0', () => {
      const plan = validPlan()
      plan.diversityConstraints.scriptSimilarityMax = 0
      const result = StrategyValidator.validate(plan)
      assert.equal(result.valid, false)
    })
  })

  describe('validate — confidence', () => {
    it('rejects confidence above 1', () => {
      const plan = validPlan()
      plan.confidence = 1.5
      const result = StrategyValidator.validate(plan)
      assert.equal(result.valid, false)
    })

    it('rejects negative confidence', () => {
      const plan = validPlan()
      plan.confidence = -0.1
      const result = StrategyValidator.validate(plan)
      assert.equal(result.valid, false)
    })
  })

  describe('validateRecommendations', () => {
    it('accepts valid recommendations', () => {
      const recs = [
        { field: 'hookStrategy.style', suggestedValue: 'reveal', confidence: 0.78, reason: 'test' },
        { field: 'thumbnailStrategy.layout', suggestedValue: 'bold', confidence: 0.65, reason: 'test' },
      ]
      const result = StrategyValidator.validateRecommendations(recs)
      assert.equal(result.valid.length, 2)
      assert.equal(result.invalid.length, 0)
    })

    it('rejects recommendations on protected fields', () => {
      const recs = [
        { field: 'qualityTargets.compositionScore', suggestedValue: '50', confidence: 0.8, reason: 'test' },
        { field: 'niche.key', suggestedValue: 'TESLA', confidence: 0.9, reason: 'test' },
      ]
      const result = StrategyValidator.validateRecommendations(recs)
      assert.equal(result.valid.length, 0)
      assert.equal(result.invalid.length, 2)
    })

    it('rejects recommendations with invalid values', () => {
      const recs = [
        { field: 'hookStrategy.style', suggestedValue: 'clickbait', confidence: 0.8, reason: 'test' },
        { field: 'thumbnailStrategy.layout', suggestedValue: 'neon-drip', confidence: 0.7, reason: 'test' },
      ]
      const result = StrategyValidator.validateRecommendations(recs)
      assert.equal(result.valid.length, 0)
      assert.equal(result.invalid.length, 2)
    })

    it('rejects non-array input', () => {
      const result = StrategyValidator.validateRecommendations('not-array')
      assert.equal(result.valid.length, 0)
      assert.equal(result.invalid.length, 1)
    })

    it('rejects recommendations missing required fields', () => {
      const recs = [
        { field: 'hookStrategy.style' },
        { suggestedValue: 'reveal' },
      ]
      const result = StrategyValidator.validateRecommendations(recs)
      assert.equal(result.valid.length, 0)
      assert.equal(result.invalid.length, 2)
    })

    it('rejects out-of-range confidence', () => {
      const recs = [
        { field: 'hookStrategy.style', suggestedValue: 'reveal', confidence: 1.5, reason: 'test' },
      ]
      const result = StrategyValidator.validateRecommendations(recs)
      assert.equal(result.valid.length, 0)
      assert.equal(result.invalid.length, 1)
    })
  })
})
