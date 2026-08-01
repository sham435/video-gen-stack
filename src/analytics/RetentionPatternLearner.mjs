import fs from 'fs'
import path from 'path'
import { RetentionAnalyticsAdapter } from './RetentionAnalyticsAdapter.mjs'
import { ProductionMemory } from '../pipeline/ProductionMemory.mjs'

const SNAPSHOTS_FILE = path.resolve(process.cwd(), 'data', 'retention-analytics.json')

// Retention Pattern Learner — turns real viewer behavior into calibrated
// production rules.
//
// For every published video we hold a snapshot: the pipeline's predicted
// completion plus the drop risks present at publish time. The learner pulls
// actual analytics, computes delta = actual completion − predicted, then
// aggregates per risk pattern. After enough observations a pattern becomes
// data-backed in ProductionMemory:
//
//   { rule: 'slow_information_delivery', frequency: 37,
//     retentionImpact: -14.6, confidence: 0.91 }
//
// …which shifts the ViewerBehaviorModel's hazard for the next story.
export class RetentionPatternLearner {
  constructor(options = {}) {
    this.adapter = options.adapter || new RetentionAnalyticsAdapter(options)
    this.memory = options.memory || new ProductionMemory()
    this.minViews = options.minViews || 10
    this.minObservations = options.minObservations || 3
  }

  _loadSnapshots() {
    try {
      if (fs.existsSync(SNAPSHOTS_FILE)) return JSON.parse(fs.readFileSync(SNAPSHOTS_FILE, 'utf-8'))
    } catch { /* ignore */ }
    return []
  }

  appendSnapshot(snapshot) {
    const list = this._loadSnapshots()
    list.push({ ...snapshot, recordedAt: new Date().toISOString() })
    try {
      fs.mkdirSync(path.dirname(SNAPSHOTS_FILE), { recursive: true })
      fs.writeFileSync(SNAPSHOTS_FILE, JSON.stringify(list, null, 2))
    } catch { /* ignore */ }
  }

  // Pull real analytics for all snapshots, correlate with predictions, and
  // calibrate ProductionMemory. Returns a summary of what was learned.
  async learn({ sinceDays = 60, verbose = true } = {}) {
    const snapshots = this._loadSnapshots()
    if (!snapshots.length) return { learned: [], analyzed: 0, skipped: 0, message: 'no snapshots recorded yet' }

    const deltas = new Map() // risk → [deltas]
    const completions = new Map() // risk → [actualCompletion]
    let analyzed = 0
    let skipped = 0

    for (const snap of snapshots) {
      if (!snap.videoId || !snap.retention) { skipped++; continue }
      const stats = await this.adapter.fetchVideoStats(snap.videoId, { sinceDays })
      if (!stats || stats.views < this.minViews) { skipped++; continue }

      const curve = await this.adapter.fetchRetentionCurve(snap.videoId, { sinceDays })
      const actual = this.adapter.completionFrom(stats, curve)
      const predicted = snap.retention.completionRate
      if (actual == null || predicted == null) { skipped++; continue }

      const delta = Math.round((actual - predicted) * 10) / 10
      const risks = (snap.retention.dropRisks || []).map(r => r.risk)
      risks.push(...(snap.retention.appliedFixes || []))
      analyzed++

      for (const risk of risks) {
        if (!deltas.has(risk)) deltas.set(risk, [])
        deltas.get(risk).push(delta)
        if (!completions.has(risk)) completions.set(risk, [])
        completions.get(risk).push(actual)
      }
      if (verbose) console.log(`Analytics: ${snap.title?.slice(0, 40) || snap.videoId} — actual ${actual}% vs predicted ${predicted}% (delta ${delta > 0 ? '+' : ''}${delta})`)
    }

    // Aggregate per-risk patterns into data-backed memory rules
    const learned = []
    for (const [risk, deltasList] of deltas) {
      if (deltasList.length < this.minObservations) continue
      const n = deltasList.length
      const mean = Math.round((deltasList.reduce((s, d) => s + d, 0) / n) * 10) / 10
      const confidence = Math.min(0.97, Math.round((0.5 + n * 0.01) * 100) / 100)
      this.memory.calibrate(risk, { retentionImpact: mean, frequency: n, confidence })
      learned.push({ rule: risk, frequency: n, retentionImpact: mean, confidence })
      if (verbose) console.log(`Calibrated: ${risk} → impact ${mean > 0 ? '+' : ''}${mean}% over ${n} videos (conf ${confidence})`)
    }

    return { learned, analyzed, skipped }
  }
}

export { SNAPSHOTS_FILE }
