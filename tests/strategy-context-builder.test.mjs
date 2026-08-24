import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { StrategyContextBuilder } from '../src/ai/StrategyContextBuilder.mjs'

class MockPerformanceMemory {
  constructor(data = {}) {
    this._data = data
  }
  nicheStats() { return this._data.nicheStats || {} }
  hookStats() { return this._data.hookStats || {} }
  thumbnailStats() { return this._data.thumbStats || {} }
  recent(n) { return (this._data.recent || []).slice(0, n) }
}

class MockAssetRegistry {
  getStats() {
    return { scripts: 12, images: 45, music: 8, thumbnails: 30, publishedVideos: 20, activeReservations: 1, rollingWindow: 50 }
  }
}

class MockResourceGovernor {
  statusAll() {
    return {
      gemini: { budget: { daily: 50, monthly: 1000 }, dailyUsed: 12, monthlyUsed: 200 },
      elevenlabs: { budget: { daily: 20, monthly: 300 }, dailyUsed: 5, monthlyUsed: 80 },
    }
  }
}

const ARTICLE = {
  title: 'OpenAI announces GPT-5 with breakthrough reasoning',
  description: 'The new model demonstrates improvements in multi-step logic.',
  category: 'AI',
  source: 'reuters.com',
  imageUrl: 'https://example.com/gpt5.jpg',
  publishedAt: '2026-08-24T10:00:00Z',
}

const NICHE = { key: 'AI', source: 'heuristic', confidence: 0.85 }

const PROFILE = {
  label: 'AI',
  accent: '#7C3AED',
  coverStyle: 'futuristic-tech',
  hookStyle: 'curiosity',
  visualDensity: 'high',
  motion: 'fast',
  preferredVisuals: ['robot', 'neural network', 'server room', 'ai chip'],
  tone: 'excited',
}

