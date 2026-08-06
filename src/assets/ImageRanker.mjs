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
}

export const TARGET_ASPECT = 9 / 16 // portrait Shorts frame

export class ImageRanker {
  constructor({ weights = RANK_WEIGHTS, usageTracker = null } = {}) {
    this.w = weights
    this.usageTracker = usageTracker
  }

  /**
   * @param {Array<object>} candidates [{url, width, height, entity, tags, score, sha256, dHash, ...}]
   * @param {object} intent {subject, entities[], keywords[], mustShow[]}
   * @param {object} [opts] {cooldownDays}
   * @returns {Array<object>} candidates with .rankScore, best first
   */
  rank(candidates, intent = {}, opts = {}) {
    const keywords = this._keywords(intent)
    const entitySet = new Set((intent.entities || []).map(e => String(e).toLowerCase()))

    const scored = candidates.map(c => {
      const relevance = this._relevance(c, keywords)
      const entity = this._entity(c, entitySet)
      const quality = this._quality(c)
      const usage = this.usageTracker ? this.usageTracker.status(c, opts) : { hot: false, useCount: 0, usedInDays: null }
      const freshnessPenalty = usage.hot ? 1 : 0
      const reusePenalty = Math.min(1, usage.useCount / 6)
      const score =
        this.w.relevance * relevance +
        this.w.quality * quality +
        this.w.entity * entity -
        this.w.freshness * freshnessPenalty -
        this.w.reuse * reusePenalty
      return { ...c, rankScore: +score.toFixed(4), _usage: usage }
    })

    return scored.sort((a, b) => b.rankScore - a.rankScore)
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
