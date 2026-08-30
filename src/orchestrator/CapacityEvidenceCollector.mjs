/**
 * CapacityEvidenceCollector — aggregates actual production evidence to determine
 * real capacity. Every value is classified as observed / estimated / configured / unknown.
 *
 * Does NOT assume 48/day. Reports what is measured.
 */

import fs from 'node:fs'
import path from 'node:path'
import { ProductionHistoryReader } from './ProductionHistoryReader.mjs'

export class CapacityEvidenceCollector {
  constructor(opts = {}) {
    this.reader = opts.reader || new ProductionHistoryReader(opts)
    this.outDir = opts.outDir || path.resolve('output')
  }

  /**
   * Collect all capacity evidence.
   * @returns {object} Complete evidence report with classifications.
   */
  collect() {
    const history = this.reader.collect()
    const providerMatrix = this._collectProviderEvidence()
    const uniquenessEvidence = this._collectUniquenessEvidence()
    const schedulerEvidence = this._collectSchedulerEvidence()
    const aiEvidence = this._collectAIEvidence()
    const renderEvidence = this._collectRenderEvidence(history)

    // Compute capacity from all evidence
    const capacity = this._computeCapacity({
      history,
      providerMatrix,
      renderEvidence,
      aiEvidence,
      schedulerEvidence,
    })

    return {
      collectedAt: new Date().toISOString(),
      window: history.window,
      throughput: history.throughput,
      timing: history.timing,
      render: renderEvidence,
      resources: history.resources,
      providers: providerMatrix,
      uniqueness: uniquenessEvidence,
      scheduler: schedulerEvidence,
      ai: aiEvidence,
      capacity,
      failures: history.failures,
      _sources: {
        ...history._sources,
        providerMatrix: 'configured',
        uniqueness: uniquenessEvidence._source || 'configured',
        scheduler: schedulerEvidence._source || 'configured',
        ai: aiEvidence._source || 'configured',
        render: renderEvidence._source || 'configured',
      },
    }
  }

  /**
   * Collect evidence about each provider's capacity.
   */
  _collectProviderEvidence() {
    const providers = {}

    // YouTube
    const ytQuota = this._readEnvNumber('YOUTUBE_DAILY_QUOTA', 10000)
    const ytUploads = this._readEnvNumber('YOUTUBE_DAILY_UPLOADS', 6)
    const ytCostPerUpload = 1600 // YouTube API cost per video upload
    providers.youtube = {
      operation: 'videos.insert + thumbnails.set',
      dailyLimit: ytUploads,
      monthlyLimit: this._readEnvNumber('YOUTUBE_MONTHLY_UPLOADS', 100),
      dailyQuotaUnits: ytQuota,
      costPerUploadUnits: ytCostPerUpload,
      theoreticalMaxPerDay: Math.floor(ytQuota / ytCostPerUpload),
      remaining: 'unknown',
      resetAt: 'unknown',
      observedRateLimit: null,
      fallback: 'none',
      _classification: 'configured',
    }

    // ElevenLabs
    providers.elevenlabs = {
      operation: 'text-to-speech',
      dailyLimit: this._readEnvNumber('ELEVENLABS_DAILY_LIMIT', 10),
      monthlyLimit: 200,
      dailyChars: this._readEnvNumber('ELEVENLABS_DAILY_CHARS', 10000),
      charsPerVideo: 1500,
      theoreticalMaxPerDay: Math.floor(this._readEnvNumber('ELEVENLABS_DAILY_CHARS', 10000) / 1500),
      fallback: 'edge-tts (local)',
      _classification: 'configured',
    }

    // Pexels
    providers.pexels = {
      operation: 'image search + download',
      dailyLimit: this._readEnvNumber('PEXELS_DAILY_LIMIT', 200),
      monthlyLimit: 5000,
      requestsPerVideo: 8,
      theoreticalMaxPerDay: Math.floor(this._readEnvNumber('PEXELS_DAILY_LIMIT', 200) / 8),
      fallback: 'cached images',
      _classification: 'configured',
    }

    // NewsAPI
    providers.newsapi = {
      operation: 'news search',
      dailyLimit: 100,
      monthlyLimit: 1000,
      requestsPerVideo: 2,
      theoreticalMaxPerDay: 50,
      fallback: 'NewsData, RapidNews',
      _classification: 'configured',
    }

    // RapidNews
    providers.rapidnews = {
      operation: 'real-time news',
      dailyLimit: 3,
      monthlyLimit: 100,
      requestsPerVideo: 1,
      theoreticalMaxPerDay: 3,
      fallback: 'NewsAPI, NewsData',
      _classification: 'configured',
    }

    // Gemini
    providers.gemini = {
      operation: 'AI strategy',
      dailyLimit: 1500,
      monthlyLimit: 0,
      requestsPerVideo: 2,
      theoreticalMaxPerDay: 750,
      fallback: 'OpenAI, OpenRouter, Ollama, Zen',
      _classification: 'configured',
    }

    return providers
  }

