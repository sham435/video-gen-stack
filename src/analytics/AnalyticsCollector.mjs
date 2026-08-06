// AnalyticsCollector — per-video YouTube performance snapshot.
//
// Wraps RetentionAnalyticsAdapter into one canonical metrics object that the
// learning layer consumes:
//
//   { videoId, publishedAt, impressions, ctr, avgViewDurationSec,
//     retention, watchTimeSec, views, likes, comments, shares }
//
// All fetches are best-effort (missing credentials / unpublished video →
// null fields). `collect()` never throws.

import { RetentionAnalyticsAdapter } from './RetentionAnalyticsAdapter.mjs'

export class AnalyticsCollector {
  constructor({ adapter = new RetentionAnalyticsAdapter(), minViews = 10 } = {}) {
    this.adapter = adapter
    this.minViews = minViews
  }

  /**
   * @param {string} videoId
   * @returns {Promise<object|null>} metrics or null when nothing is available
   */
  async collect(videoId) {
    const [stats, curve, ctr, engagement] = await Promise.all([
      this.adapter.fetchVideoStats(videoId),
      this.adapter.fetchRetentionCurve(videoId),
      this.adapter.fetchCTR(videoId),
      this.adapter.fetchEngagement(videoId),
    ])

    // No data at all (unpublished / no access) → null so callers can skip.
    if (!stats && ctr == null && !engagement) return null

    const retention = this.adapter.completionFrom(stats, curve)
    const views = stats?.views ?? 0
    // Ignore sub-signal videos (0-2 views) — noisy performance data
    if (views < this.minViews && ctr == null) return null

    return {
      videoId,
      publishedAt: new Date().toISOString(),
      impressions: null, // populated via fetchImpressions below when possible
      ctr: ctr ?? null,
      avgViewDurationSec: stats?.avgViewDurationSec ?? null,
      retention: retention ?? null,
      watchTimeSec: stats?.estimatedMinutesWatched ? stats.estimatedMinutesWatched * 60 : null,
      views,
      likes: engagement?.likes ?? 0,
      comments: engagement?.comments ?? 0,
      shares: engagement?.shares ?? 0,
    }
  }

  /** Impressions + CTR come from the shortsImpressions report when available. */
  fetchImpressions(videoId) {
    return this.adapter.fetchImpressions(videoId)
  }

  /** Full collect including impressions (best-effort). */
  async collectFull(videoId) {
    const base = await this.collect(videoId)
    if (!base) return null
    const imp = await this.fetchImpressions(videoId)
    if (imp) {
      base.impressions = imp.impressions
      if (imp.ctr != null) base.ctr = imp.ctr
    }
    return base
  }
}
