import fs from 'fs'
import path from 'path'

const METRICS_FILE = path.resolve(process.cwd(), 'data', 'analytics-metrics.json')

const INSIGHTS = {
  'gaming': { hook: 'shock opening performs best', cover: 'neon vibrant covers needed' },
  'ai': { hook: 'mystery hooks retain best', cover: 'cinematic futuristic covers' },
  'science': { hook: 'question hooks work', cover: 'cinematic discovery covers' },
  'sports': { hook: 'energetic opening', cover: 'high-energy covers' },
  'default': { hook: 'shock/mystery hybrid', cover: 'high-contrast covers' },
}

export class AnalyticsFeedback {
  constructor() {
    this.metrics = this._load()
  }

  _load() {
    try {
      if (fs.existsSync(METRICS_FILE)) return JSON.parse(fs.readFileSync(METRICS_FILE, 'utf-8'))
    } catch { /* ignore */ }
    return { videos: [], insights: {}, totals: {} }
  }

  _persist() {
    try {
      fs.mkdirSync(path.dirname(METRICS_FILE), { recursive: true })
      fs.writeFileSync(METRICS_FILE, JSON.stringify(this.metrics, null, 2))
    } catch { /* ignore */ }
  }

  record(article, metrics) {
    const entry = {
      id: `vid_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      title: article.title || 'Untitled',
      category: article.category || 'default',
      publishedAt: new Date().toISOString(),
      metrics: {
        ctr: metrics.ctr ?? null,
        watchTime: metrics.watchTime ?? null,
        retention3s: metrics.retention3s ?? null,
        retention30s: metrics.retention30s ?? null,
        likes: metrics.likes ?? 0,
        comments: metrics.comments ?? 0,
        shares: metrics.shares ?? 0,
      },
    }
    this.metrics.videos.unshift(entry)
    this.metrics.videos = this.metrics.videos.slice(0, 100)
    this._persist()
    return entry
  }

  getInsights(category) {
    const cat = category || 'default'
    const catVideos = this.metrics.videos.filter(v => v.category === cat)
    const avgRetention = catVideos.length
      ? catVideos.reduce((s, v) => s + (v.metrics.retention30s ?? 0), 0) / catVideos.length
      : null
    return {
      category: cat,
      videos: catVideos.length,
      avgRetention,
      insight: INSIGHTS[cat] || INSIGHTS.default,
      recommendation: avgRetention !== null && avgRetention > 60
        ? 'Current hooks performing well — keep this format'
        : 'Retention below target — shift to shock/mystery hooks',
    }
  }

  getTotals() {
    const vids = this.metrics.videos
    return {
      videos: vids.length,
      avgCtr: vids.length ? Math.round(vids.reduce((s, v) => s + (v.metrics.ctr ?? 0), 0) / vids.length) : null,
      avgRetention30s: vids.length ? Math.round(vids.reduce((s, v) => s + (v.metrics.retention30s ?? 0), 0) / vids.length) : null,
      totalLikes: vids.reduce((s, v) => s + v.metrics.likes, 0),
      totalComments: vids.reduce((s, v) => s + v.metrics.comments, 0),
      totalShares: vids.reduce((s, v) => s + v.metrics.shares, 0),
    }
  }
}
