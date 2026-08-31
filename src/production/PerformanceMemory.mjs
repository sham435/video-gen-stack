// PerformanceMemory — persistence layer for production observations + learned patterns.
//
// This is the bridge between raw analytics and the RecommendationEngine.
// It stores PerformanceObservations and computes aggregate statistics
// per niche, per hook style, per thumbnail style.
//
// Architecture rule: Analytics → Observation → PerformanceMemory → Recommendation
//                     never: Analytics → Profile mutation (skipping memory)

import fs from 'node:fs'
import path from 'node:path'

const DEFAULT_DB_PATH = 'data/performance-memory.json'

export class PerformanceMemory {
  constructor(dbPath = DEFAULT_DB_PATH) {
    this.dbPath = dbPath
    this.data = this._load()
  }

  // ─── record ─────────────────────────────────────────────────────────────
  // Store a PerformanceObservation. Deduplicates by videoId.
  record(observation) {
    const key = observation.videoId || observation.articleId
    if (!key) return

    // Deduplicate: latest observation per video wins
    this.data.observations = this.data.observations.filter(o => o.videoId !== key)
    this.data.observations.push(observation.toJSON())

    // Trim to last 500 observations (rolling window)
    if (this.data.observations.length > 500) {
      this.data.observations = this.data.observations.slice(-500)
    }

    this._save()
  }

  // ─── nicheStats ─────────────────────────────────────────────────────────
  // Aggregate performance per niche. Returns { niche: { avgCtr, avgRetention, sampleCount, grade } }
  nicheStats() {
    const groups = {}
    for (const obs of this.data.observations) {
      const niche = obs.niche || 'GENERAL'
      if (!groups[niche]) groups[niche] = []
      groups[niche].push(obs.signals || {})
    }

    const stats = {}
    for (const [niche, signals] of Object.entries(groups)) {
      const ctrs = signals.filter(s => s.nicheCtr != null).map(s => s.nicheCtr)
      const retentions = signals.filter(s => s.hookRetention != null).map(s => s.hookRetention)
      const engagements = signals.map(s => s.engagementDensity || 0)

      stats[niche] = Object.freeze({
        avgCtr: ctrs.length ? ctrs.reduce((a, b) => a + b, 0) / ctrs.length : null,
        avgRetention: retentions.length ? retentions.reduce((a, b) => a + b, 0) / retentions.length : null,
        avgEngagement: engagements.length ? engagements.reduce((a, b) => a + b, 0) / engagements.length : 0,
        sampleCount: signals.length,
        sufficientData: signals.filter(s => s.sufficientData).length >= 3,
        grade: _computeGrade(signals),
      })
    }
    return stats
  }

  // ─── hookStats ──────────────────────────────────────────────────────────
  // Aggregate performance per hook style. Returns { hookStyle: { avgRetention, grade } }
  hookStats() {
    const groups = {}
    for (const obs of this.data.observations) {
      const hook = obs.hookStyle || 'breaking'
      if (!groups[hook]) groups[hook] = []
      groups[hook].push(obs.signals || {})
    }
    return _aggregateSignals(groups)
  }

  // ─── thumbnailStats ─────────────────────────────────────────────────────
  // Aggregate performance per thumbnail style. Returns { style: { avgCtr, grade } }
  thumbnailStats() {
    const groups = {}
    for (const obs of this.data.observations) {
      const style = obs.thumbnailStyle || 'breaking'
      if (!groups[style]) groups[style] = []
      groups[style].push(obs.signals || {})
    }
    return _aggregateSignals(groups)
  }

  // ─── recent ─────────────────────────────────────────────────────────────
  // Last N observations, newest first.
  recent(n = 10) {
    return this.data.observations.slice(-n).reverse()
  }

  // ─── byNiche ────────────────────────────────────────────────────────────
  // All observations for a specific niche.
  byNiche(niche) {
    return this.data.observations.filter(o => o.niche === niche)
  }

  // ─── summary ────────────────────────────────────────────────────────────
  summary() {
    const obs = this.data.observations
    const niches = [...new Set(obs.map(o => o.niche))]
    return {
      totalObservations: obs.length,
      niches,
      oldest: obs[0]?.publishedAt || null,
      newest: obs[obs.length - 1]?.publishedAt || null,
    }
  }

  // ══════════════════════════════════════════════════════════════════════════
  // LEARN query surface — structured, time-windowed "what worked?" lookups.
  //
  // Backs questions like:
  //   • "What worked for Samsung AI videos in the last 30 days?"
  //   • "Which hook styles performed best for tech videos in Q3?"
  //
  // Every method below is deterministic and fully offline — it aggregates the
  // per-video PerformanceObservation records already stored by record(). No
  // live analytics calls. This is the query half of the LEARN increment.
  // ══════════════════════════════════════════════════════════════════════════

