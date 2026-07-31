export class AgentCouncil {
  constructor(options = {}) {
    this.threshold = options.threshold || 70
  }

  score(contract, article = {}) {
    const story = this._storyScore(contract, article)
    const ctr = this._ctrScore(contract, article)
    const retention = this._retentionScore(contract)

    const weights = { story: 0.35, ctr: 0.35, retention: 0.30 }
    const final = Math.round(story * weights.story + ctr * weights.ctr + retention * weights.retention)

    return {
      story_score: story,
      ctr_score: ctr,
      retention_score: retention,
      final_score: final,
      passed: final >= this.threshold,
      threshold: this.threshold,
      votes: {
        'editor-in-chief': { score: story, decision: story >= 70 ? 'approve' : 'reconsider' },
        'ctr-agent': { score: ctr, decision: ctr >= 70 ? 'approve' : 'reconsider' },
        'retention-agent': { score: retention, decision: retention >= 70 ? 'approve' : 'reconsider' },
      },
      recommendations: this._recommendations({ story, ctr, retention }, contract),
    }
  }

  _recommendations(scores, contract) {
    const recs = []
    if (scores.story < 70) {
      recs.push('Rewrite the first 5 seconds — hook lacks curiosity')
      if (contract?.story?.headline && contract.story.headline.length < 15) recs.push('Expand headline to 15+ characters')
    }
    if (scores.ctr < 70) {
      recs.push('Regenerate cover — improve headline/subject contrast')
      if (!contract?.cover?.subheadline) recs.push('Add a subheadline to the cover')
    }
    if (scores.retention < 70) {
      recs.push('Increase pacing — add a reveal every 5 seconds')
      recs.push('Shorten runtime to boost retention')
    }
    if (recs.length === 0) recs.push('Production package approved — no changes needed')
    return recs
  }

  _storyScore(contract, article) {
    let score = 40
    const headline = contract?.story?.headline || article.title || ''
    if (headline.length >= 15) score += 10
    if (contract?.story?.hook) score += 15
    if (contract?.scenes?.length >= 4) score += 15
    if (contract?.story?.angle) score += 10
    if (contract?.story?.target_audience) score += 10
    return Math.min(99, score)
  }

  _ctrScore(contract, article) {
    let score = 40
    const c = contract?.cover
    if (c?.headline) score += 15
    if (c?.subheadline) score += 10
    if (c?.visual_subject) score += 15
    if (c?.emotion) score += 10
    if (c?.ctr_target) score += 9
    return Math.min(99, score)
  }

  _retentionScore(contract) {
    let score = 40
    const r = contract?.retention
    if (r?.pattern) score += 15
    if (r?.first_3_seconds?.pattern) score += 15
    if (r?.middle?.pattern) score += 10
    if (r?.ending?.pattern) score += 10
    if (r?.hook_refresh) score += 9
    return Math.min(99, score)
  }
}
