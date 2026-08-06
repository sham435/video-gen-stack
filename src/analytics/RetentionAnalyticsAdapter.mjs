import { getAccessToken } from '../../apps/api/publishers/youtube.js'

// Retention Analytics Adapter — the external reality signal.
//
// Pulls actual viewer behavior from the YouTube Analytics API for published
// videos: average view percentage (completion proxy), average view duration,
// views, and the audience retention curve. All fetches are best-effort —
// missing credentials, unpublished videos, or API errors return null so the
// learner never crashes the pipeline.
const ANALYTICS = 'https://youtubeanalytics.googleapis.com/v2/reports'

export class RetentionAnalyticsAdapter {
  constructor(options = {}) {
    this.minViews = options.minViews || 10
    this.timeoutMs = options.timeoutMs || 15000
    this._token = null
  }

  async _accessToken() {
    if (!process.env.YOUTUBE_REFRESH_TOKEN) return null
    try {
      this._token = this._token || await getAccessToken()
      return this._token
    } catch {
      this._token = null
      return null
    }
  }

  _sinceDate(days) {
    const d = new Date(Date.now() - days * 86400000)
    return d.toISOString().slice(0, 10)
  }

  // Core metrics for one video: completion proxy + watch behavior.
  // averageViewPercentage = % of the video watched on average (completion).
  async fetchVideoStats(videoId, { sinceDays = 60 } = {}) {
    const token = await this._accessToken()
    if (!token) return null
    const url = `${ANALYTICS}?ids=channel%3D%3DMINE&startDate=${this._sinceDate(sinceDays)}&endDate=${this._sinceDate(0)}&metrics=averageViewDuration%2CaverageViewPercentage%2Cviews%2CestimatedMinutesWatched&filters=video%3D%3D${videoId}`
    try {
      const res = await fetch(url, {
        headers: { 'Authorization': `Bearer ${token}` },
        signal: AbortSignal.timeout(this.timeoutMs),
      })
      if (!res.ok) return null
      const data = await res.json()
      const row = data.rows?.[0]
      if (!row) return null
      return {
        videoId,
        views: row[2] || 0,
        avgViewDurationSec: Math.round((row[0] || 0) * 10) / 10,
        avgViewPercentage: Math.round((row[1] || 0) * 10) / 10,
        estimatedMinutesWatched: Math.round(row[3] || 0),
      }
    } catch {
      return null
    }
  }

  // Audience retention curve — view percentage by elapsed-time bucket.
  // Best-effort; returns [{ ratio, pct }] or null.
  async fetchRetentionCurve(videoId, { sinceDays = 60 } = {}) {
    const token = await this._accessToken()
    if (!token) return null
    const url = `${ANALYTICS}?ids=channel%3D%3DMINE&startDate=${this._sinceDate(sinceDays)}&endDate=${this._sinceDate(0)}&metrics=viewPercentage&dimensions=elapsedVideoTimeRatio&filters=video%3D%3D${videoId}`
    try {
      const res = await fetch(url, {
        headers: { 'Authorization': `Bearer ${token}` },
        signal: AbortSignal.timeout(this.timeoutMs),
      })
      if (!res.ok) return null
      const data = await res.json()
      if (!data.rows?.length) return null
      return data.rows
        .map(([ratio, pct]) => ({ ratio: Math.round(ratio * 1000) / 1000, pct: Math.round(pct * 10) / 10 }))
        .sort((a, b) => a.ratio - b.ratio)
    } catch {
      return null
    }
  }

  // Actual completion: the retention curve's end value beats the average for
  // short-form; prefer the curve when present, else averageViewPercentage.
  completionFrom(stats, curve) {
    if (curve?.length) {
      const end = curve[curve.length - 1]
      if (end && end.ratio >= 0.9) return end.pct
    }
    return stats?.avgViewPercentage ?? null
  }

  // Click-through rate — the packaging growth signal (shortsCtr on Shorts,
  // impressions-driven CTR on long-form). Best-effort; null when unavailable.
  async fetchCTR(videoId, { sinceDays = 60 } = {}) {
    const token = await this._accessToken()
    if (!token) return null
    const url = `${ANALYTICS}?ids=channel%3D%3DMINE&startDate=${this._sinceDate(sinceDays)}&endDate=${this._sinceDate(0)}&metrics=shortsCtr&filters=video%3D%3D${videoId}`
    try {
      const res = await fetch(url, {
        headers: { 'Authorization': `Bearer ${token}` },
        signal: AbortSignal.timeout(this.timeoutMs),
      })
      if (!res.ok) return null
      const data = await res.json()
      const ctr = data.rows?.[0]?.[0]
      return ctr == null ? null : Math.round(ctr * 100) / 100
    } catch {
      return null
    }
  }

  // Impressions + click-through from the Shorts impressions report.
  // Best-effort; null when unavailable.
  async fetchImpressions(videoId, { sinceDays = 60 } = {}) {
    const token = await this._accessToken()
    if (!token) return null
    const url = `${ANALYTICS}?ids=channel%3D%3DMINE&startDate=${this._sinceDate(sinceDays)}&endDate=${this._sinceDate(0)}&metrics=shortsImpressions%2CshortsCtr&filters=video%3D%3D${videoId}`
    try {
      const res = await fetch(url, {
        headers: { 'Authorization': `Bearer ${token}` },
        signal: AbortSignal.timeout(this.timeoutMs),
      })
      if (!res.ok) return null
      const data = await res.json()
      const row = data.rows?.[0]
      if (!row) return null
      return {
        impressions: Math.round(row[0] || 0),
        ctr: row[1] == null ? null : Math.round(row[1] * 100) / 100,
      }
    } catch {
      return null
    }
  }

  // Engagement counters — comments/likes/shares per video (YouTube Data API
  // statistics). The interaction quality signal behind EngagementScore.
  async fetchEngagement(videoId) {
    const token = await this._accessToken()
    if (!token) return null
    const url = `https://www.googleapis.com/youtube/v3/videos?part=statistics&id=${videoId}`
    try {
      const res = await fetch(url, {
        headers: { 'Authorization': `Bearer ${token}` },
        signal: AbortSignal.timeout(this.timeoutMs),
      })
      if (!res.ok) return null
      const item = (await res.json()).items?.[0]
      if (!item?.statistics) return null
      const st = item.statistics
      return {
        comments: Number(st.commentCount) || 0,
        likes: Number(st.likeCount) || 0,
        shares: Number(st.shareCount) || 0,
      }
    } catch {
      return null
    }
  }
}
