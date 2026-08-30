/**
 * YouTubeQuotaAuditor — calculates actual YouTube API quota consumption
 * by tracing the real code path in the production pipeline.
 *
 * Based on composer.mjs → publishVideo() → youtube.js:
 *   1. videos.insert:    1600 units (video upload)
 *   2. thumbnails.set:     50 units (thumbnail upload)
 *   3. comments.insert:     1 unit  (pinned comment — if available)
 *   4. Total:            ~1651 units per video
 *
 * YouTube default quota: 10,000 units/day (may be higher with quota increase).
 *
 * This auditor uses the ACTUAL budget from ProviderBudgets.mjs, not
 * a generic assumption.
 */

import { getBudget } from '../governor/ProviderBudgets.mjs'

// YouTube Data API v3 quota unit costs (official documentation)
const QUOTA_COSTS = {
  'videos.insert': 1600,
  'thumbnails.set': 50,
  'thumbnails.get': 1,
  'comments.insert': 1,
  'comments.list': 1,
  'videos.list': 1,
  'channels.list': 1,
}

export class YouTubeQuotaAuditor {
  constructor(opts = {}) {
    this.budget = getBudget('youtube')
    this.defaultQuotaUnits = opts.quotaUnits || 10000
    this.videosPerDay = opts.videosPerDay || null // null = read from budget
  }

  /**
   * Audit YouTube quota consumption per video.
   * @returns {object} Quota audit with per-video cost and capacity
   */
  audit() {
    const budget = this.budget || { daily: 6, monthly: 100, cooldownMs: 30000 }

    // Per-video quota cost (from actual code path)
    const quotaPerVideo = this._calculateQuotaPerVideo()

    // Daily quota units (env override or default)
    const dailyQuotaUnits = this._getDailyQuotaUnits()

    // Theoretical capacity from quota units
    const theoreticalMaxFromUnits = Math.floor(dailyQuotaUnits / quotaPerVideo.total)

    // Budget-limited capacity (hard limit from ProviderBudgets)
    const budgetLimit = budget.daily

    // Effective capacity = min(quota units, budget limit)
    const effectiveCapacity = Math.min(theoreticalMaxFromUnits, budgetLimit)

    // Safe capacity with headroom (10% margin for retries/failures)
    const safeCapacity = Math.floor(effectiveCapacity * 0.9)

    // Required quota for 48/day
    const requiredQuotaFor48 = quotaPerVideo.total * 48

    return {
      quotaPerVideo,
      configuredDailyQuota: dailyQuotaUnits,
      budgetDailyLimit: budgetLimit,
      budgetMonthlyLimit: budget.monthly,
      theoreticalCapacity: theoreticalMaxFromUnits,
      budgetLimitedCapacity: budgetLimit,
      effectiveCapacity,
      safeCapacity,
      requiredQuotaFor48,
      gapTo48: Math.max(0, 48 - safeCapacity),
      quotaIncreaseNeeded: safeCapacity < 48,
      recommendations: this._buildRecommendations(safeCapacity, effectiveCapacity, budgetLimit),
      _classification: 'computed',
      _source: 'code-trace',
      _timestamp: new Date().toISOString(),
    }
  }

  _calculateQuotaPerVideo() {
    // Actual code path from composer.mjs:
    // 1. publishVideo() → videos.insert (1600 units)
    // 2. publishVideo() → thumbnails.set (50 units, if thumbnail provided)
    // 3. postComment() → comments.insert (1 unit, if comment posted)

    const operations = {
      videosInsert: { cost: QUOTA_COSTS['videos.insert'], required: true, description: 'Upload video' },
      thumbnailsSet: { cost: QUOTA_COSTS['thumbnails.set'], required: true, description: 'Set video thumbnail' },
      commentsInsert: { cost: QUOTA_COSTS['comments.insert'], required: false, description: 'Post pinned comment' },
    }

    const total = operations.videosInsert.cost + operations.thumbnailsSet.cost + operations.commentsInsert.cost

    return {
      operations,
      total,
      breakdown: `videos.insert(${operations.videosInsert.cost}) + thumbnails.set(${operations.thumbnailsSet.cost}) + comments.insert(${operations.commentsInsert.cost})`,
    }
  }

  _getDailyQuotaUnits() {
    if (process.env.YOUTUBE_DAILY_QUOTA) {
      const envQuota = parseInt(process.env.YOUTUBE_DAILY_QUOTA, 10)
      if (!isNaN(envQuota) && envQuota > 0) return envQuota
    }
    return this.defaultQuotaUnits
  }

  _buildRecommendations(safeCapacity, effectiveCapacity, budgetLimit) {
    const recs = []

    if (safeCapacity < 48) {
      recs.push(`Current safe capacity: ${safeCapacity}/day — below 48/day target`)
      recs.push(`To reach 48/day, need YouTube quota increase to ≥${48 * 1651} units/day`)

      if (budgetLimit < 48) {
        recs.push(`Budget limit is ${budgetLimit}/day — also needs increase via YOUTUBE_DAILY_BUDGET env`)
      }

      recs.push('Options:')
      recs.push('  1. Request YouTube API quota increase from Google Cloud Console')
      recs.push('  2. Use multiple YouTube channels (multi-channel publishing)')
      recs.push('  3. Accept current capacity and reduce target')
    } else {
      recs.push(`YouTube capacity ${safeCapacity}/day meets 48/day target`)
    }

    return recs
  }
}