describe('StrategyContextBuilder', () => {
  describe('build — required context', () => {
    it('includes article fields', () => {
      const ctx = StrategyContextBuilder.build({ article: ARTICLE, nicheDecision: NICHE, profile: PROFILE })
      assert.equal(ctx.article.title, ARTICLE.title)
      assert.equal(ctx.article.category, 'AI')
      assert.equal(ctx.niche.key, 'AI')
      assert.equal(ctx.profile.hookStyle, 'curiosity')
    })

    it('includes timestamp', () => {
      const ctx = StrategyContextBuilder.build({ article: ARTICLE, nicheDecision: NICHE, profile: PROFILE })
      assert.ok(ctx.timestamp)
      assert.ok(new Date(ctx.timestamp).getTime() > 0)
    })

    it('handles missing inputs gracefully', () => {
      const ctx = StrategyContextBuilder.build({})
      assert.equal(ctx.article, null)
      assert.equal(ctx.niche, null)
      assert.equal(ctx.profile, null)
    })
  })

  describe('build — secrets excluded', () => {
    it('does not contain GEMINI_API_KEY value', () => {
      const secretValue = 'super-secret-gemini-key-12345'
      process.env.GEMINI_API_KEY = secretValue
      const ctx = StrategyContextBuilder.build({ article: ARTICLE, nicheDecision: NICHE, profile: PROFILE })
      const serialized = StrategyContextBuilder.serialize(ctx)
      assert.ok(!serialized.includes(secretValue), 'context must not contain GEMINI_API_KEY value')
      delete process.env.GEMINI_API_KEY
    })

    it('does not contain YOUTUBE_REFRESH_TOKEN value', () => {
      const secretValue = '1//0youtube-refresh-token-xyz'
      process.env.YOUTUBE_REFRESH_TOKEN = secretValue
      const ctx = StrategyContextBuilder.build({ article: ARTICLE, nicheDecision: NICHE, profile: PROFILE })
      const serialized = StrategyContextBuilder.serialize(ctx)
      assert.ok(!serialized.includes(secretValue), 'context must not contain YOUTUBE_REFRESH_TOKEN value')
      delete process.env.YOUTUBE_REFRESH_TOKEN
    })

    it('does not contain OPENAI_API_KEY value', () => {
      const secretValue = 'sk-openai-key-abcdef'
      process.env.OPENAI_API_KEY = secretValue
      const ctx = StrategyContextBuilder.build({ article: ARTICLE, nicheDecision: NICHE, profile: PROFILE })
      const serialized = StrategyContextBuilder.serialize(ctx)
      assert.ok(!serialized.includes(secretValue), 'context must not contain OPENAI_API_KEY value')
      delete process.env.OPENAI_API_KEY
    })

    it('does not contain ELEVENLABS_API_KEY value', () => {
      const secretValue = 'elevenlabs-secret-key-xyz'
      process.env.ELEVENLABS_API_KEY = secretValue
      const ctx = StrategyContextBuilder.build({ article: ARTICLE, nicheDecision: NICHE, profile: PROFILE })
      const serialized = StrategyContextBuilder.serialize(ctx)
      assert.ok(!serialized.includes(secretValue), 'context must not contain ELEVENLABS_API_KEY value')
      delete process.env.ELEVENLABS_API_KEY
    })

    it('does not contain C2PA private key material', () => {
      const privateKey = '-----BEGIN PRIVATE KEY-----\nMIIEvgIBADANBg...'
      const ctx = StrategyContextBuilder.build({ article: ARTICLE, nicheDecision: NICHE, profile: PROFILE })
      const serialized = StrategyContextBuilder.serialize(ctx)
      assert.ok(!serialized.includes('BEGIN PRIVATE KEY'), 'context must not contain private key material')
    })

    it('does not contain LinkedIn access token', () => {
      const ctx = StrategyContextBuilder.build({ article: ARTICLE, nicheDecision: NICHE, profile: PROFILE })
      const serialized = StrategyContextBuilder.serialize(ctx)
      assert.ok(!serialized.includes('linkedin'), 'context must not reference linkedin tokens')
    })
  })

  describe('build — production history', () => {
    it('includes performance memory when available', () => {
      const mem = new MockPerformanceMemory({
        nicheStats: { AI: { grade: 'A', sampleCount: 10, avgCtr: 0.06, avgRetention: 0.72 } },
        hookStats: { curiosity: { grade: 'A', sampleCount: 8, avgRetention: 0.68 }, breaking: { grade: 'C', sampleCount: 5, avgRetention: 0.45 } },
        thumbStats: { 'futuristic-tech': { grade: 'B', sampleCount: 6, avgCtr: 0.04 }, bold: { grade: 'A', sampleCount: 4, avgCtr: 0.07 } },
        recent: [
          { niche: 'AI', hookStyle: 'curiosity', thumbnailStyle: 'futuristic-tech', success: true, analytics: { views: 1500, avgPercentViewed: 0.65 } },
          { niche: 'AI', hookStyle: 'breaking', thumbnailStyle: 'bold', success: true, analytics: { views: 800, avgPercentViewed: 0.42 } },
        ],
      })
      const ctx = StrategyContextBuilder.build({
        article: ARTICLE, nicheDecision: NICHE, profile: PROFILE, performanceMemory: mem,
      })
      assert.equal(ctx.productionHistory.available, true)
      assert.ok(ctx.productionHistory.nichePerformance.AI)
      assert.ok(ctx.productionHistory.hookPerformance.curiosity)
      assert.ok(ctx.productionHistory.thumbnailPerformance['futuristic-tech'])
      assert.equal(ctx.productionHistory.recentVideos.length, 2)
      assert.equal(ctx.productionHistory.recentVideos[0].hookStyle, 'curiosity')
    })

    it('returns unavailable when memory is null', () => {
      const ctx = StrategyContextBuilder.build({ article: ARTICLE, nicheDecision: NICHE, profile: PROFILE })
      assert.equal(ctx.productionHistory.available, false)
    })
  })

  describe('build — asset state', () => {
    it('includes asset registry stats when available', () => {
      const reg = new MockAssetRegistry()
      const ctx = StrategyContextBuilder.build({
        article: ARTICLE, nicheDecision: NICHE, profile: PROFILE, assetRegistry: reg,
      })
      assert.equal(ctx.assetState.available, true)
      assert.equal(ctx.assetState.scripts, 12)
      assert.equal(ctx.assetState.publishedVideos, 20)
    })

    it('returns unavailable when registry is null', () => {
      const ctx = StrategyContextBuilder.build({ article: ARTICLE, nicheDecision: NICHE, profile: PROFILE })
      assert.equal(ctx.assetState.available, false)
    })
  })

  describe('build — quota state', () => {
    it('includes quota without secret tokens', () => {
      const gov = new MockResourceGovernor()
      const ctx = StrategyContextBuilder.build({
        article: ARTICLE, nicheDecision: NICHE, profile: PROFILE, resourceGovernor: gov,
      })
      assert.equal(ctx.quotaState.available, true)
      assert.equal(ctx.quotaState.providers.gemini.daily, 50)
      assert.equal(ctx.quotaState.providers.gemini.dailyUsed, 12)
      // Must NOT contain any API key values
      const serialized = StrategyContextBuilder.serialize(ctx)
      assert.ok(!serialized.includes('sk-'), 'must not contain API key prefix')
      assert.ok(!serialized.includes('Bearer'), 'must not contain bearer token')
      assert.ok(!serialized.includes('1//0'), 'must not contain refresh token prefix')
    })

    it('returns unavailable when governor is null', () => {
      const ctx = StrategyContextBuilder.build({ article: ARTICLE, nicheDecision: NICHE, profile: PROFILE })
      assert.equal(ctx.quotaState.available, false)
    })
  })

  describe('serialize', () => {
    it('produces valid JSON', () => {
      const ctx = StrategyContextBuilder.build({ article: ARTICLE, nicheDecision: NICHE, profile: PROFILE })
      const json = StrategyContextBuilder.serialize(ctx)
      const parsed = JSON.parse(json)
      assert.ok(parsed.article)
      assert.ok(parsed.niche)
    })
  })
})