  /**
   * Collect uniqueness enforcement evidence.
   */
  _collectUniquenessEvidence() {
    const registry = this.reader.readAssetRegistry()
    const gates = {
      'scene-within-video': { enforcement: 'ENFORCED', _source: 'code' },
      'scene-across-video': { enforcement: 'ENFORCED', _source: 'code' },
      'music-within-video': { enforcement: 'ENFORCED', _source: 'code' },
      'music-across-video': { enforcement: 'ENFORCED', _source: 'code' },
      'thumbnail-within-video': { enforcement: 'BEST_EFFORT', _source: 'code' },
      'thumbnail-across-video': { enforcement: 'ENFORCED', _source: 'code' },
      'script-within-video': { enforcement: 'NOT_ENFORCED', _source: 'code', note: 'ScriptUniqueness exists but not wired into GlobalGate' },
      'script-across-video': { enforcement: 'NOT_ENFORCED', _source: 'code', note: 'ScriptUniqueness exists but not wired into GlobalGate' },
    }

    return {
      registry,
      gates,
      rollingWindow: registry.rollingWindow || 50,
      _source: 'observed+code',
    }
  }

  /**
   * Collect scheduler evidence.
   */
  _collectSchedulerEvidence() {
    const schedulerPath = path.resolve('src/orchestrator/ProductionScheduler.mjs')
    const exists = fs.existsSync(schedulerPath)

    return {
      exists,
      deployed: false, // Not wired into production workflow
      maxConcurrency: 2, // From code
      crashRecovery: true, // CheckpointStore
      duplicatePrevention: true, // ArticleDatabase
      _source: exists ? 'code' : 'unknown',
    }
  }

  /**
   * Collect AI strategy evidence.
   */
  _collectAIEvidence() {
    const aiLayerPath = path.resolve('src/ai/AiStrategyLayer.mjs')
    const controllerPath = path.resolve('src/ai/ProductionStrategyController.mjs')
    const exists = fs.existsSync(aiLayerPath) && fs.existsSync(controllerPath)

    const manifests = this.reader.readProductionManifests()
    const totalCalls = manifests.resources?.aiCallsTotal || 0
    const totalFallbacks = manifests.resources?.aiFallbacksTotal || 0

    return {
      exists,
      callsPerVideo: totalCalls > 0 ? Math.round(totalCalls / Math.max(1, manifests.manifests.length)) : 'unknown',
      fallbackRate: totalCalls > 0 ? (totalFallbacks / totalCalls) : 'unknown',
      providers: ['gemini', 'openai', 'openrouter', 'ollama', 'zen'],
      _source: exists ? (totalCalls > 0 ? 'observed' : 'code') : 'unknown',
    }
  }

