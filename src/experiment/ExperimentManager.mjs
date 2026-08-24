import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'

/**
 * Manages controlled A/B experiments: deterministic vs AI-optimized strategy.
 *
 * Experiment schema:
 *   experimentId: STRATEGY_AI_VS_BASELINE_YYYY_MM
 *   variants: { control: deterministic, treatment: AI }
 *   assignment: hash-based deterministic per-article-title → variant
 *   metrics: per-video outcome recording
 *   results: aggregated comparison
 */

const EXPERIMENT_VERSION = 1

export class ExperimentManager {
  constructor(opts = {}) {
    this.experimentId = opts.experimentId || ExperimentManager.defaultExperimentId()
    this.enabled = opts.enabled ?? !!process.env.AI_EXPERIMENT_ENABLED
    this.filePath = opts.filePath || path.join(
      process.env.OUT_DIR || 'output',
      `.experiment-${this.experimentId}.json`
    )
    this._data = this._load()
  }

  static defaultExperimentId() {
    const d = new Date()
    return `STRATEGY_AI_VS_BASELINE_${d.getFullYear()}_${String(d.getMonth() + 1).padStart(2, '0')}`
  }

  /** Assign variant deterministically based on article title hash */
  assignVariant(articleTitle) {
    if (!this.enabled) return { variant: 'control', reason: 'experiment_disabled' }

    const hash = crypto.createHash('sha256').update(String(articleTitle)).digest('hex')
    const bucket = parseInt(hash.slice(0, 8), 16) % 100
    const variant = bucket < 50 ? 'control' : 'treatment'
    return { variant, hash: hash.slice(0, 12), bucket }
  }

  /** Should this production run use AI? */
  shouldUseAI(articleTitle) {
    if (!this.enabled) return false
    const { variant } = this.assignVariant(articleTitle)
    return variant === 'treatment'
  }

  /** Record a production run outcome */
  recordOutcome(entry) {
    const required = ['experimentId', 'variant', 'artifactId', 'niche']
    for (const k of required) {
      if (!entry[k]) throw new Error(`ExperimentManager.recordOutcome: missing ${k}`)
    }

    const record = {
      experimentId: this.experimentId,
      variant: entry.variant,
      planSource: entry.planSource || 'unknown',
      strategyVersion: entry.strategyVersion || EXPERIMENT_VERSION,
      artifactId: entry.artifactId,
      niche: entry.niche,
      articleTitle: entry.articleTitle || '',
      publishedAt: entry.publishedAt || new Date().toISOString(),

      // Strategy details
      hookStrategy: entry.hookStrategy || null,
      sceneStrategy: entry.sceneStrategy || null,
      visualStrategy: entry.visualStrategy || null,
      musicStrategy: entry.musicStrategy || null,
      thumbnailStrategy: entry.thumbnailStrategy || null,

      // AI details (treatment only)
      aiProvider: entry.aiProvider || null,
      aiLatencyMs: entry.aiLatencyMs || 0,
      aiFallback: entry.aiFallback || false,
      aiRecommendationsReceived: entry.aiRecommendationsReceived || 0,
      aiRecommendationsAccepted: entry.aiRecommendationsAccepted || 0,
      aiRecommendationsRejected: entry.aiRecommendationsRejected || 0,

      // Production metrics
      generationDurationMs: entry.generationDurationMs || 0,
      renderDurationMs: entry.renderDurationMs || 0,
      providerCalls: entry.providerCalls || 0,
      providerFailures: entry.providerFailures || 0,
      retryCount: entry.retryCount || 0,
      renderFailures: entry.renderFailures || 0,
      thumbnailRejections: entry.thumbnailRejections || 0,
      uniquenessRejections: entry.uniquenessRejections || 0,

      // Quality scores
      compositionScore: entry.compositionScore || null,
      hookScore: entry.hookScore || null,
      thumbnailScore: entry.thumbnailScore || null,
      visualRelevanceScore: entry.visualRelevanceScore || null,
      retentionPrediction: entry.retentionPrediction || null,

      // YouTube performance (filled later by analytics)
      impressions: entry.impressions || null,
      ctr: entry.ctr || null,
      views: entry.views || null,
      averageViewDuration: entry.averageViewDuration || null,
      averagePercentageViewed: entry.averagePercentageViewed || null,
      stayedToWatch: entry.stayedToWatch || null,
      likes: entry.likes || null,
      comments: entry.comments || null,
      shares: entry.shares || null,
      subscribersGenerated: entry.subscribersGenerated || null,

      recordedAt: new Date().toISOString(),
    }

    this._data.outcomes.push(record)
    this._save()
    return record
  }

