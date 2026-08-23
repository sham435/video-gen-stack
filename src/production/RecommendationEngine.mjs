// RecommendationEngine — analytics → observations → recommendations.
//
// Consumes PerformanceMemory stats. Produces typed Recommendations:
//   { type, niche, field, currentValue, suggestedValue, confidence, reason }
//
// NEVER mutates profiles directly. Outputs recommendations that the
// ProfileOptimizer validates before applying.
//
// Three recommendation axes:
//   1. NicheProfile — adjust accent/tone/hookStyle based on CTR
//   2. HookStyle    — adjust hookStyle based on retention
//   3. ThumbnailStyle — adjust thumbnail approach based on CTR

const MIN_SAMPLES = 5
const CTR_IMPROVEMENT_THRESHOLD = 0.002   // 0.2pp CTR gain required
const RETENTION_IMPROVEMENT_THRESHOLD = 5 // 5% retention gain required

export class RecommendationEngine {
  constructor(performanceMemory) {
    this.memory = performanceMemory
  }

  // ─── recommend ──────────────────────────────────────────────────────────
  // Generate all recommendations from current performance data.
  // Returns Recommendation[] — may be empty if insufficient data.
  recommend() {
    const nicheStats = this.memory.nicheStats()
    const hookStats = this.memory.hookStats()
    const recommendations = []

    // Axis 1: Niche CTR → accent/tone adjustments
    recommendations.push(...this._nicheCtrRecommendations(nicheStats))

    // Axis 2: Hook retention → hookStyle adjustments
    recommendations.push(...this._hookRetentionRecommendations(hookStats))

    // Axis 3: Thumbnail CTR → style adjustments
    recommendations.push(...this._thumbnailCtrRecommendations(nicheStats))

    return recommendations.filter(Boolean)
  }

  // ─── niche CTR recommendations ──────────────────────────────────────────
  _nicheCtrRecommendations(nicheStats) {
    const recs = []
    const overallAvg = this._overallAvg(nicheStats, 'avgCtr')

    for (const [niche, stats] of Object.entries(nicheStats)) {
      if (!stats.sufficientData || stats.sampleCount < MIN_SAMPLES) continue
      if (stats.avgCtr == null || overallAvg == null) continue

      const gap = stats.avgCtr - overallAvg
      if (Math.abs(gap) < CTR_IMPROVEMENT_THRESHOLD) continue

      if (gap > 0) {
        // Niche is outperforming — reinforce its current tone
        recs.push({
          type: 'niche_profile',
          niche,
          field: 'tone',
          currentValue: null, // determined by ProfileOptimizer
          suggestedValue: null, // reinforce
          confidence: Math.min(0.9, 0.5 + stats.sampleCount * 0.05),
          reason: `CTR ${(stats.avgCtr * 100).toFixed(2)}% is ${(gap * 100).toFixed(2)}pp above average (${stats.sampleCount} videos)`,
          action: 'reinforce',
        })
      } else {
        // Niche is underperforming — suggest tone pivot
        recs.push({
          type: 'niche_profile',
          niche,
          field: 'tone',
          currentValue: null,
          suggestedValue: null,
          confidence: Math.min(0.85, 0.4 + stats.sampleCount * 0.05),
          reason: `CTR ${(stats.avgCtr * 100).toFixed(2)}% is ${(Math.abs(gap) * 100).toFixed(2)}pp below average (${stats.sampleCount} videos)`,
          action: 'pivot',
        })
      }
    }
    return recs
  }

  // ─── hook retention recommendations ─────────────────────────────────────
  _hookRetentionRecommendations(hookStats) {
    const recs = []
    const entries = Object.entries(hookStats)
    if (entries.length < 2) return recs

    // Find best-performing hook style
    let bestHook = null, bestRetention = -1
    for (const [hook, stats] of entries) {
      if (stats.sampleCount < MIN_SAMPLES) continue
      if (stats.avgRetention != null && stats.avgRetention > bestRetention) {
        bestRetention = stats.avgRetention
        bestHook = hook
      }
    }

    if (!bestHook) return recs

    // Suggest hookStyle rotation toward the best performer
    for (const [hook, stats] of entries) {
      if (hook === bestHook) continue
      if (stats.sampleCount < MIN_SAMPLES) continue
      if (stats.avgRetention == null) continue

      const gap = bestRetention - stats.avgRetention
      if (gap * 100 < RETENTION_IMPROVEMENT_THRESHOLD) continue

      recs.push({
        type: 'hook_style',
        niche: null,
        field: 'hookStyle',
        currentValue: hook,
        suggestedValue: bestHook,
        confidence: Math.min(0.85, 0.4 + (stats.sampleCount + (hookStats[bestHook]?.sampleCount || 0)) * 0.03),
        reason: `"${bestHook}" hook retains ${(bestRetention * 100).toFixed(0)}% vs "${hook}" at ${(stats.avgRetention * 100).toFixed(0)}% (+${(gap * 100).toFixed(0)}pp)`,
        action: 'rotate',
      })
    }
    return recs
  }

  // ─── thumbnail CTR recommendations ──────────────────────────────────────
  _thumbnailCtrRecommendations(nicheStats) {
    // Placeholder: once thumbnail style is tracked per-niche, compare
    // CTR across thumbnail families and recommend the best performer.
    return []
  }

  // ─── overall average ────────────────────────────────────────────────────
  _overallAvg(nicheStats, field) {
    const vals = Object.values(nicheStats)
      .map(s => s[field])
      .filter(v => v != null)
    if (!vals.length) return null
    return vals.reduce((a, b) => a + b, 0) / vals.length
  }
}

// ─── Recommendation shape ────────────────────────────────────────────────────
// {
//   type: 'niche_profile' | 'hook_style' | 'thumbnail_style',
//   niche: string | null,
//   field: string,
//   currentValue: any,
//   suggestedValue: any,
//   confidence: number,   // 0–1
//   reason: string,
//   action: 'reinforce' | 'pivot' | 'rotate'
// }
