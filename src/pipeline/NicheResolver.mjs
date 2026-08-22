// NicheResolver — single source of truth for "what is this article about?"
//
// Contract:
//   resolveNiche(article) → NicheDecision
//     { key, source, confidence, reason }
//
// Resolution order:
//   1. article.category (explicit) → confidence: 1.0
//   2. Heuristic keyword scoring → confidence: 0.60–0.95
//   3. Fallback → GENERAL (confidence: 0)
//
// This module is DETERMINISTIC at the contract level — it never returns
// arbitrary LLM text. LLM output is normalized through the canonical set
// before it reaches the decision. The confidence threshold (>= 0.80) is
// enforced here; production policy (how to RENDER that niche) lives in
// CategoryProductionProfiles, not here.

import { normalize, heuristicScore, applyConfidencePolicy } from '../youtube/nicheResolver.mjs'

export const NICHES = Object.freeze([
  'TESLA', 'APPLE', 'AI', 'SAMSUNG', 'GOOGLE', 'MICROSOFT',
  'SPACE', 'GAMING', 'CRYPTO', 'GENERAL',
])

// Production confidence threshold — below this, fallback to GENERAL.
const PRODUCTION_THRESHOLD = 0.80

// ─── resolveNiche ────────────────────────────────────────────────────────────
// The pipeline entry point. Every article passes through here exactly once.
// Nobody calls detectNiche() again downstream.
//
// Returns NicheDecision:
//   { key: string, source: 'explicit'|'heuristic'|'ai'|'fallback',
//     confidence: number, reason: string|null }
export async function resolveNiche(article, { llm } = {}) {
  const text = article?.headline || article?.title || article?.body || article?.text || ''

  // 1. Explicit category — always wins
  if (article?.category) {
    const niche = normalize(article.category)
    if (niche) {
      return Object.freeze({
        key: niche,
        source: 'explicit',
        confidence: 1.0,
        reason: `article.category = "${article.category}"`,
      })
    }
    // Unrecognized category → fall through to detection
  }

  // 2. Heuristic keyword scoring (always available, zero dependencies)
  const heuristic = heuristicScore(text)
  const decision = applyConfidencePolicy({ ...heuristic, source: 'heuristic' })

  // 3. Apply production threshold
  if (decision.confidence >= PRODUCTION_THRESHOLD) {
    return Object.freeze({
      key: decision.niche,
      source: decision.source,
      confidence: decision.confidence,
      reason: decision.reason,
    })
  }

  // Below threshold — fallback to GENERAL
  return Object.freeze({
    key: 'GENERAL',
    source: 'fallback',
    confidence: decision.confidence,
    reason: `confidence ${decision.confidence} below threshold (${PRODUCTION_THRESHOLD})`,
  })
}

// ─── resolveNicheSync ────────────────────────────────────────────────────────
// Synchronous variant for callers that already have the text/category.
// Returns the same NicheDecision shape.
export function resolveNicheSync(text, category) {
  if (category) {
    const niche = normalize(category)
    if (niche) {
      return Object.freeze({ key: niche, source: 'explicit', confidence: 1.0, reason: `article.category = "${category}"` })
    }
  }
  const heuristic = heuristicScore(text)
  const decision = applyConfidencePolicy({ ...heuristic, source: 'heuristic' })
  if (decision.confidence >= PRODUCTION_THRESHOLD) {
    return Object.freeze({ key: decision.niche, source: decision.source, confidence: decision.confidence, reason: decision.reason })
  }
  return Object.freeze({ key: 'GENERAL', source: 'fallback', confidence: decision.confidence, reason: `below threshold` })
}