  /** Update outcome with YouTube analytics (called post-publish) */
  updateAnalytics(artifactId, analytics) {
    const idx = this._data.outcomes.findIndex(o => o.artifactId === artifactId)
    if (idx === -1) return null
    const record = this._data.outcomes[idx]
    Object.assign(record, {
      impressions: analytics.impressions ?? record.impressions,
      ctr: analytics.ctr ?? record.ctr,
      views: analytics.views ?? record.views,
      averageViewDuration: analytics.averageViewDuration ?? record.averageViewDuration,
      averagePercentageViewed: analytics.averagePercentageViewed ?? record.averagePercentageViewed,
      stayedToWatch: analytics.stayedToWatch ?? record.stayedToWatch,
      likes: analytics.likes ?? record.likes,
      comments: analytics.comments ?? record.comments,
      shares: analytics.shares ?? record.shares,
      subscribersGenerated: analytics.subscribersGenerated ?? record.subscribersGenerated,
      analyticsUpdatedAt: new Date().toISOString(),
    })
    this._save()
    return record
  }

  /** Compute aggregated results comparing variants */
  getResults() {
    const outcomes = this._data.outcomes
    const control = outcomes.filter(o => o.variant === 'control')
    const treatment = outcomes.filter(o => o.variant === 'treatment')

    return {
      experimentId: this.experimentId,
      enabled: this.enabled,
      totalOutcomes: outcomes.length,
      control: this._aggregate(control),
      treatment: this._aggregate(treatment),
      comparison: this._compare(control, treatment),
    }
  }

  /** Get summary for logging */
  getSummary() {
    const results = this.getResults()
    return {
      experimentId: results.experimentId,
      enabled: results.enabled,
      total: results.totalOutcomes,
      controlCount: results.control.count,
      treatmentCount: results.treatment.count,
      controlAvgCTR: results.control.avgCTR,
      treatmentAvgCTR: results.treatment.avgCTR,
      controlAvgRetention: results.control.avgRetention,
      treatmentAvgRetention: results.treatment.avgRetention,
    }
  }

  _aggregate(group) {
    if (group.length === 0) return { count: 0 }
    const withCTR = group.filter(o => o.ctr != null)
    const withRetention = group.filter(o => o.averagePercentageViewed != null)
    const withDuration = group.filter(o => o.generationDurationMs > 0)
    const withAI = group.filter(o => o.aiLatencyMs > 0)

    return {
      count: group.length,
      avgCTR: withCTR.length > 0 ? withCTR.reduce((s, o) => s + o.ctr, 0) / withCTR.length : null,
      avgRetention: withRetention.length > 0 ? withRetention.reduce((s, o) => s + o.averagePercentageViewed, 0) / withRetention.length : null,
      avgGenerationMs: withDuration.length > 0 ? withDuration.reduce((s, o) => s + o.generationDurationMs, 0) / withDuration.length : null,
      avgAILatencyMs: withAI.length > 0 ? withAI.reduce((s, o) => s + o.aiLatencyMs, 0) / withAI.length : null,
      aiFallbackRate: group.length > 0 ? group.filter(o => o.aiFallback).length / group.length : 0,
      niches: [...new Set(group.map(o => o.niche))],
    }
  }

  _compare(control, treatment) {
    if (control.length === 0 || treatment.length === 0) return { sufficient: false, reason: 'insufficient data' }

    const cAgg = this._aggregate(control)
    const tAgg = this._aggregate(treatment)

    return {
      sufficient: cAgg.count >= 5 && tAgg.count >= 5,
      controlN: cAgg.count,
      treatmentN: tAgg.count,
      ctrDelta: cAgg.avgCTR != null && tAgg.avgCTR != null ? tAgg.avgCTR - cAgg.avgCTR : null,
      retentionDelta: cAgg.avgRetention != null && tAgg.avgRetention != null ? tAgg.avgRetention - cAgg.avgRetention : null,
      generationTimeDelta: cAgg.avgGenerationMs != null && tAgg.avgGenerationMs != null ? tAgg.avgGenerationMs - cAgg.avgGenerationMs : null,
      aiLatencyAvg: tAgg.avgAILatencyMs,
      aiFallbackRate: tAgg.aiFallbackRate,
      verdict: this._computeVerdict(cAgg, tAgg),
    }
  }

  _computeVerdict(cAgg, tAgg) {
    if (cAgg.count < 5 || tAgg.count < 5) return 'INSUFFICIENT_DATA'
    const ctrImproves = tAgg.avgCTR != null && cAgg.avgCTR != null && tAgg.avgCTR > cAgg.avgCTR
    const retImproves = tAgg.avgRetention != null && cAgg.avgRetention != null && tAgg.avgRetention > cAgg.avgRetention
    const fallbackLow = tAgg.aiFallbackRate < 0.2

    if (ctrImproves && retImproves && fallbackLow) return 'AI_IMPROVES'
    if (!ctrImproves && !retImproves) return 'AI_DOES_NOT_IMPROVE'
    return 'INCONCLUSIVE'
  }

  _load() {
    try {
      if (fs.existsSync(this.filePath)) {
        return JSON.parse(fs.readFileSync(this.filePath, 'utf8'))
      }
    } catch { /* corrupt file — start fresh */ }
    return { experimentId: this.experimentId, version: EXPERIMENT_VERSION, outcomes: [], createdAt: new Date().toISOString() }
  }

  _save() {
    try {
      const dir = path.dirname(this.filePath)
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
      fs.writeFileSync(this.filePath, JSON.stringify(this._data, null, 2))
    } catch { /* non-fatal — metrics still in memory */ }
  }
}
