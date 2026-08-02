import { CuriosityEngine } from './CuriosityEngine.mjs'

// Pattern key shared by the optimizer and the retention learning loop —
// a normalized 3-token signature of a title's packaging pattern.
export function patternKey(title) {
  return (title || '').toUpperCase().split(' ').filter(w => w.length > 3).slice(0, 3).join('_')
}

// Deterministic string hash for tie-breaking (stable across runs/machines)
function hash(str) {
  let h = 0
  for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) | 0
  return Math.abs(h)
}

// Thumbnail Brand Optimizer — the channel packaging manager.
//
// Runs as an autonomous judge between the cover/headline stage and render:
// it detects repetitive brand patterns ("HIDDEN X REVEALED", "SECRET…",
// "SHOCKING…"), replaces them with curiosity-gap angles, scores every
// candidate (CTR predictor + brand safety + novelty), and selects the best
// packaging — no admin intervention.
//
// The judge also consults BrandPerformanceMemory: once real CTR data proves
// a pattern underperforms, that pattern is avoided automatically.
export class ThumbnailBrandOptimizer {
  constructor(options = {}) {
    this.forbiddenPatterns = [
      'hidden', 'revealed', 'secret', 'shocking', "you won't believe",
      'exposed', 'buried', 'nobody knew', 'the truth about',
    ]
    this.curiosity = new CuriosityEngine({ forbidden: this.forbiddenPatterns })
    this.brandMemory = options.brandMemory || null
    this.minScore = options.minScore || 80
    this.minReplaceScore = options.minReplaceScore || 60
    this.titleMaxLen = options.titleMaxLen || 60
  }

  // Detect brand risk in the current packaging (title + thumbnail text).
  analyze(thumbnail, title) {
    const detected = this.forbiddenPatterns.filter(word =>
      (title || '').toLowerCase().includes(word) ||
      (thumbnail?.text || thumbnail?.overlayText || '').toLowerCase().includes(word)
    )
    const memoryWarn = this._memoryWarnings(title)
    return {
      brandRisk: detected.length > 0 ? 'HIGH' : memoryWarn ? 'MEDIUM' : 'LOW',
      replacementNeeded: detected.length > 0,
      memoryWarning: memoryWarn || null,
      detected,
      suggestions: this.generateAlternatives(title),
    }
  }

  // Suggest replacement angles via the Curiosity Engine (deterministic,
  // zero admin intervention, topic-aware).
  generateAlternatives(title) {
    return this.curiosity.generate({ title }, title).candidates
  }

  // CTR predictor — heuristic scoring of packaging strength.
  _ctrScore(candidate, article) {
    const t = candidate.title || ''
    let score = 60
    // Topic specificity: uppercase entity/brand in the title
    if (/\b[A-Z][A-Z0-9.]{2,}\b/.test(t)) score += 12
    // Numeric/specific signal (iOS 27, GPT-5, 2026…)
    if (/\b\d[\d.]*\b/.test(t)) score += 8
    // Curious-verb phrasing (action + unknown outcome)
    if (/\b(Nobody|What|Why|How|Did|Changed|Missed|Just|Disagree)\b/.test(t)) score += 10
    // Length: too long clips in feeds, too short lacks signal
    if (t.length <= this.titleMaxLen) score += 5
    else if (t.length > this.titleMaxLen + 15) score -= 8
    // Avoided-vocabulary penalty
    if (this.forbiddenPatterns.some(w => t.toLowerCase().includes(w))) score -= 25
    // Novelty: learned low-CTR pattern from BrandPerformanceMemory
    const learned = this.brandMemory?.impactOf(this._patternKey(t))
    if (learned && learned < 0) score += learned // negative impact drags score
    return Math.max(0, Math.min(100, Math.round(score)))
  }

  _patternKey(title) {
    return patternKey(title)
  }

  _memoryWarnings(title) {
    if (!this.brandMemory) return null
    const warned = this.brandMemory.lowCtrPatterns().find(p => (title || '').toUpperCase().includes(p.pattern))
    return warned
      ? `${warned.pattern} pattern: ${warned.videos} videos @ ${warned.avgCTR}% CTR (impact ${warned.impact})`
      : null
  }

  // Full autonomous scoring pipeline — thumbnail judge.
  //   candidate scoring: CTR predictor → brand safety → novelty → selection
  judge(article, thumbnail = null, title = null) {
    const current = title || article?.title || ''
    const analysis = this.analyze(thumbnail, current)
    const alternatives = analysis.suggestions

    const candidates = [
      { title: current, source: 'current', angle: null },
      ...alternatives.map(a => ({ title: a.title, source: 'curiosity', angle: a.type, reason: a.reason })),
    ].map(c => {
      const score = this._ctrScore(c, article)
      return {
        ...c,
        score,
        brandSafety: this.forbiddenPatterns.some(w => c.title.toLowerCase().includes(w)) ? 'LOW' : 'HIGH',
        novelty: this.brandMemory?.isNovel(c.title) ?? true,
      }
    })

    // Sort by score, then break ties with a title hash so the same angle is
    // never picked for every video — rotating angles avoids creating a new
    // repetitive identity ("The Detail Everyone Missed" × 50 videos)
    const ranked = candidates.sort((a, b) => b.score - a.score || hash(a.title) - hash(b.title))
    const winner = ranked[0]
    const currentCandidate = ranked.find(c => c.source === 'current')
    // Selection policy:
    //   - HIGH risk (forbidden pattern) → force the replacement: any solid
    //     curiosity angle beats keeping "HIDDEN/REVEALED/SECRET" in the feed
    //   - LOW risk → keep the current title unless a candidate clearly wins
    const forbiddenDetected = analysis.replacementNeeded || analysis.detected.length > 0
    const selected = forbiddenDetected
      ? (winner.score >= this.minReplaceScore ? winner : currentCandidate)
      : (winner.source !== 'current' && winner.score >= this.minScore && winner.score > currentCandidate.score + 5
          ? winner
          : currentCandidate)

    const report = {
      title,
      analysis,
      candidates: ranked,
      score: selected.score,
      selected,
      replacementNeeded: analysis.replacementNeeded,
    }

    if (selected.source !== 'current') {
      // Learn the replacement so future runs avoid the old pattern
      this.brandMemory?.recordPattern(this._patternKey(current), {
        replacement: selected.angle,
        impact: -8,
        source: 'auto_replaced',
      })
    }
    return report
  }

  // Growth loop entry: after analytics confirm real CTR, record the pattern.
  learnFromAnalytics(entry) {
    if (!entry?.title || entry.ctr == null) return
    const pattern = this._patternKey(entry.title)
    this.brandMemory?.recordPattern(pattern, {
      videos: 1,
      avgCTR: entry.ctr,
      impact: Math.round((entry.ctr - 4.5) * 10), // 4.5% baseline → +/-
      source: 'analytics',
    })
  }
}
