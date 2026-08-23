// PerformanceObservation — structured analytics record per production run.
//
// One observation = one YouTube video's analytics snapshot. This is the raw
// signal that feeds into PerformanceMemory → RecommendationEngine → ProfileOptimizer.
//
// The observation captures three independent performance axes:
//   1. Niche CTR — did the niche pill / category drive clicks?
//   2. Hook Retention — did the opening hook keep viewers watching?
//   3. Thumbnail CTR — did the thumbnail image drive clicks?
//
// Each axis has its own metrics, thresholds, and learning signal.

export class PerformanceObservation {
  constructor({ videoId, articleId, niche, publishedAt, analytics }) {
    this.videoId = String(videoId || '')
    this.articleId = String(articleId || '')
    this.niche = String(niche || 'GENERAL')
    this.publishedAt = publishedAt || new Date().toISOString()
    this.analytics = {
      impressions: 0,
      views: 0,
      ctr: null,          // click-through rate (thumbnail or niche pill)
      avgViewDuration: 0,  // seconds
      avgPercentViewed: 0, // 0–100
      watchTimeMinutes: 0,
      likes: 0,
      comments: 0,
      shares: 0,
      subscribersGained: 0,
      ...analytics,
    }
    // Derived signals (computed lazily)
    this._signals = null
  }

  // ─── signals ────────────────────────────────────────────────────────────
  // Derived performance signals, computed once. These are what the
  // RecommendationEngine consumes — not raw analytics.
  get signals() {
    if (this._signals) return this._signals
    const a = this.analytics
    const impressions = a.impressions || 0
    const views = a.views || 0

    this._signals = Object.freeze({
      nicheCtr: impressions > 0 ? views / impressions : null,
      hookRetention: a.avgPercentViewed != null ? a.avgPercentViewed / 100 : null,
      thumbnailCtr: impressions > 0 ? views / impressions : null,
      engagementDensity: views > 0 ? (a.likes + a.comments + a.shares) / views : 0,
      subscriberYield: views > 0 ? (a.subscribersGained / views) * 1000 : 0,
      retentionGrade: a.avgPercentViewed >= 70 ? 'A'
        : a.avgPercentViewed >= 50 ? 'B'
        : a.avgPercentViewed >= 30 ? 'C' : 'F',
      sufficientData: impressions >= 100,
    })
    return this._signals
  }

  // ─── toJSON ─────────────────────────────────────────────────────────────
  toJSON() {
    return {
      videoId: this.videoId,
      articleId: this.articleId,
      niche: this.niche,
      publishedAt: this.publishedAt,
      analytics: { ...this.analytics },
      signals: this.signals,
    }
  }

  // ─── fromYouTubeAnalytics ───────────────────────────────────────────────
  // Factory: build an observation from raw YouTube Analytics API response
  static fromYouTubeAnalytics({ videoId, articleId, niche, publishedAt, metrics }) {
    const analytics = {
      impressions: metrics?.impressions || 0,
      views: metrics?.views || 0,
      ctr: metrics?.ctr || null,
      avgViewDuration: metrics?.averageViewDuration || 0,
      avgPercentViewed: metrics?.averageViewPercentage || 0,
      watchTimeMinutes: (metrics?.watchTimeMinutes || metrics?.estimatedMinutesWatched) || 0,
      likes: metrics?.likes || 0,
      comments: metrics?.commentCount || 0,
      shares: metrics?.shares || 0,
      subscribersGained: metrics?.subscribersGained || 0,
    }
    return new PerformanceObservation({ videoId, articleId, niche, publishedAt, analytics })
  }
}
