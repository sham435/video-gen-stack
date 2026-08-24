import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { AiStrategyLayer } from '../src/ai/AiStrategyLayer.mjs'

// ── Mock providers ──────────────────────────────────────────────────

class MockProvider {
  constructor(name, response = null, error = null) {
    this._name = name
    this._response = response
    this._error = error
    this._calls = []
  }
  get name() { return this._name }
  get supportedFeatures() { return ['chat', 'json-mode'] }
  async generate(messages, options = {}) {
    this._calls.push({ messages, options })
    if (this._error) throw this._error
    return this._response
  }
}

class MockProviderChain {
  constructor(providers) {
    this.providers = providers
    this._name = providers.map(p => p.name).join(' → ')
  }
  get name() { return this._name }
  async generate(messages, options = {}) {
    for (const p of this.providers) {
      try { return await p.generate(messages, options) }
      catch { /* try next */ }
    }
    throw new Error('all providers failed')
  }
}

const VALID_AI_RESPONSE = {
  recommendations: [
    { field: 'hookStrategy.style', suggestedValue: 'reveal', confidence: 0.78, reason: 'reveal outperforms curiosity for AI niche' },
    { field: 'thumbnailStrategy.layout', suggestedValue: 'bold', confidence: 0.65, reason: 'bold has higher CTR' },
  ],
}

const VALID_CONTEXT = {
  article: { title: 'GPT-5 test', description: 'test desc', category: 'AI' },
  niche: { key: 'AI', source: 'heuristic', confidence: 0.85 },
  profile: { hookStyle: 'curiosity', coverStyle: 'futuristic-tech', visualDensity: 'high' },
  productionHistory: { available: false },
  assetState: { available: false },
  quotaState: { available: false },
}