  // Resolve a stored observation into a comparable metric value (0..1 or raw
  // count). Unknown metrics return null and are skipped by aggregations.
  _metricValue(obs, metric) {
    const s = obs.signals || {}
    const a = obs.analytics || {}
    switch (metric) {
      case 'ctr': case 'nicheCtr': return s.nicheCtr ?? null
      case 'hookRetention': case 'completion': return s.hookRetention ?? null
      case 'thumbnailCtr': return s.thumbnailCtr ?? null
      case 'engagement': case 'engagementDensity': return s.engagementDensity ?? null
      case 'subscriberYield': return s.subscriberYield ?? null
      case 'views': return a.views ?? 0
      case 'watchTime': return a.watchTimeMinutes ?? 0
      default: return null
    }
  }

  // The matrix of dimensions we can slice on. Each maps to a stored field.
  _dimensionValue(obs, dimension) {
    switch (dimension) {
      case 'niche': return obs.niche || 'GENERAL'
      case 'hookStyle': return obs.hookStyle || 'unknown'
      case 'thumbnailStyle': return obs.thumbnailStyle || 'unknown'
      case 'musicTrack': return obs.musicTrack || 'unknown'
      default: return obs.niche || 'GENERAL'
    }
  }

  /**
   * Filter stored observations by a structured predicate: niche(s), hook /
   * thumbnail styles, a publishedAt window, and min data-quality thresholds.
   * Returns the matching observations sorted newest-first.
   *
   * @param {object} f
   *   { niche?, niches?:string[], hookStyle?, hookStyles?:string[],
   *     thumbnailStyle?, thumbnailStyles?:string[],
   *     from? (ISO|epoch ms), to?, sinceDays?, minImpressions?, minViews? }
   */
  query(f = {}) {
    const from = f.from != null
      ? (f.sinceDays != null ? Date.now() : new Date(f.from).getTime())
      : (f.sinceDays != null ? Date.now() - f.sinceDays * this._dayMs() : null)
    const to = f.to != null ? new Date(f.to).getTime() : null
    const niches = new Set((f.niches || (f.niche ? [f.niche] : [])))
    const hooks = new Set((f.hookStyles || (f.hookStyle ? [f.hookStyle] : [])))
    const thumbs = new Set((f.thumbnailStyles || (f.thumbnailStyle ? [f.thumbnailStyle] : [])))

    const out = []
    for (const obs of this.data.observations) {
      const at = new Date(obs.publishedAt || 0).getTime()
      if (from != null && at < from) continue
      if (to != null && at > to) continue
      if (niches.size && !niches.has(obs.niche)) continue
      if (hooks.size && !hooks.has(obs.hookStyle)) continue
      if (thumbs.size && !thumbs.has(obs.thumbnailStyle)) continue
      const a = obs.analytics || {}
      if (f.minImpressions != null && (a.impressions || 0) < f.minImpressions) continue
      if (f.minViews != null && (a.views || 0) < f.minViews) continue
      out.push(obs)
    }
    return out.sort((a, b) => new Date(b.publishedAt || 0) - new Date(a.publishedAt || 0))
  }

  // Lucid sugar: everything published within the last `days` days.
  since(days, f = {}) {
    return this.query({ ...f, sinceDays: days })
  }

  // Lucid sugar: everything published between two ISO date strings.
  interval(from, to, f = {}) {
    return this.query({ ...f, from, to })
  }

  /**
   * Core "what worked?" primitive. Aggregates observations matching
   * { sinceDays / niche / hook / thumbnail } by a dimension (niche, hookStyle,
   * thumbnailStyle, musicTrack), ranking each group by an average metric.
   *
   * @returns [{ dimension, value, avg (metric), sampleCount, grade, sufficient }]
   *   sorted best-first by avg metric.
   */
  windowPerformance({
    sinceDays = 30, niche, hookStyles, thumbnailStyles,
    dimension = 'niche', metric = 'hookRetention',
    minSamples = 3, minImpressions, minViews,
  } = {}) {
    const rows = this.query({
      sinceDays, niche,
      hookStyles, thumbnailStyles,
      minImpressions, minViews,
    })
    const groups = new Map()
    for (const obs of rows) {
      const value = this._dimensionValue(obs, dimension)
      const m = this._metricValue(obs, metric)
      if (m == null) continue
      if (!groups.has(value)) groups.set(value, [])
      groups.get(value).push({ obs, m })
    }
    const result = []
    for (const [value, list] of groups) {
      const s = list.map(x => x.m)
      const avg = s.reduce((a, b) => a + b, 0) / s.length
      result.push({
        dimension,
        value,
        avg: Number(avg.toFixed(4)),
        sampleCount: list.length,
        grade: _computeGrade(list.map(x => ({ hookRetention: x.m }))),
        sufficient: list.length >= minSamples,
      })
    }
    return result
      .filter(r => r.sufficient)
      .sort((a, b) => b.avg - a.avg)
  }

