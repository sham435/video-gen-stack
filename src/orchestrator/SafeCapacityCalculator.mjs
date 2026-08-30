/**
 * SafeCapacityCalculator — computes THEORETICAL, DEMONSTRATED, and SAFE
 * production capacity from empirical evidence.
 *
 * SAFE_CAPACITY = min(all resource capacities) × operationalHeadroom
 *
 * Headroom policy:
 *   - 30% for resources with observed failure data
 *   - 20% for resources with only configured limits
 *   - 10% for local resources (render, C2PA) with no external dependency
 *
 * The bottleneck is the MINIMUM capacity, not the average.
 */

import { CapacityEvidenceCollector } from './CapacityEvidenceCollector.mjs'
import { AssetCapacityAnalyzer } from './AssetCapacityAnalyzer.mjs'
import { YouTubeQuotaAuditor } from './YouTubeQuotaAuditor.mjs'
import { ProviderCapacityMatrix } from './ProviderCapacityMatrix.mjs'
import { AICostAnalyzer } from './AICostAnalyzer.mjs'

const HEADROOM_POLICIES = {
  observed: 0.70,    // 30% headroom for observed resources
  configured: 0.80,  // 20% headroom for configured-only resources
  local: 0.90,       // 10% headroom for local resources
}

export class SafeCapacityCalculator {
  constructor(opts = {}) {
    this.target = opts.target || 48
    this.evidenceCollector = opts.evidenceCollector || new CapacityEvidenceCollector(opts)
    this.headroomOverrides = opts.headroomOverrides || {}
  }

  /**
   * Calculate safe capacity from all evidence sources.
   * @returns {object} THEORETICAL, DEMONSTRATED, SAFE capacity with bottleneck
   */
  calculate() {
    // Gather evidence from all sources
    const evidence = this.evidenceCollector.collect()
    const assetAnalysis = new AssetCapacityAnalyzer({ target: this.target }).analyze()
    const youtubeAudit = new YouTubeQuotaAuditor().audit()
    const providerMatrix = new ProviderCapacityMatrix({ target: this.target }).build()
    const aiAnalysis = new AICostAnalyzer({ target: this.target }).analyze()

    // Build capacity limits from all evidence
    const limits = this._buildCapacityLimits({
      evidence,
      assetAnalysis,
      youtubeAudit,
      providerMatrix,
      aiAnalysis,
    })

    // Find bottleneck (minimum capacity)
    const sorted = [...limits].sort((a, b) => a.capacity - b.capacity)
    const bottleneck = sorted[0]

    // Compute theoretical capacity (sum of limits, not min)
    const theoreticalCapacity = Math.min(...limits.map(l => l.capacity))

    // Compute demonstrated capacity from actual throughput
    const demonstratedCapacity = evidence.throughput?.videosPerDay || 0

    // Compute safe capacity (min × headroom)
    const headroom = this._getHeadroom(bottleneck?.source || 'configured')
    const safeCapacity = Math.floor(theoreticalCapacity * headroom)

    return {
      target: this.target,
      theoreticalCapacity,
      demonstratedCapacity: Math.round(demonstratedCapacity * 10) / 10,
      safeCapacity,
      bottleneck: bottleneck?.resource || 'none',
      bottleneckCapacity: bottleneck?.capacity || 0,
      headroom,
      headroomPolicy: HEADROOM_POLICIES,
      limits,
      meetsTarget: safeCapacity >= this.target,
      evidenceWindow: evidence.window,
      _classifications: {
        theoreticalCapacity: bottleneck?.source || 'unknown',
        demonstratedCapacity: evidence.throughput?.videosPerDay ? 'observed' : 'unknown',
        safeCapacity: 'computed',
      },
      _timestamp: new Date().toISOString(),
    }
  }

  _buildCapacityLimits({ evidence, assetAnalysis, youtubeAudit, providerMatrix, aiAnalysis }) {
    const limits = []

    // Render capacity (from observed P95 timing)
    if (evidence.render?.p95Ms !== 'unknown') {
      const renderPerDay = Math.floor((24 * 60 * 60 * 1000) / evidence.render.p95Ms)
      limits.push({
        resource: 'render',
        capacity: renderPerDay,
        source: 'observed',
        note: `P95=${evidence.render.p95Ms}ms, ${evidence.render.n} samples`,
      })
    } else {
      limits.push({ resource: 'render', capacity: 1920, source: 'estimated', note: '45s avg render' })
    }

    // YouTube upload capacity
    limits.push({
      resource: 'youtube',
      capacity: youtubeAudit.safeCapacity,
      source: 'configured',
      note: `Budget: ${youtubeAudit.budgetDailyLimit}/day, Quota: ${youtubeAudit.configuredDailyQuota} units`,
    })

    // Image supply (Pexels)
    const pexelsProvider = providerMatrix.providers?.pexels
    if (pexelsProvider) {
      const imageCapacity = Math.floor(pexelsProvider.dailyLimit / 8) // 8 requests per video
      limits.push({
        resource: 'images',
        capacity: imageCapacity,
        source: 'configured',
        note: `Pexels: ${pexelsProvider.dailyLimit}/day, 8 req/video`,
      })
    }

    // TTS (ElevenLabs)
    const ttsProvider = providerMatrix.providers?.elevenlabs
    if (ttsProvider) {
      limits.push({
        resource: 'tts',
        capacity: ttsProvider.capacityPerDay,
        source: 'configured',
        note: `ElevenLabs: ${ttsProvider.dailyLimit}/day, 1 req/video`,
      })
    }

    // News supply (combined: RapidNews + NewsData + NewsAPI)
    const newsCapacity = this._computeNewsCapacity(providerMatrix)
    limits.push({
      resource: 'news',
      capacity: newsCapacity,
      source: 'configured',
      note: `Combined: RapidNews(3) + NewsData(50) + NewsAPI(100) = ${newsCapacity}`,
    })

    // AI capacity
    limits.push({
      resource: 'ai',
      capacity: aiAnalysis.effectiveCapacity,
      source: 'configured',
      note: `Gemini(50) + OpenAI(200) + OpenRouter(200) = ${aiAnalysis.effectiveCapacity}`,
    })

    // C2PA (local)
    limits.push({
      resource: 'c2pa',
      capacity: 1000,
      source: 'local',
      note: 'Local signing, no external limit',
    })

    // Uniqueness (rolling window = 50 scripts)
    limits.push({
      resource: 'uniqueness',
      capacity: 50,
      source: 'configured',
      note: 'Rolling window of 50 unique scripts',
    })

    return limits
  }

  _computeNewsCapacity(providerMatrix) {
    // News is a chain: RapidNews(3) → NewsData(50) → NewsAPI(100)
    // Effective capacity = sum (since fallbacks provide additional capacity)
    const rapidnews = providerMatrix.providers?.rapidnews?.dailyLimit || 0
    const newsdata = providerMatrix.providers?.newsdata?.dailyLimit || 0
    const newsapi = providerMatrix.providers?.newsapi?.dailyLimit || 0
    return rapidnews + newsdata + newsapi
  }

  _getHeadroom(source) {
    if (this.headroomOverrides[source] !== undefined) {
      return this.headroomOverrides[source]
    }
    return HEADROOM_POLICIES[source] || HEADROOM_POLICIES.configured
  }
}