describe('AiStrategyLayer', () => {
  describe('optimize — success', () => {
    it('returns recommendations from provider', async () => {
      const provider = new MockProvider('TestAI', VALID_AI_RESPONSE)
      const chain = new MockProviderChain([provider])
      const layer = new AiStrategyLayer({ providerChain: chain })

      const result = await layer.optimize(VALID_CONTEXT)
      assert.equal(result.recommendations.length, 2)
      assert.equal(result.recommendations[0].field, 'hookStrategy.style')
      assert.equal(result.recommendations[0].suggestedValue, 'reveal')
      assert.equal(result.error, null)
      assert.ok(result.latencyMs >= 0)
      assert.equal(result.provider, 'TestAI')
    })

    it('parses JSON from markdown code fences', async () => {
      const fenced = '```json\n' + JSON.stringify(VALID_AI_RESPONSE) + '\n```'
      const provider = new MockProvider('TestAI', fenced)
      const chain = new MockProviderChain([provider])
      const layer = new AiStrategyLayer({ providerChain: chain })

      const result = await layer.optimize(VALID_CONTEXT)
      assert.equal(result.recommendations.length, 2)
    })
  })

  describe('optimize — provider fallback', () => {
    it('falls back to second provider when first fails', async () => {
      const failProvider = new MockProvider('FailAI', null, new Error('quota exceeded'))
      const successProvider = new MockProvider('GoodAI', VALID_AI_RESPONSE)
      const chain = new MockProviderChain([failProvider, successProvider])
      const layer = new AiStrategyLayer({ providerChain: chain })

      const result = await layer.optimize(VALID_CONTEXT)
      assert.equal(result.recommendations.length, 2)
      assert.ok(result.provider.includes('GoodAI'))
    })

    it('returns empty when all providers fail', async () => {
      const fail1 = new MockProvider('Fail1', null, new Error('quota'))
      const fail2 = new MockProvider('Fail2', null, new Error('timeout'))
      const chain = new MockProviderChain([fail1, fail2])
      const layer = new AiStrategyLayer({ providerChain: chain })

      const result = await layer.optimize(VALID_CONTEXT)
      assert.equal(result.recommendations.length, 0)
      assert.ok(result.error)
    })
  })

  describe('optimize — timeout', () => {
    it('handles provider timeout gracefully', async () => {
      const slowProvider = new MockProvider('SlowAI', null, Object.assign(new Error('timeout'), { name: 'TimeoutError' }))
      const chain = new MockProviderChain([slowProvider])
      const layer = new AiStrategyLayer({ providerChain: chain, timeoutMs: 100 })

      const result = await layer.optimize(VALID_CONTEXT)
      assert.equal(result.recommendations.length, 0)
      assert.ok(result.error)
    })
  })

  describe('optimize — malformed output', () => {
    it('handles non-JSON string', async () => {
      const provider = new MockProvider('TestAI', 'this is not json at all')
      const chain = new MockProviderChain([provider])
      const layer = new AiStrategyLayer({ providerChain: chain })

      const result = await layer.optimize(VALID_CONTEXT)
      assert.equal(result.recommendations.length, 0)
      assert.ok(result.error.includes('parse'))
    })

    it('handles missing recommendations key', async () => {
      const provider = new MockProvider('TestAI', { something: 'else' })
      const chain = new MockProviderChain([provider])
      const layer = new AiStrategyLayer({ providerChain: chain })

      const result = await layer.optimize(VALID_CONTEXT)
      assert.equal(result.recommendations.length, 0)
    })

    it('handles recommendations with invalid fields', async () => {
      const badResponse = {
        recommendations: [
          { field: 'qualityTargets.compositionScore', suggestedValue: '50', confidence: 0.8, reason: 'lower quality' },
          { field: 'hookStrategy.style', suggestedValue: 'clickbait', confidence: 0.7, reason: 'test' },
          { field: 'hookStrategy.style', suggestedValue: 'reveal', confidence: 0.78, reason: 'valid' },
        ],
      }
      const provider = new MockProvider('TestAI', badResponse)
      const chain = new MockProviderChain([provider])
      const layer = new AiStrategyLayer({ providerChain: chain })

      const result = await layer.optimize(VALID_CONTEXT)
      // qualityTargets filtered by field allowlist (2 remain)
      // clickbait is allowed through AI layer (value validated by StrategyValidator)
      assert.equal(result.recommendations.length, 2)
      assert.ok(result.recommendations.every(r => r.field === 'hookStrategy.style'))
    })
  })

  describe('optimize — empty recommendations', () => {
    it('returns empty array when AI has no suggestions', async () => {
      const provider = new MockProvider('TestAI', { recommendations: [] })
      const chain = new MockProviderChain([provider])
      const layer = new AiStrategyLayer({ providerChain: chain })

      const result = await layer.optimize(VALID_CONTEXT)
      assert.equal(result.recommendations.length, 0)
      assert.equal(result.error, null)
    })
  })

  describe('optimize — unavailable', () => {
    it('returns error when no provider chain', async () => {
      const layer = new AiStrategyLayer({})
      const result = await layer.optimize(VALID_CONTEXT)
      assert.equal(result.recommendations.length, 0)
      assert.ok(result.error.includes('no provider'))
      assert.equal(layer.available, false)
    })
  })

  describe('optimize — latency measurement', () => {
    it('tracks latency in milliseconds', async () => {
      const provider = new MockProvider('TestAI', VALID_AI_RESPONSE)
      const chain = new MockProviderChain([provider])
      const layer = new AiStrategyLayer({ providerChain: chain })

      const result = await layer.optimize(VALID_CONTEXT)
      assert.equal(typeof result.latencyMs, 'number')
      assert.ok(result.latencyMs >= 0)
    })
  })

  describe('optimize — field allowlist', () => {
    it('only accepts fields from the allowlist', async () => {
      const response = {
        recommendations: [
          { field: 'hookStrategy.style', suggestedValue: 'reveal', confidence: 0.8, reason: 'test' },
          { field: 'unknown.field', suggestedValue: 'value', confidence: 0.8, reason: 'test' },
          { field: 'sceneStrategy.density', suggestedValue: 'low', confidence: 0.7, reason: 'test' },
        ],
      }
      const provider = new MockProvider('TestAI', response)
      const chain = new MockProviderChain([provider])
      const layer = new AiStrategyLayer({ providerChain: chain })

      const result = await layer.optimize(VALID_CONTEXT)
      assert.equal(result.recommendations.length, 2)
      assert.ok(result.recommendations.every(r => ['hookStrategy.style', 'sceneStrategy.density'].includes(r.field)))
    })

    it('rejects recommendations on protected quality fields', async () => {
      const response = {
        recommendations: [
          { field: 'qualityTargets.compositionScore', suggestedValue: '30', confidence: 0.9, reason: 'lower threshold' },
          { field: 'qualityTargets.hookScoreMin', suggestedValue: '20', confidence: 0.9, reason: 'lower threshold' },
        ],
      }
      const provider = new MockProvider('TestAI', response)
      const chain = new MockProviderChain([provider])
      const layer = new AiStrategyLayer({ providerChain: chain })

      const result = await layer.optimize(VALID_CONTEXT)
      assert.equal(result.recommendations.length, 0)
    })
  })
})