  /**
   * Collect render capacity evidence from actual timing data.
   */
  _collectRenderEvidence(history) {
    const renderTiming = history.timing?.render

    if (!renderTiming || renderTiming.source !== 'observed') {
      return {
        p50Ms: 'unknown',
        p95Ms: 'unknown',
        theoreticalPerDay: 'unknown',
        workers: 1,
        _source: 'unknown',
      }
    }

    const p50Ms = renderTiming.p50Ms
    const p95Ms = renderTiming.p95Ms
    const theoreticalPerDay = Math.floor((24 * 60 * 60 * 1000) / p95Ms) // Use P95 for safety
    const theoreticalPerDayAvg = Math.floor((24 * 60 * 60 * 1000) / renderTiming.avgMs)

    return {
      p50Ms,
      p95Ms,
      avgMs: renderTiming.avgMs,
      minMs: renderTiming.minMs,
      maxMs: renderTiming.maxMs,
      n: renderTiming.n,
      theoreticalPerDay,
      theoreticalPerDayAvg,
      workers: 1,
      _source: 'observed',
    }
  }

  /**
   * Compute capacity from all evidence.
   */
  _computeCapacity({ history, providerMatrix, renderEvidence, aiEvidence, schedulerEvidence }) {
    const limits = []

    // Render limit (use P95 for safety)
    if (renderEvidence.theoreticalPerDay !== 'unknown') {
      limits.push({ resource: 'render', capacity: renderEvidence.theoreticalPerDay, source: 'observed' })
    }

    // YouTube limit
    limits.push({
      resource: 'youtube',
      capacity: providerMatrix.youtube.theoreticalMaxPerDay,
      source: 'configured',
      note: `Budget limit: ${providerMatrix.youtube.dailyLimit}, Quota limit: ${providerMatrix.youtube.theoreticalMaxPerDay}`,
    })

    // ElevenLabs limit
    limits.push({
      resource: 'tts',
      capacity: providerMatrix.elevenlabs.theoreticalMaxPerDay,
      source: 'configured',
    })

    // Pexels limit
    limits.push({
      resource: 'images',
      capacity: providerMatrix.pexels.theoreticalMaxPerDay,
      source: 'configured',
    })

    // RapidNews limit
    limits.push({
      resource: 'news',
      capacity: providerMatrix.rapidnews.theoreticalMaxPerDay,
      source: 'configured',
    })

    // AI limit
    if (aiEvidence.callsPerVideo !== 'unknown' && aiEvidence.callsPerVideo > 0) {
      limits.push({
        resource: 'ai',
        capacity: Math.floor(providerMatrix.gemini.dailyLimit / aiEvidence.callsPerVideo),
        source: 'configured',
      })
    } else {
      limits.push({ resource: 'ai', capacity: providerMatrix.gemini.theoreticalMaxPerDay, source: 'configured' })
    }

    // Scheduler limit
    limits.push({
      resource: 'scheduler',
      capacity: schedulerEvidence.exists ? 96 : 48, // 2 concurrent * 48 slots/day
      source: schedulerEvidence.deployed ? 'observed' : 'estimated',
    })

    // Find bottleneck (lowest capacity)
    const sorted = [...limits].sort((a, b) => a.capacity - b.capacity)
    const bottleneck = sorted[0]
    const theoreticalCapacity = bottleneck ? bottleneck.capacity : 0

    // Demonstrated capacity from actual throughput
    const demonstratedCapacity = history.throughput?.videosPerDay || 0

    // Safe capacity: minimum of all limits with headroom
    // Use P95 render time, failure rates, and operational margin
    const safeCapacity = Math.floor(theoreticalCapacity * 0.7) // 30% operational headroom

    return {
      theoreticalCapacity,
      demonstratedCapacity: Math.round(demonstratedCapacity * 10) / 10,
      safeCapacity,
      bottleneck: bottleneck?.resource || 'none',
      limits,
      target: 48,
      achievable48: safeCapacity >= 48,
      _classifications: {
        theoreticalCapacity: sorted[0]?.source || 'unknown',
        demonstratedCapacity: history.throughput?.videosPerDay ? 'observed' : 'unknown',
        safeCapacity: 'estimated',
      },
    }
  }

  _readEnvNumber(key, fallback) {
    const val = process.env[key]
    if (!val) return fallback
    const num = Number(val)
    return isNaN(num) ? fallback : num
  }
}
