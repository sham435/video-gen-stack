// ThumbnailJudge — scores and selects the best thumbnail candidate.
//
// Uses ThumbnailPolicy validation + heuristic CTR scoring to rank
// candidates. Returns the winner with full scoring breakdown.
//
// Scoring dimensions:
//   - policyValid    — passes ThumbnailPolicy (must pass to be eligible)
//   - hookScore      — hook word strength (length, number presence, caps)
//   - visualScore    — hero image presence + file size proxy for complexity
//   - textScore      — headline length and clarity
//   - compositeScore — weighted combination

import { ThumbnailPolicy } from './ThumbnailPolicy.mjs'
import { readFileSync } from 'node:fs'

function hookScore(candidate) {
  let score = 50
  const hook = (candidate.hook || '').toUpperCase()
  if (hook.length >= 3 && hook.length <= 20) score += 20
  if (/\d/.test(hook)) score += 15
  if (hook === hook.toUpperCase() && hook.length > 0) score += 10
  if (['BREAKING', 'SHOCKING', 'EXCLUSIVE', 'URGENT'].some(w => hook.includes(w))) score += 10
  return Math.min(score, 100)
}

function visualScore(candidate, buffer) {
  let score = 40
  if (candidate.heroImage) score += 30
  if (buffer && buffer.length > 50 * 1024) score += 15
  if (buffer && buffer.length > 100 * 1024) score += 10
  return Math.min(score, 100)
}

function textScore(candidate) {
  let score = 50
  const headline = candidate.headline || ''
  if (headline.length >= 15 && headline.length <= 80) score += 25
  if (headline.length <= 60) score += 10
  const badge = candidate.bottomBadge || ''
  if (badge.length >= 2 && badge.length <= 20) score += 15
  return Math.min(score, 100)
}

export class ThumbnailJudge {
  constructor(options = {}) {
    this.minScore = options.minScore || 60
  }

  judge(candidates) {
    const scored = candidates.map(c => {
      if (!c.rendered || !c.path) {
        return { ...c, eligible: false, compositeScore: 0, reason: 'not rendered' }
      }

      // Respect composition preflight rejection
      if (c.eligible === false && c.compositionErrors) {
        return { ...c, compositeScore: 0, reason: `composition rejected: ${c.compositionErrors.join('; ')}` }
      }

      let buffer
      try {
        buffer = readFileSync(c.path)
      } catch {
        return { ...c, eligible: false, compositeScore: 0, reason: 'cannot read file' }
      }

      const policy = ThumbnailPolicy.validate(buffer, 'youtube')
      if (!policy.valid) {
        return { ...c, eligible: false, compositeScore: 0, reason: policy.errors.join('; '), policy }
      }

      const h = hookScore(c)
      const v = visualScore(c, buffer)
      const t = textScore(c)
      const composite = Math.round(h * 0.35 + v * 0.30 + t * 0.35)

      return {
        ...c,
        eligible: true,
        hookScore: h,
        visualScore: v,
        textScore: t,
        compositeScore: composite,
        policy,
      }
    })

    const eligible = scored.filter(c => c.eligible)
    eligible.sort((a, b) => b.compositeScore - a.compositeScore)

    return {
      scored,
      winner: eligible[0] || null,
      runnerUp: eligible[1] || null,
      eligibleCount: eligible.length,
      totalCount: candidates.length,
    }
  }
}
