import fs from 'fs'
import path from 'path'
import { RetentionAnalyticsAdapter } from './RetentionAnalyticsAdapter.mjs'
import { ProductionMemory } from '../pipeline/ProductionMemory.mjs'
import { BrandPerformanceMemory } from '../pipeline/BrandPerformanceMemory.mjs'
import { patternKey } from '../ai/thumbnail/ThumbnailBrandOptimizer.mjs'

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
    this.brandMemory = options.brandMemory || new BrandPerformanceMemory()
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
    const brandRecords = [] // title pattern → measured CTR
    let analyzed = 0
    let skipped = 0

    for (const snap of snapshots) {
      if (!snap.videoId || !snap.retention) { skipped++; continue }
      const stats = await this.adapter.fetchVideoStats(snap.videoId, { sinceDays })
      if (!stats || stats.views < this.minViews) { skipped++; continue }

      // Channel growth signal — measured CTR per title pattern. This is what
      // makes packaging optimization automatic: once a pattern proves weak
      // (CTR < 4.0%) the ThumbnailBrandOptimizer avoids it in every title.
      // The full signal set (retention3s, completion, engagement counters)
      // also feeds the editorial decision so the newsroom can boost or avoid
      // topics autonomously.
      const curve = await this.adapter.fetchRetentionCurve(snap.videoId, { sinceDays })
      const actual = this.adapter.completionFrom(stats, curve)
      if (snap.title) {
        const ctr = await this.adapter.fetchCTR(snap.videoId, { sinceDays })
        if (ctr != null) {
          const pattern = patternKey(snap.title)
          const engagement = await this.adapter.fetchEngagement(snap.videoId)
          const retention3s = curve?.[0]?.pct ?? null
          this.brandMemory.recordPattern(pattern, {
            videos: 1,
            avgCTR: ctr,
            impact: Math.round((ctr - 4.5) * 10), // 4.5% baseline → positive/negative
            source: 'analytics',
            category: snap.category || 'technology',
            signals: {
              ctr,
              retention3s,
              completion: actual,
              comments: engagement?.comments ?? null,
              likes: engagement?.likes ?? null,
              shares: engagement?.shares ?? null,
              views: stats.views,
            },
          })
          const decision = this.brandMemory.decisionFor(pattern)
          brandRecords.push({
            pattern, ctr, title: snap.title.slice(0, 60),
            completion: actual, retention3s,
            decision, recommendation: this.brandMemory.patterns().find(p => p.pattern === pattern)?.recommendation,
          })
          if (verbose) console.log(`Brand: ${pattern} → CTR ${ctr}% · completion ${actual ?? 'n/a'}% · retention3s ${retention3s ?? 'n/a'}% · boostTopic=${decision.boostTopic} (${snap.title.slice(0, 50)})`)
        }
      }
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
      const confidence = Math.min(0.97, Math.round((0.5 + (0.47 * n / (n + 25))) * 100) / 100)
      this.memory.calibrate(risk, { retentionImpact: mean, frequency: n, confidence })
      learned.push({ rule: risk, frequency: n, retentionImpact: mean, confidence })
      if (verbose) console.log(`Calibrated: ${risk} → impact ${mean > 0 ? '+' : ''}${mean}% over ${n} videos (conf ${confidence})`)
    }

    return { learned, analyzed, skipped, brandLearned: brandRecords }
  }
}

export { SNAPSHOTS_FILE }
