/**
 * AssetCapacityAnalyzer — verifies whether daily asset supply can support
 * a target production rate. Reports actual demand, not theoretical provider limits.
 *
 * 48 videos/day demand:
 *   scenes:       240–480/day (5–10 scenes per video)
 *   music:         48/day (1 track per video)
 *   thumbnails:    48/day (3–5 candidates per video = 144–240 generated)
 *   scripts:       48/day (1 per video)
 *   AI calls:      varies by strategy mode
 *   TTS:           48/day (1 narration per video)
 */

import { getBudget } from '../governor/ProviderBudgets.mjs'

const DEFAULT_SCENES_PER_VIDEO = { min: 5, max: 10 }
const DEFAULT_THUMBNAILS_PER_VIDEO = { min: 3, max: 5 }
const DEFAULT_CHARS_PER_SCRIPT = 1500
const DEFAULT_REQUESTS_PER_VIDEO = {
  images: 8,     // Pexels: ~6 scenes + 1 hero + 1 fallback
  tts: 1,        // ElevenLabs: 1 call per video
  news: 1,       // NewsData/RapidNews: 1 fetch per video
  ai: 2,         // Gemini: strategy + optional refinement
}

export class AssetCapacityAnalyzer {
  constructor(opts = {}) {
    this.target = opts.target || 48
    this.scenesPerVideo = opts.scenesPerVideo || DEFAULT_SCENES_PER_VIDEO
    this.thumbnailsPerVideo = opts.thumbnailsPerVideo || DEFAULT_THUMBNAILS_PER_VIDEO
    this.requestsPerVideo = { ...DEFAULT_REQUESTS_PER_VIDEO, ...opts.requestsPerVideo }
  }

  /**
   * Analyze asset capacity against target production rate.
   * @returns {object} Capacity analysis with demand, supply, bottlenecks
   */
  analyze() {
    const demand = this._computeDemand()
    const supply = this._computeSupply()
    const bottlenecks = this._findBottlenecks(demand, supply)
    const status = this._determineStatus(bottlenecks)

    return {
      target: this.target,
      required: demand,
      available: supply,
      providerCapacity: this._buildProviderMatrix(),
      bottlenecks,
      status,
      _classification: 'computed',
      _timestamp: new Date().toISOString(),
    }
  }

  _computeDemand() {
    return {
      scenes: {
        min: this.target * this.scenesPerVideo.min,
        max: this.target * this.scenesPerVideo.max,
        perVideo: this.scenesPerVideo,
      },
      music: { count: this.target, perVideo: 1 },
      thumbnails: {
        generated: this.target * this.thumbnailsPerVideo.max,
        uploaded: this.target,
        perVideo: this.thumbnailsPerVideo,
      },
      scripts: { count: this.target, perVideo: 1 },
      tts: {
        chars: this.target * DEFAULT_CHARS_PER_SCRIPT,
        calls: this.target,
        perVideo: { chars: DEFAULT_CHARS_PER_SCRIPT },
      },
      images: {
        requests: this.target * this.requestsPerVideo.images,
        perVideo: this.requestsPerVideo.images,
      },
      ai: {
        requests: this.target * this.requestsPerVideo.ai,
        perVideo: this.requestsPerVideo.ai,
      },
    }
  }

  _computeSupply() {
    const budgets = {}
    const resourceTypes = ['rapidnews', 'elevenlabs', 'youtube', 'newsdata', 'newsapi', 'pexels', 'gemini']

    for (const resource of resourceTypes) {
      const budget = getBudget(resource)
      if (!budget) continue

      const perVideo = this.requestsPerVideo[resource] ||
        this.requestsPerVideo[this._mapResourceToCategory(resource)] || 1
      const capacityPerDay = Math.floor(budget.daily / perVideo)

      budgets[resource] = {
        dailyLimit: budget.daily,
        monthlyLimit: budget.monthly,
        perVideo: perVideo,
        capacityPerDay,
        fallback: this._getFallback(resource),
      }
    }

    // Rendering: local, no external quota
    budgets.render = {
      dailyLimit: 'unlimited (local)',
      monthlyLimit: 'unlimited',
      perVideo: 1,
      capacityPerDay: this._estimateRenderCapacity(),
      fallback: 'none',
    }

    // C2PA: local signing
    budgets.c2pa = {
      dailyLimit: 'unlimited (local)',
      monthlyLimit: 'unlimited',
      perVideo: 1,
      capacityPerDay: 1000,
      fallback: 'none',
    }

    return budgets
  }

  _estimateRenderCapacity() {
    // Conservative: 45s per video, 1 worker, 24h
    return Math.floor((24 * 3600) / 45)
  }

  _buildProviderMatrix() {
    const matrix = {}
    const resourceTypes = ['rapidnews', 'elevenlabs', 'youtube', 'newsdata', 'newsapi', 'pexels', 'gemini']

    for (const resource of resourceTypes) {
      const budget = getBudget(resource)
      if (!budget) continue

      matrix[resource] = {
        provider: resource,
        operation: this._getOperation(resource),
        dailyLimit: budget.daily,
        monthlyLimit: budget.monthly,
        remaining: budget.daily, // Fresh day
        rateLimit: budget.cooldownMs || 0,
        latencyP95Ms: this._getLatencyP95(resource),
        fallback: this._getFallback(resource),
        capacityPerDay: budget.daily,
      }
    }

    return matrix
  }

