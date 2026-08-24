/**
 * Structured per-production metrics collector.
 *
 * Records every measurable aspect of a production run for later analysis.
 * Designed to feed into ExperimentManager.recordOutcome() and ProductionManifest.
 */

export class MetricsCollector {
  constructor(opts = {}) {
    this._startTime = Date.now()
    this._milestones = {}
    this._counters = {
      providerCalls: 0,
      providerFailures: 0,
      retryCount: 0,
      renderFailures: 0,
      thumbnailRejections: 0,
      uniquenessRejections: 0,
    }
    this._quality = {
      compositionScore: null,
      hookScore: null,
      thumbnailScore: null,
      visualRelevanceScore: null,
      retentionPrediction: null,
    }
    this._ai = {
      called: false,
      provider: null,
      latencyMs: 0,
      fallback: false,
      recommendationsReceived: 0,
      recommendationsAccepted: 0,
      recommendationsRejected: 0,
      rejectionReasons: [],
    }
    this._providers = {
      ai: null,
      tts: null,
      rendering: null,
      imageSearch: null,
    }
    this._youtube = {}
    this._stages = {}
    this._metadata = {}
  }

  // ── Milestone timing ──────────────────────────────────────────────

  milestone(name) {
    this._milestones[name] = Date.now()
  }

  milestoneDuration(name) {
    if (!this._milestones[name]) return 0
    const next = Object.values(this._milestones).find(t => t > this._milestones[name])
    return (next || Date.now()) - this._milestones[name]
  }

  totalDurationMs() {
    return Date.now() - this._startTime
  }

  // ── Counters ──────────────────────────────────────────────────────

  incrementCounter(name, amount = 1) {
    if (name in this._counters) this._counters[name] += amount
  }

  // ── AI tracking ───────────────────────────────────────────────────

  recordAI(result) {
    this._ai.called = true
    this._ai.provider = result.provider || null
    this._ai.latencyMs = result.latencyMs || 0
    this._ai.fallback = result.fallback || false
    this._ai.recommendationsReceived = result.recommendationsReceived || 0
    this._ai.recommendationsAccepted = result.recommendationsAccepted || 0
    this._ai.recommendationsRejected = result.recommendationsRejected || 0
    this._ai.rejectionReasons = result.rejectionReasons || []
  }

  recordAIFallback(reason) {
    this._ai.fallback = true
    this._ai.rejectionReasons.push(reason)
  }

  // ── Quality scores ────────────────────────────────────────────────

  setQuality(score, value) {
    if (score in this._quality) this._quality[score] = value
  }

  // ── Provider tracking ─────────────────────────────────────────────

  setProvider(type, name) {
    if (type in this._providers) this._providers[type] = name
  }

  // ── Stage tracking ────────────────────────────────────────────────

  setStage(name, data) {
    this._stages[name] = { ...(this._stages[name] || {}), ...data }
  }

  // ── YouTube analytics ─────────────────────────────────────────────

  setYouTube(data) {
    Object.assign(this._youtube, data)
  }

  // ── Metadata ──────────────────────────────────────────────────────

  setMetadata(key, value) {
    this._metadata[key] = value
  }

  // ── Export ─────────────────────────────────────────────────────────

  /** Export all collected metrics as a flat object */
  export() {
    return {
      // Timing
      generationDurationMs: this.totalDurationMs(),
      renderDurationMs: this.milestoneDuration('render'),

      // Counters
      ...this._counters,

      // AI
      aiCalled: this._ai.called,
      aiProvider: this._ai.provider,
      aiLatencyMs: this._ai.latencyMs,
      aiFallback: this._ai.fallback,
      aiRecommendationsReceived: this._ai.recommendationsReceived,
      aiRecommendationsAccepted: this._ai.recommendationsAccepted,
      aiRecommendationsRejected: this._ai.recommendationsRejected,

      // Quality
      ...this._quality,

      // Providers
      ...this._providers,

      // Stages
      stages: { ...this._stages },

      // YouTube
      youtube: { ...this._youtube },

      // Metadata
      metadata: { ...this._metadata },
    }
  }

  /** Convert to ExperimentManager-compatible record */
  toExperimentRecord(opts = {}) {
    const metrics = this.export()
    return {
      experimentId: opts.experimentId || null,
      variant: opts.variant || 'control',
      planSource: opts.planSource || 'unknown',
      strategyVersion: opts.strategyVersion || 1,
      artifactId: opts.artifactId || null,
      niche: opts.niche || 'GENERAL',
      articleTitle: opts.articleTitle || '',

      // Strategy details
      hookStrategy: opts.hookStrategy || null,
      sceneStrategy: opts.sceneStrategy || null,
      visualStrategy: opts.visualStrategy || null,
      musicStrategy: opts.musicStrategy || null,
      thumbnailStrategy: opts.thumbnailStrategy || null,

      // AI
      aiProvider: metrics.aiProvider,
      aiLatencyMs: metrics.aiLatencyMs,
      aiFallback: metrics.aiFallback,
      aiRecommendationsReceived: metrics.aiRecommendationsReceived,
      aiRecommendationsAccepted: metrics.aiRecommendationsAccepted,
      aiRecommendationsRejected: metrics.aiRecommendationsRejected,

      // Production
      generationDurationMs: metrics.generationDurationMs,
      renderDurationMs: metrics.renderDurationMs,
      providerCalls: metrics.providerCalls,
      providerFailures: metrics.providerFailures,
      retryCount: metrics.retryCount,
      renderFailures: metrics.renderFailures,
      thumbnailRejections: metrics.thumbnailRejections,
      uniquenessRejections: metrics.uniquenessRejections,

      // Quality
      compositionScore: metrics.compositionScore,
      hookScore: metrics.hookScore,
      thumbnailScore: metrics.thumbnailScore,
      visualRelevanceScore: metrics.visualRelevanceScore,
      retentionPrediction: metrics.retentionPrediction,
    }
  }
}
