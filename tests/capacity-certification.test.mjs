import { describe, it, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { AssetCapacityAnalyzer } from '../src/orchestrator/AssetCapacityAnalyzer.mjs'
import { YouTubeQuotaAuditor } from '../src/orchestrator/YouTubeQuotaAuditor.mjs'
import { ProviderCapacityMatrix } from '../src/orchestrator/ProviderCapacityMatrix.mjs'
import { AICostAnalyzer } from '../src/orchestrator/AICostAnalyzer.mjs'
import { SafeCapacityCalculator } from '../src/orchestrator/SafeCapacityCalculator.mjs'
import { ProductionCapacityGate } from '../src/orchestrator/ProductionCapacityGate.mjs'

describe('Phase 5 — AssetCapacityAnalyzer', () => {
  it('computes demand for 48 videos/day', () => {
    const analyzer = new AssetCapacityAnalyzer({ target: 48 })
    const result = analyzer.analyze()

    assert.equal(result.target, 48)
    assert.equal(result.required.scenes.min, 240) // 48 × 5
    assert.equal(result.required.scenes.max, 480) // 48 × 10
    assert.equal(result.required.music.count, 48)
    assert.equal(result.required.thumbnails.uploaded, 48)
    assert.equal(result.required.scripts.count, 48)
    assert.equal(result.required.tts.calls, 48)
    assert.ok(result.required.images.requests > 0)
  })

  it('reports supply from ProviderBudgets', () => {
    const analyzer = new AssetCapacityAnalyzer({ target: 48 })
    const result = analyzer.analyze()

    assert.ok(result.available.rapidnews)
    assert.ok(result.available.elevenlabs)
    assert.ok(result.available.youtube)
    assert.ok(result.available.pexels)
    assert.ok(result.available.gemini)
    assert.ok(result.available.render)
    assert.ok(result.available.c2pa)
  })

  it('identifies YouTube as bottleneck for 48/day', () => {
    const analyzer = new AssetCapacityAnalyzer({ target: 48 })
    const result = analyzer.analyze()

    // YouTube budget is 6/day, way below 48
    const ytBottleneck = result.bottlenecks.find(b => b.resource === 'youtube')
    assert.ok(ytBottleneck, 'YouTube should be a bottleneck')
    assert.equal(ytBottleneck.severity, 'BLOCKED')
  })

  it('identifies RapidNews as bottleneck for 48/day', () => {
    const analyzer = new AssetCapacityAnalyzer({ target: 48 })
    const result = analyzer.analyze()

    const newsBottleneck = result.bottlenecks.find(b => b.resource === 'news')
    assert.ok(newsBottleneck, 'RapidNews should be a bottleneck')
    assert.equal(newsBottleneck.severity, 'BLOCKED')
  })

  it('identifies ElevenLabs as bottleneck for 48/day', () => {
    const analyzer = new AssetCapacityAnalyzer({ target: 48 })
    const result = analyzer.analyze()

    const ttsBottleneck = result.bottlenecks.find(b => b.resource === 'tts')
    assert.ok(ttsBottleneck, 'ElevenLabs should be a bottleneck')
    assert.equal(ttsBottleneck.severity, 'BLOCKED')
  })

  it('status is BLOCKED when critical resources are below target', () => {
    const analyzer = new AssetCapacityAnalyzer({ target: 48 })
    const result = analyzer.analyze()

    assert.equal(result.status, 'BLOCKED')
  })

  it('PASS status when target is within all limits', () => {
    const analyzer = new AssetCapacityAnalyzer({ target: 2 })
    const result = analyzer.analyze()

    // 2 videos/day: scenes.max=20 < pexels capacity=25 → PASS
    assert.equal(result.status, 'PASS')
  })

  it('providerCapacity matrix includes external providers', () => {
    const analyzer = new AssetCapacityAnalyzer({ target: 48 })
    const result = analyzer.analyze()

    assert.ok(result.providerCapacity.rapidnews)
    assert.ok(result.providerCapacity.elevenlabs)
    assert.ok(result.providerCapacity.youtube)
    assert.ok(result.providerCapacity.pexels)
    assert.ok(result.providerCapacity.gemini)
  })
})

describe('Phase 7 — YouTubeQuotaAuditor', () => {
  it('calculates quota per video from code path', () => {
    const auditor = new YouTubeQuotaAuditor()
    const result = auditor.audit()

    assert.ok(result.quotaPerVideo)
    assert.equal(result.quotaPerVideo.operations.videosInsert.cost, 1600)
    assert.equal(result.quotaPerVideo.operations.thumbnailsSet.cost, 50)
    assert.equal(result.quotaPerVideo.operations.commentsInsert.cost, 1)
    assert.equal(result.quotaPerVideo.total, 1651)
  })

  it('reports configured daily quota', () => {
    const auditor = new YouTubeQuotaAuditor()
    const result = auditor.audit()

    assert.equal(result.configuredDailyQuota, 10000)
    assert.equal(result.budgetDailyLimit, 6)
  })

  it('computes theoretical capacity from quota units', () => {
    const auditor = new YouTubeQuotaAuditor()
    const result = auditor.audit()

    // 10000 / 1651 = 6.05 → 6
    assert.equal(result.theoreticalCapacity, 6)
  })

  it('effective capacity is min(quota, budget)', () => {
    const auditor = new YouTubeQuotaAuditor()
    const result = auditor.audit()

    assert.equal(result.effectiveCapacity, 6) // min(6, 6)
  })

  it('safe capacity has headroom', () => {
    const auditor = new YouTubeQuotaAuditor()
    const result = auditor.audit()

    // 6 × 0.9 = 5.4 → 5
    assert.equal(result.safeCapacity, 5)
  })

  it('reports required quota for 48/day', () => {
    const auditor = new YouTubeQuotaAuditor()
    const result = auditor.audit()

    assert.equal(result.requiredQuotaFor48, 1651 * 48)
    assert.ok(result.quotaIncreaseNeeded)
  })

  it('gapTo48 shows deficit', () => {
    const auditor = new YouTubeQuotaAuditor()
    const result = auditor.audit()

    assert.ok(result.gapTo48 > 0)
    assert.equal(result.gapTo48, 48 - 5)
  })

  it('recommendations include quota increase', () => {
    const auditor = new YouTubeQuotaAuditor()
    const result = auditor.audit()

    assert.ok(result.recommendations.length > 0)
    assert.ok(result.recommendations.some(r => r.includes('quota increase')))
  })
})

describe('Phase 8 — ProviderCapacityMatrix', () => {
  it('includes all providers', () => {
    const matrix = new ProviderCapacityMatrix({ target: 48 }).build()

    assert.ok(matrix.providers.gemini)
    assert.ok(matrix.providers.openai)
    assert.ok(matrix.providers.openrouter)
    assert.ok(matrix.providers.ollama)
    assert.ok(matrix.providers.zen)
    assert.ok(matrix.providers.elevenlabs)
    assert.ok(matrix.providers.pexels)
    assert.ok(matrix.providers.rapidnews)
    assert.ok(matrix.providers.newsdata)
    assert.ok(matrix.providers.newsapi)
    assert.ok(matrix.providers.youtube)
  })

  it('each provider has normalized fields', () => {
    const matrix = new ProviderCapacityMatrix({ target: 48 }).build()

    for (const [key, p] of Object.entries(matrix.providers)) {
      assert.ok(p.provider, `${key} missing provider name`)
      assert.ok(p.operation, `${key} missing operation`)
      assert.ok(typeof p.dailyLimit === 'number' || p.dailyLimit === 'unlimited', `${key} invalid dailyLimit`)
      assert.ok(typeof p.capacityPerDay === 'number' || p.capacityPerDay === 'unlimited', `${key} invalid capacityPerDay`)
      assert.ok(typeof p.latencyP95Ms === 'number', `${key} missing latencyP95Ms`)
      assert.ok(p.fallback !== undefined, `${key} missing fallback`)
    }
  })

  it('identifies critical bottleneck (lowest capacity)', () => {
    const matrix = new ProviderCapacityMatrix({ target: 48 }).build()

    // RapidNews (3/day) < YouTube (6/day), so rapidnews is critical
    assert.equal(matrix.criticalBottleneck, 'rapidnews')
  })

  it('YouTube is BLOCKED at 48/day', () => {
    const matrix = new ProviderCapacityMatrix({ target: 48 }).build()

    const ytBottleneck = matrix.bottlenecks.find(b => b.provider === 'youtube')
    assert.ok(ytBottleneck)
    assert.equal(ytBottleneck.severity, 'BLOCKED')
  })

  it('RapidNews fallback chain is correct', () => {
    const matrix = new ProviderCapacityMatrix({ target: 48 })
    const fallback = matrix.verifyRapidNewsFallback()

    assert.deepEqual(fallback.rapidnews.chain, ['rapidnews', 'newsdata', 'newsapi'])
    assert.equal(fallback.noUnnecessary429Failure, true)
    assert.ok(fallback.totalNewsCapacity > 0)
  })

  it('status is BLOCKED at 48/day', () => {
    const matrix = new ProviderCapacityMatrix({ target: 48 }).build()

    assert.equal(matrix.status, 'BLOCKED')
  })
})

describe('Phase 9 — AICostAnalyzer', () => {
  it('reports AI calls per video (disabled)', () => {
    const analyzer = new AICostAnalyzer({ target: 48, aiEnabled: false })
    const result = analyzer.analyze()

    assert.equal(result.aiEnabled, false)
    assert.equal(result.callsPerVideo, 0)
    assert.equal(result.callsPerDay, 0)
  })

  it('reports AI calls per video (enabled)', () => {
    const analyzer = new AICostAnalyzer({ target: 48, aiEnabled: true })
    const result = analyzer.analyze()

    assert.equal(result.aiEnabled, true)
    assert.equal(result.callsPerVideo, 1)
    assert.equal(result.callsPerDay, 48)
  })

  it('reports provider capacities', () => {
    const analyzer = new AICostAnalyzer({ target: 48, aiEnabled: true })
    const result = analyzer.analyze()

    assert.ok(result.providerCapacities.gemini)
    assert.ok(result.providerCapacities.openai)
    assert.ok(result.providerCapacities.openrouter)
    assert.ok(result.providerCapacities.ollama)
    assert.ok(result.providerCapacities.zen)
  })

  it('reports latency profile', () => {
    const analyzer = new AICostAnalyzer({ target: 48, aiEnabled: true })
    const result = analyzer.analyze()

    assert.ok(result.latencyProfile.gemini)
    assert.ok(result.latencyProfile.gemini.p50Ms > 0)
    assert.ok(result.latencyProfile.gemini.p95Ms > 0)
    assert.ok(result.latencyProfile.chain)
  })

  it('effective capacity exceeds target', () => {
    const analyzer = new AICostAnalyzer({ target: 48, aiEnabled: true })
    const result = analyzer.analyze()

    // Gemini(50) + OpenAI(200) + OpenRouter(200) + Ollama(∞) + Zen(∞) = ∞
    assert.ok(result.effectiveCapacity >= 48)
  })

  it('cost per day is negligible for free tier', () => {
    const analyzer = new AICostAnalyzer({ target: 48, aiEnabled: true })
    const result = analyzer.analyze()

    assert.equal(result.costPerDay.primary, 0)
  })
})

describe('Phase 11 — SafeCapacityCalculator', () => {
  it('computes safe capacity from evidence', () => {
    const calc = new SafeCapacityCalculator({ target: 48 })
    const result = calc.calculate()

    assert.ok(result.theoreticalCapacity > 0)
    assert.ok(typeof result.demonstratedCapacity === 'number')
    assert.ok(result.safeCapacity > 0)
    assert.ok(result.bottleneck)
    assert.ok(result.limits.length > 0)
  })

  it('bottleneck is the minimum resource', () => {
    const calc = new SafeCapacityCalculator({ target: 48 })
    const result = calc.calculate()

    const minCapacity = Math.min(...result.limits.map(l => l.capacity))
    assert.equal(result.theoreticalCapacity, minCapacity)
  })

  it('safe capacity has headroom applied', () => {
    const calc = new SafeCapacityCalculator({ target: 48 })
    const result = calc.calculate()

    const rawMin = Math.min(...result.limits.map(l => l.capacity))
    assert.ok(result.safeCapacity <= rawMin)
    assert.ok(result.safeCapacity > 0)
  })

  it('limits include render, youtube, images, tts, news, ai, c2pa, uniqueness', () => {
    const calc = new SafeCapacityCalculator({ target: 48 })
    const result = calc.calculate()

    const resources = result.limits.map(l => l.resource)
    assert.ok(resources.includes('render'))
    assert.ok(resources.includes('youtube'))
    assert.ok(resources.includes('images'))
    assert.ok(resources.includes('tts'))
    assert.ok(resources.includes('news'))
    assert.ok(resources.includes('ai'))
    assert.ok(resources.includes('c2pa'))
    assert.ok(resources.includes('uniqueness'))
  })

  it('meetsTarget is false when safeCapacity < target', () => {
    const calc = new SafeCapacityCalculator({ target: 48 })
    const result = calc.calculate()

    assert.equal(result.meetsTarget, false)
  })

  it('meetsTarget is true when safeCapacity >= target', () => {
    const calc = new SafeCapacityCalculator({ target: 3 })
    const result = calc.calculate()

    assert.equal(result.meetsTarget, true)
  })
})

describe('Phase 12 — ProductionCapacityGate', () => {
  it('evaluates to NOT_READY at 48/day', async () => {
    const gate = new ProductionCapacityGate({ target: 48 })
    const result = await gate.evaluate()

    assert.equal(result.status, 'NOT_READY')
    assert.equal(result.target, 48)
    assert.ok(result.reasons.length > 0)
  })

  it('includes safeCapacity in result', async () => {
    const gate = new ProductionCapacityGate({ target: 48 })
    const result = await gate.evaluate()

    assert.ok(typeof result.safeCapacity === 'number')
    assert.ok(result.safeCapacity > 0)
  })

  it('reports bottleneck', async () => {
    const gate = new ProductionCapacityGate({ target: 48 })
    const result = await gate.evaluate()

    assert.ok(result.bottleneck)
  })

  it('checks include capacity, uniqueness, scheduler, providers, publishing', async () => {
    const gate = new ProductionCapacityGate({ target: 48 })
    const result = await gate.evaluate()

    const checkNames = result.checks.map(c => c.name)
    assert.ok(checkNames.includes('safeCapacity'))
    assert.ok(checkNames.includes('scriptUniqueness'))
    assert.ok(checkNames.includes('sceneUniqueness'))
    assert.ok(checkNames.includes('musicUniqueness'))
    assert.ok(checkNames.includes('thumbnailUniqueness'))
    assert.ok(checkNames.includes('schedulerCapacity'))
    assert.ok(checkNames.includes('providerCapacity'))
    assert.ok(checkNames.includes('publishingCapacity'))
  })

  it('evaluates to READY at 3/day', async () => {
    const gate = new ProductionCapacityGate({ target: 3 })
    const result = await gate.evaluate()

    assert.equal(result.status, 'READY')
    assert.equal(result.reasons.length, 0)
  })

  it('reasons explain WHY not ready', async () => {
    const gate = new ProductionCapacityGate({ target: 48 })
    const result = await gate.evaluate()

    assert.ok(result.reasons.some(r => r.includes('Safe capacity')))
    assert.ok(result.reasons.some(r => r.includes('below target')))
  })
})
