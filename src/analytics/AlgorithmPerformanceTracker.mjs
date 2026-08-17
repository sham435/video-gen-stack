// AlgorithmPerformanceTracker — M7: track which of the 48 algorithms
// gets the best retention/views per category. On cold start every algo
// gets seed=0.5 confidence. Once real YouTube analytics flow in, the
// tracker ranks algos by weighted retention and can bias generation.

import fs from 'node:fs'
import path from 'node:path'

const DATA_DIR = path.join(process.cwd(), 'data')
const TRACKER_FILE = path.join(DATA_DIR, 'algo-performance.json')

export class AlgorithmPerformanceTracker {
  constructor() {
    this.data = this._load()
  }

  _load() {
    try {
      return JSON.parse(fs.readFileSync(TRACKER_FILE, 'utf8'))
    } catch {
      return this._seed()
    }
  }

  _seed() {
    const data = { videos: [], byAlgo: {}, byCategory: {} }
    fs.mkdirSync(DATA_DIR, { recursive: true })
    this._save(data)
    return data
  }

  _save(data) {
    try {
      fs.mkdirSync(DATA_DIR, { recursive: true })
      fs.writeFileSync(TRACKER_FILE, JSON.stringify(data, null, 2))
    } catch {}
  }

  // Record a video upload with its algo and optional metrics.
  record({ algoNumber, algoId, category, videoId, views = 0, retention = 0, completionRate = 0 }) {
    const entry = {
      at: Date.now(),
      algoNumber,
      algoId,
      category: category || 'unknown',
      videoId: videoId || `vid_${Date.now().toString(36)}`,
      views,
      retention,
      completionRate,
    }
    this.data.videos.push(entry)

    // Per-algo aggregation
    const ak = String(algoNumber)
    if (!this.data.byAlgo[ak]) this.data.byAlgo[ak] = { count: 0, views: 0, retentionSum: 0, completionSum: 0 }
    this.data.byAlgo[ak].count++
    this.data.byAlgo[ak].views += views
    this.data.byAlgo[ak].retentionSum += retention
    this.data.byAlgo[ak].completionSum += completionRate

    // Per-category aggregation
    const ck = entry.category
    if (!this.data.byCategory[ck]) this.data.byCategory[ck] = {}
    if (!this.data.byCategory[ck][ak]) this.data.byCategory[ck][ak] = 0
    this.data.byCategory[ck][ak]++

    this._save(this.data)
    return entry
  }

  // Rank algorithms by retention (or views when retention data is sparse).
  // Returns [{algoNumber, avgRetention, avgCompletion, videos, views}].
  topAlgorithms({ limit = 10, category = null } = {}) {
    let source = this.data.byAlgo
    if (category && this.data.byCategory[category]) {
      source = {}
      for (const [ak, count] of Object.entries(this.data.byCategory[category])) {
        source[ak] = this.data.byAlgo[ak] || { count: 0, views: 0, retentionSum: 0, completionSum: 0 }
        source[ak] = { ...source[ak], count }
      }
    }
    return Object.entries(source)
      .map(([ak, d]) => ({
        algoNumber: Number(ak),
        avgRetention: d.count ? d.retentionSum / d.count : 0,
        avgCompletion: d.count ? d.completionSum / d.count : 0,
        videos: d.count,
        views: d.views,
      }))
      .sort((a, b) => b.avgRetention - a.avgRetention || b.views - a.views)
      .slice(0, limit)
  }

  // Which categories perform best for a given algo?
  topCategories({ limit = 5 } = {}) {
    const out = []
    for (const [cat, algos] of Object.entries(this.data.byCategory)) {
      const total = Object.values(algos).reduce((s, n) => s + n, 0)
      const bestAlgo = Object.entries(algos).sort((a, b) => b[1] - a[1])[0]
      out.push({ category: cat, totalVideos: total, bestAlgo: bestAlgo ? Number(bestAlgo[0]) : null, bestCount: bestAlgo?.[1] || 0 })
    }
    return out.sort((a, b) => b.totalVideos - a.totalVideos).slice(0, limit)
  }

  // Full summary for the dashboard.
  summary() {
    const total = this.data.videos.length
    const totalViews = this.data.videos.reduce((s, v) => s + v.views, 0)
    const avgRetention = total ? this.data.videos.reduce((s, v) => s + v.retention, 0) / total : 0
    return {
      totalVideos: total,
      totalViews,
      avgRetention: avgRetention.toFixed(3),
      top5: this.topAlgorithms({ limit: 5 }),
      categoryBreakdown: this.topCategories({ limit: 10 }),
    }
  }
}
