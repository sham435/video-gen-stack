import fs from 'fs'
import path from 'path'

const BRAND_MEMORY_FILE = path.resolve(process.cwd(), 'data', 'brand-memory.json')

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
// The AI learns: a pattern with measured low CTR is avoided automatically
// in future packaging — thumbnail text, titles, and hooks all route through
// this memory via ThumbnailBrandOptimizer.
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
  recordPattern(pattern, { videos = 1, avgCTR = null, replacement = null, impact = null, source = 'internal' } = {}) {
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
    } else {
      this.memory.patterns.push({ pattern, videos, avgCTR, replacement, impact, source, firstSeenAt: new Date().toISOString(), lastSeenAt: new Date().toISOString() })
    }
    this._persist()
    return this.memory.patterns.find(p => p.pattern === pattern)
  }

  // Learned impact of a pattern (negative = avoid automatically)
  impactOf(pattern) {
    const p = this.memory.patterns.find(x => x.pattern === pattern)
    return p?.impact ?? null
  }

  // Patterns proven to hurt CTR — the automatic avoidance set
  lowCtrPatterns() {
    return this.memory.patterns
      .filter(p => (p.avgCTR != null && p.avgCTR < 4.0) || (p.impact != null && p.impact < 0))
      .sort((a, b) => a.avgCTR - b.avgCTR)
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
