import fs from 'fs'
import path from 'path'
import { engagementScore } from '../analytics/EngagementScore.mjs'

const BRAND_MEMORY_FILE = process.env.BRAND_MEMORY_FILE || path.resolve(process.cwd(), 'data', 'brand-memory.json')

// Brand Performance Memory — the channel's packaging intelligence.
//
// Extends the fix-only ProductionMemory with CTR/pattern performance data:
//   {
//     "pattern": "HIDDEN_REVEALED",
//     "videos": 24,
//     "avgCTR": 3.1,
//     "replacement": "unexpected_angle",
//     "impact": -18
//   }
//
// Pattern records also carry measured signals and an editorial decision so
// downstream components can act autonomously:
//   {
//     "pattern": "SAMSUNG_GALAXY_ULTRA",
//     "category": "technology",
//     "signals": { ctr: 20, retention3s: 100, completion: 47.5, comments: 0, likes: 0 },
//     "decision": { boostTopic: true, boostHookStyle: "curiosity_gap", avoidOutro: "generic" },
//     "recommendation": "prioritize future technology stories"
//   }
//
// The AI learns: a pattern with measured low CTR is avoided automatically
// in future packaging — thumbnail text, titles, and hooks all route through
// this memory via ThumbnailBrandOptimizer. A high-engagement pattern gets
// boosted into the story selection queue (boostTopic).
export class BrandPerformanceMemory {
  constructor() {
    this.memory = this._load()
  }

  _load() {
    try {
      if (fs.existsSync(BRAND_MEMORY_FILE)) return JSON.parse(fs.readFileSync(BRAND_MEMORY_FILE, 'utf-8'))
    } catch { /* ignore */ }
    return { patterns: [] }
  }

  _persist() {
    try {
      fs.mkdirSync(path.dirname(BRAND_MEMORY_FILE), { recursive: true })
      fs.writeFileSync(BRAND_MEMORY_FILE, JSON.stringify(this.memory, null, 2))
    } catch { /* ignore */ }
  }

  // Record/update a pattern's measured performance (from analytics).
  // avgCTR null = no real data yet, keep the internal estimate.
  // signals: { ctr, retention3s, completion, comments, likes, shares, views } —
  // the raw measurements behind the decision.
  recordPattern(pattern, { videos = 1, avgCTR = null, replacement = null, impact = null, source = 'internal', category = null, signals = null } = {}) {
    const existing = this.memory.patterns.find(p => p.pattern === pattern)
    if (existing) {
      existing.videos = (existing.videos || 0) + videos
      if (avgCTR != null) {
        existing.avgCTR = existing.avgCTR == null
          ? avgCTR
          : Math.round(((existing.avgCTR * (existing.videos - videos)) + avgCTR * videos) / existing.videos * 10) / 10
      }
      if (replacement) existing.replacement = replacement
      if (impact != null) {
        existing.impact = existing.impact == null
          ? impact
          : Math.round(((existing.impact * (existing.videos - videos)) + impact * videos) / existing.videos)
      }
      existing.source = source
      existing.lastSeenAt = new Date().toISOString()
      if (category) existing.category = category
      if (signals) existing.signals = signals
      existing.decision = this._decision(existing)
      existing.recommendation = this._recommendation(existing)
    } else {
      const record = {
        pattern, videos, avgCTR, replacement, impact, source, category,
        signals: signals || null,
        firstSeenAt: new Date().toISOString(),
        lastSeenAt: new Date().toISOString(),
      }
      record.decision = this._decision(record)
      record.recommendation = this._recommendation(record)
      this.memory.patterns.push(record)
    }
    this._persist()
    return this.memory.patterns.find(p => p.pattern === pattern)
  }

  // Editorial decision derived from measured signals — the autonomous
  // newsroom reads these instead of re-deriving from raw numbers.
  _decision(record) {
    const s = record?.signals || {}
    const decision = { boostTopic: false, boostHookStyle: null, avoidOutro: null }
    if ((s.ctr != null && s.ctr >= 4.5) || (s.completion != null && s.completion >= 40)) decision.boostTopic = true
    if (s.retention3s != null) decision.boostHookStyle = s.retention3s >= 90 ? 'curiosity_gap' : 'question'
    if (s.completion != null && s.retention3s != null && s.completion < 50 && s.completion < s.retention3s - 20) decision.avoidOutro = 'generic'
    return decision
  }

  _recommendation(record) {
    const d = record?.decision || {}
    if (d.boostTopic) return `prioritize future ${record?.category || 'high-CTR'} stories`
    if (record?.avgCTR != null && record.avgCTR < 4.0) return 'avoid this pattern in titles'
    return 'neutral'
  }

  // Learned impact of a pattern (negative = avoid automatically)
  impactOf(pattern) {
    const p = this.memory.patterns.find(x => x.pattern === pattern)
    return p?.impact ?? null
  }

  // Production learning for the headline_emphasis_duplicate class: remember
  // that animating a keyword already shown in the headline hurt retention,
  // and that `with` is the better keyword for this category.
  recordEmphasisLesson({ category = 'technology', replaced, with: withWord, retentionImpact = -8, source = 'headline_emphasis_duplicate' } = {}) {
    if (!replaced || !withWord) return null
    return this.recordPattern(`emphasis:${source}:${category}:${String(replaced).toUpperCase()}`, {
      replacement: String(withWord).toUpperCase(),
      impact: retentionImpact,
      category,
      source: 'internal',
    })
  }

  // Lesson lookup for the emphasis resolver — words taught for a category.
  emphasisLessonsFor(category) {
    return this.memory.patterns
      .filter(p => p.pattern.startsWith('emphasis:headline_emphasis_duplicate:') && (!category || p.category === category))
      .map(p => ({ replaced: p.pattern.split(':').pop(), with: p.replacement, retentionImpact: p.impact, category: p.category }))
  }

  // The stored editorial decision for a pattern (or a neutral default)
  decisionFor(pattern) {
    const p = this.memory.patterns.find(x => x.pattern === pattern)
    return p?.decision || { boostTopic: false, boostHookStyle: null, avoidOutro: null }
  }

  // Engagement quality of a pattern (null = never measured)
  engagementOf(pattern) {
    const p = this.memory.patterns.find(x => x.pattern === pattern)
    if (!p?.signals) return null
    return engagementScore(p.signals)
  }

  // Patterns proven to hurt CTR — the automatic avoidance set
  lowCtrPatterns() {
    return this.memory.patterns
      .filter(p => (p.avgCTR != null && p.avgCTR < 4.0) || (p.impact != null && p.impact < 0))
      .sort((a, b) => a.avgCTR - b.avgCTR)
  }

  // Patterns the channel should lean into (data-backed growth priorities)
  boostPatterns() {
    return this.memory.patterns
      .filter(p => p.decision?.boostTopic === true)
      .sort((a, b) => (b.avgCTR || 0) - (a.avgCTR || 0))
  }

  // Novelty check: is this title free of known weak patterns?
  isNovel(title) {
    const t = (title || '').toUpperCase()
    return !this.lowCtrPatterns().some(p => t.includes(p.pattern))
  }

  // Replacement suggestion for a weak pattern (learned from data)
  replacementFor(pattern) {
    const p = this.memory.patterns.find(x => x.pattern === pattern)
    return p?.replacement || null
  }

  patterns() {
    return this.memory.patterns
  }
}