  _findBottlenecks(demand, supply) {
    const bottlenecks = []

    // Check scene supply
    if (supply.pexels) {
      const imageCapacity = supply.pexels.capacityPerDay
      const scenesNeeded = demand.scenes.max
      if (imageCapacity < scenesNeeded) {
        bottlenecks.push({
          resource: 'images',
          required: scenesNeeded,
          available: imageCapacity,
          severity: imageCapacity < demand.scenes.min ? 'BLOCKED' : 'DEGRADED',
          reason: `Pexels can supply ${imageCapacity} scenes/day, need ${scenesNeeded}`,
        })
      }
    }

    // Check music supply
    if (supply.pexels) {
      const musicCapacity = Math.floor(supply.pexels.dailyLimit / 2) // ~2 requests per music track
      if (musicCapacity < demand.music.count) {
        bottlenecks.push({
          resource: 'music',
          required: demand.music.count,
          available: musicCapacity,
          severity: 'DEGRADED',
          reason: `Pexels music capacity ${musicCapacity}/day, need ${demand.music.count}`,
        })
      }
    }

    // Check TTS supply
    if (supply.elevenlabs) {
      const ttsCapacity = supply.elevenlabs.capacityPerDay
      if (ttsCapacity < demand.tts.calls) {
        bottlenecks.push({
          resource: 'tts',
          required: demand.tts.calls,
          available: ttsCapacity,
          severity: ttsCapacity < 12 ? 'BLOCKED' : 'DEGRADED',
          reason: `ElevenLabs capacity ${ttsCapacity}/day, need ${demand.tts.calls}. Fallback: edge-tts (local)`,
        })
      }
    }

    // Check YouTube upload capacity
    if (supply.youtube) {
      const uploadCapacity = supply.youtube.capacityPerDay
      if (uploadCapacity < this.target) {
        bottlenecks.push({
          resource: 'youtube',
          required: this.target,
          available: uploadCapacity,
          severity: uploadCapacity < 24 ? 'BLOCKED' : 'DEGRADED',
          reason: `YouTube capacity ${uploadCapacity}/day (budget limit), need ${this.target}`,
        })
      }
    }

    // Check news supply
    if (supply.rapidnews) {
      const newsCapacity = supply.rapidnews.capacityPerDay
      if (newsCapacity < this.target) {
        bottlenecks.push({
          resource: 'news',
          required: this.target,
          available: newsCapacity,
          severity: newsCapacity < 12 ? 'BLOCKED' : 'DEGRADED',
          reason: `RapidNews capacity ${newsCapacity}/day, need ${this.target}. Fallbacks: NewsData (${supply.newsdata?.capacityPerDay || 50}/day), NewsAPI (${supply.newsapi?.capacityPerDay || 100}/day)`,
        })
      }
    }

    // Check AI supply
    if (supply.gemini) {
      const aiCapacity = supply.gemini.capacityPerDay
      if (aiCapacity < this.target) {
        bottlenecks.push({
          resource: 'ai',
          required: this.target,
          available: aiCapacity,
          severity: 'DEGRADED',
          reason: `Gemini capacity ${aiCapacity}/day, need ${this.target}. Fallbacks: OpenAI, Ollama, Zen`,
        })
      }
    }

    return bottlenecks
  }

  _determineStatus(bottlenecks) {
    if (bottlenecks.length === 0) return 'PASS'
    if (bottlenecks.some(b => b.severity === 'BLOCKED')) return 'BLOCKED'
    return 'DEGRADED'
  }

  _mapResourceToCategory(resource) {
    const map = {
      rapidnews: 'news',
      elevenlabs: 'tts',
      newsdata: 'news',
      newsapi: 'news',
      pexels: 'images',
      gemini: 'ai',
    }
    return map[resource] || resource
  }

  _getOperation(resource) {
    const ops = {
      rapidnews: 'real-time news fetch',
      elevenlabs: 'text-to-speech',
      youtube: 'video upload + thumbnail',
      newsdata: 'news search',
      newsapi: 'news headlines',
      pexels: 'image search + download',
      gemini: 'AI strategy generation',
    }
    return ops[resource] || resource
  }

  _getFallback(resource) {
    const fallbacks = {
      rapidnews: 'NewsData → NewsAPI',
      elevenlabs: 'edge-tts (local)',
      youtube: 'none',
      newsdata: 'NewsAPI → RapidNews',
      newsapi: 'NewsData → RapidNews',
      pexels: 'cached images',
      gemini: 'OpenAI → OpenRouter → Ollama → Zen',
    }
    return fallbacks[resource] || 'none'
  }

  _getLatencyP95(resource) {
    const latencies = {
      rapidnews: 2000,
      elevenlabs: 5000,
      youtube: 30000,
      newsdata: 1500,
      newsapi: 1500,
      pexels: 1000,
      gemini: 3000,
    }
    return latencies[resource] || 1000
  }
}