  /**
   * Highest-level LEARN answer: returns the single best-performing dimension
   * value plus the ranked leaderboard, or null when no sufficient data.
   *
   * @returns { leaderboard, best } — best is the top entry or null.
   */
  whatWorked({ sinceDays = 30, niche, hookStyles, thumbnailStyles, dimension = 'niche', metric = 'hookRetention', minSamples = 3 } = {}) {
    const leaderboard = this.windowPerformance({ sinceDays, niche, hookStyles, thumbnailStyles, dimension, metric, minSamples })
    return { leaderboard, best: leaderboard[0] || null }
  }

  /**
   * Time-series breakdown of one dimension value across buckets. Useful for
   * "how has hook style X trended over the last 90 days?"
   *
   * @param {object} o
   *   { dimension?, dimensionValue?, sinceDays?, granularity?: 'day'|'week'|'month',
   *     metric? }
   * @returns [{ bucket, count, avg }]
   */
  trend({
    dimension = 'hookStyle', dimensionValue, sinceDays = 90,
    granularity = 'week', metric = 'hookRetention',
  } = {}) {
    const rows = this.query({ sinceDays })
    const buckets = new Map()
    for (const obs of rows) {
      const value = this._dimensionValue(obs, dimension)
      if (dimensionValue != null && value !== dimensionValue) continue
      const m = this._metricValue(obs, metric)
      if (m == null) continue
      const bucket = this._bucketLabel(new Date(obs.publishedAt || 0), granularity)
      if (!buckets.has(bucket)) buckets.set(bucket, [])
      buckets.get(bucket).push(m)
    }
    return [...buckets.entries()]
      .map(([bucket, list]) => ({
        bucket,
        count: list.length,
        avg: Number((list.reduce((a, b) => a + b, 0) / list.length).toFixed(4)),
      }))
      .sort((a, b) => a.bucket.localeCompare(b.bucket))
  }

  _bucketLabel(d, granularity) {
    if (granularity === 'day') return d.toISOString().slice(0, 10)
    if (granularity === 'month') return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`
    // default week: ISO year-week (Monday start).
    const date = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()))
    const day = date.getUTCDay() === 0 ? 7 : date.getUTCDay()
    date.setUTCDate(date.getUTCDate() + 4 - day) // ISO Thursday
    const year = date.getUTCFullYear()
    const firstThu = new Date(Date.UTC(year, 0, 4))
    const firstMon = new Date(firstThu.getTime() - ((firstThu.getUTCDay() === 0 ? 7 : firstThu.getUTCDay()) - 1) * 86400000)
    const week = Math.floor((date - firstMon) / (7 * 86400000)) + 1
    return `${year}-W${String(week).padStart(2, '0')}`
  }

  _dayMs() { return 86400000 }

  // ─── persistence ────────────────────────────────────────────────────────
  _load() {
    try {
      return JSON.parse(fs.readFileSync(this.dbPath, 'utf-8'))
    } catch {
      return { observations: [], learned: {} }
    }
  }

  _save() {
    try {
      fs.mkdirSync(path.dirname(this.dbPath), { recursive: true })
      fs.writeFileSync(this.dbPath, JSON.stringify(this.data, null, 2))
    } catch { /* non-fatal */ }
  }

  // ─── close ──────────────────────────────────────────────────────────────
  close() { this._save() }
}

// ─── helpers ──────────────────────────────────────────────────────────────────

function _computeGrade(signals) {
  const retentions = signals.filter(s => s.hookRetention != null).map(s => s.hookRetention)
  if (!retentions.length) return 'N/A'
  const avg = retentions.reduce((a, b) => a + b, 0) / retentions.length
  return avg >= 0.7 ? 'A' : avg >= 0.5 ? 'B' : avg >= 0.3 ? 'C' : 'F'
}

function _aggregateSignals(groups) {
  const result = {}
  for (const [key, signals] of Object.entries(groups)) {
    const ctrs = signals.filter(s => s.nicheCtr != null).map(s => s.nicheCtr)
    const retentions = signals.filter(s => s.hookRetention != null).map(s => s.hookRetention)
    result[key] = Object.freeze({
      avgCtr: ctrs.length ? ctrs.reduce((a, b) => a + b, 0) / ctrs.length : null,
      avgRetention: retentions.length ? retentions.reduce((a, b) => a + b, 0) / retentions.length : null,
      sampleCount: signals.length,
      grade: _computeGrade(signals),
    })
  }
  return result
}
