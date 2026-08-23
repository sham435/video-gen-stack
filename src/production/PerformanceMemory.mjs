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
