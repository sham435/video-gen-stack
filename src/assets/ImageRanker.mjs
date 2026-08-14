// ImageRanker — deterministic scoring of candidate images for a scene.
//
// Score = w_relevance * relevance  +  w_quality * quality
//         + w_entity   * entityMatch - w_freshness * recencyPenalty
//         - w_reuse    * reusePenalty
//
// relevance : lexical/embedding match vs the scene's visual intent
// quality   : resolution, portrait aspect (Shorts), aspect fit
// entity    : exact entity hit (Apple Park > generic "tech")
// recency   : same asset used within cooldownDays → hard discount
// reuse     : usage_count-based long-tail penalty (cross-video diversity)
//
// All weights are constants; output is deterministic for identical inputs.

export const RANK_WEIGHTS = {
  relevance: 0.45,
  quality: 0.25,
  entity: 0.15,
  freshness: 0.08,   // applied as penalty
  reuse: 0.07,       // applied as penalty
  learned: 0.10,     // applied as bonus (0 when no performance data)
}

export const TARGET_ASPECT = 9 / 16 // portrait Shorts frame

export class ImageRanker {
  constructor({ weights = RANK_WEIGHTS, usageTracker = null, performanceMemory = null } = {}) {
    this.w = weights
    this.usageTracker = usageTracker
    this.performanceMemory = performanceMemory
  }

  /**
   * @param {Array<object>} candidates [{url, width, height, entity, tags, score, sha256, dHash, ...}]
   * @param {object} intent {subject, entities[], keywords[], mustShow[]}
   * @param {object} [opts] {cooldownDays, videoWindow}
   * @returns {Array<object>} candidates with .rankScore, best first
   */
  rank(candidates, intent = {}, opts = {}) {
    const keywords = this._keywords(intent)
    const entitySet = new Set((intent.entities || []).map(e => String(e).toLowerCase()))

    const scored = candidates.map(c => {
      const relevance = this._relevance(c, keywords)
      const entity = this._entity(c, entitySet)
      const quality = this._quality(c)
      const usage = this.usageTracker ? this.usageTracker.status(c, opts) : { hot: false, useCount: 0, usedInDays: null, usedInRecentVideos: false }
      const freshnessPenalty = usage.hot ? 1 : 0
      const reusePenalty = Math.min(1, usage.useCount / 6)

      // Milestone B: learned-performance bonus (0 on cold start → the
      // ranking is byte-identical to the deterministic heuristic ranking).
      const learned = this._learnedBonus(c, entitySet)
      // Per-channel policy: an asset used in any of the last `videoWindow`
      // videos is excluded outright (the "last 50 videos" rule). Hard gate —
      // not a penalty — so a repeated asset can never surface.
      const usedInRecentVideos = usage.usedInRecentVideos ? 1 : 0
      const score =
        (this.w.relevance * relevance +
        this.w.quality * quality +
        this.w.entity * entity -
        this.w.freshness * freshnessPenalty -
        this.w.reuse * reusePenalty +
        this.w.learned * learned) * (1 - usedInRecentVideos)
      return { ...c, rankScore: +score.toFixed(4), _usage: usage, _learned: learned, _excluded: usedInRecentVideos === 1 }
    })

    return scored.sort((a, b) => b.rankScore - a.rankScore)
  }

  /**
   * Learned bonus in [0,1]: blend asset-level performance with entity-level
   * performance, gated by confidence. 0 when no analytics exist.
   */
  _learnedBonus(c, entitySet) {
    if (!this.performanceMemory) return 0
    const asset = c.sha256 ? this.performanceMemory.asset(c.sha256) : null
    const entityName = c.entity || (entitySet.size ? [...entitySet][0] : null)
    const entity = entityName ? this.performanceMemory.entity(entityName) : null
    let bonus = 0
    if (asset) bonus += asset.score * asset.confidence
    if (entity && entity.confidence > 0) bonus += entity.score * entity.confidence * 0.5
    return +Math.min(1, bonus).toFixed(4)
  }

  _keywords(intent) {
    const k = []
    for (const key of ['subject', 'topic', 'query']) {
      const v = intent[key]
      if (typeof v === 'string' && v) k.push(...v.toLowerCase().split(/\s+/))
    }
    for (const arr of ['keywords', 'mustShow']) {
      if (Array.isArray(intent[arr])) {
        for (const w of intent[arr]) if (typeof w === 'string') k.push(...w.toLowerCase().split(/\s+/))
      }
    }
    return k.filter(w => w.length > 2)
  }

  _relevance(c, keywords) {
    if (!keywords.length) return 0.5
    const hay = [c.url || '', c.tags || [], c.title || '', c.entity || ''].join(' ').toLowerCase()
    let hits = 0
    for (const w of keywords) if (hay.includes(w)) hits++
    return Math.min(1, hits / Math.min(keywords.length, 4))
  }

  _entity(c, entitySet) {
    if (!entitySet.size) return 0
    const hay = String(c.entity || c.title || '').toLowerCase()
    const url = String(c.url || '').toLowerCase()
    for (const e of entitySet) {
      if (hay.includes(e) || url.includes(e.replace(/\s+/g, '-'))) return 1
    }
    return 0
  }

  _quality(c) {
    let q = 0
    const area = (c.width || 0) * (c.height || 0)
    if (area >= 1080 * 1920) q += 0.5
    else if (area >= 640 * 1136) q += 0.3
    else q += 0.1
    const aspect = c.aspect || ((c.width && c.height) ? c.width / c.height : 0)
    if (aspect > 0) {
      const fit = 1 - Math.min(1, Math.abs(aspect - TARGET_ASPECT) / TARGET_ASPECT)
      q += fit * 0.5
    } else {
      q += 0.2
    }
    return q
  }
}
