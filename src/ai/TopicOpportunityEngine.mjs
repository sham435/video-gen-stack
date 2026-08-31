// TopicOpportunityEngine — deterministic pre-render ViralPotentialScore.
//
// The NEWS-MONSTER growth loop scores each story BEFORE rendering so the
// scheduler/strategy brain can reject weak topics, regenerate mid ones, and
// prioritize strong ones — instead of guessing "is this viral?" after the fact.
//
// This module is deliberately DETERMINISTIC and PURE:
//   - 8 bounded signals (0..1) per the ViralPotentialScore model:
//       topicInterest, novelty, urgency, audienceFit, visualPotential,
//       headlineStrength, competition, searchDemand
//   - `competition` is INVERTED (lower competition => higher opportunity), all
//     others are higher-is-better.
//   - A configurable weighted total and an explicit verdict bucket.
//   - Signals are derived from title/category when not supplied explicitly, so
//     the engine is fully testable offline; callers (LLM layer / CI) may inject
//     precise per-signal values via the same API.
//
// Thresholds are INTERNAL model thresholds (per the growth brief: "these
// numbers should be your model's internal thresholds, not claimed YouTube
// thresholds"). They are exported + documented, not implied as platform truth.
//
// Verdict buckets:
//   < 0.55            -> REJECT      (do not produce)
//   0.55 .. 0.70      -> REGENERATE  (weak: retry copy/subject/topic)
//   0.70 .. 0.82      -> ACCEPT      (produce normally)
//   > 0.82            -> PRIORITY    (produce + prioritize in scheduler)
//
// This module never executes production — it only scores and explains.

import { getProfile } from '../production/CategoryProductionProfiles.mjs'

// ── Verdict thresholds (internal model policy) ─────────────────────────────
export const THRESHOLD_REJECT = 0.55      // below => REJECT
export const THRESHOLD_REGENERATE = 0.70  // below => REGENERATE
export const THRESHOLD_PRIORITY = 0.82    // above => PRIORITY

// Weighted importance of each signal in the total score. Configurable; used as
// the default when `weights` is not supplied. Values need not sum to 1 — the
// total is normalized by the sum of applied weights so partial signal sets
// remain comparable.
export const DEFAULT_WEIGHTS = Object.freeze({
  topicInterest: 0.25,
  urgency: 0.20,
  novelty: 0.15,
  audienceFit: 0.12,
  visualPotential: 0.10,
  headlineStrength: 0.08,
  searchDemand: 0.05,
  competition: 0.05, // inverted: lower competition => higher contribution
})

// Higher-interest niches (proxy for search demand + audience fit).
const HIGH_DEMAND = new Set(['AI', 'APPLE', 'SAMSUNG', 'SPACE', 'GAMING', 'GOOGLE', 'TESLA', 'CRYPTO', 'MICROSOFT'])

// Urgency / breaking markers surfaced straight from the title.
const URGENCY_MARKERS = [
  'breaking', 'unveil', 'just', 'now', 'live', 'first', 'launch', 'reveal',
  'crashes', 'crash', 'surges', 'soars', 'plunges', 'record', 'shock', 'emerg',
  'halt', 'suspends', 'warns', 'announces', 'releases', 'wins', 'beats',
]

// Novelty markers — words/structures that signal "new / rare / surprising".
const NOVELTY_MARKERS = [
  'first', 'new', 'never', 'breakthrough', 'unveils', 'world\'s', 'one-of-a-kind',
  'revolutionary', 'game-chang', 'unprecedented', 'marvel', 'born', 'secret',
]

// Generic news verbs that carry little headline bite — penalize headlineStrength.
const WEAK_HEADLINE_WORDS = [
  'says', 'say', 'report', 'reports', 'revealed', 'announced', 'reveals',
  'announces', 'update', 'update:', 'to', 'the', 'a', 'an', 'of', 'in', 'on',
]

const clamp01 = (v) => Math.max(0, Math.min(1, Number.isFinite(v) ? v : 0))

/**
 * Deterministic signal derivation from the title/category text. Returns a
 * 0..1 value per signal. Used only when an explicit value is not provided so
 * callers can override any signal.
 */
function deriveSignals({ title = '', category = '', profileKey = '' }) {
  const text = String(title || '').toLowerCase()
  const upper = String(title || '').toUpperCase()
  const cat = String(category || '').toUpperCase()
  const key = String(profileKey || cat).toUpperCase().replace(/[^A-Z]/g, '')

  // topicInterest — known tech/news niche focus (higher for a recognizable label).
  const topicInterest = HIGH_DEMAND.has(key) ? 0.82 : key === 'GENERAL' ? 0.45 : 0.62

  // urgency — breaking-news markers + numerals (numbers stop the scroll).
  let urgency = 0.40
  const hitUrgency = URGENCY_MARKERS.filter((m) => text.includes(m)).length
  if (hitUrgency > 0) urgency = Math.min(0.98, 0.55 + hitUrgency * 0.12)
  if (/\d/.test(upper)) urgency = Math.min(0.98, urgency + 0.10)

  // novelty — surprises / firsts / major leaps.
  let novelty = 0.42
  const hitNovel = NOVELTY_MARKERS.filter((m) => text.includes(m)).length
  if (hitNovel > 0) novelty = Math.min(0.95, 0.52 + hitNovel * 0.14)

  // audienceFit — recognized high-demand niche maps to a real production profile.
  const audienceFit = HIGH_DEMAND.has(key) ? 0.86 : key === 'GENERAL' ? 0.50 : 0.68

  // visualPotential — degree of concrete imagery implied (based on the niche's
  // preferred visuals; image-heavy categories score higher).
  const profile = getProfile(key)
  const preferredLen = (profile.preferredVisuals || []).length
  const visualPotential = clamp01((preferredLen >= 3 ? 0.85 : 0.70) + (HIGH_DEMAND.has(key) ? 0.05 : 0))

  // headlineStrength — short, punchy titles (2–6 real words) outrank long/diluted ones.
  const words = upper.split(/\s+/).filter(Boolean)
  const meaningful = words.filter((w) => !WEAK_HEADLINE_WORDS.includes(w.toLowerCase()))
  let headlineStrength = 0.45
  if (meaningful.length >= 2 && meaningful.length <= 6) headlineStrength = 0.82
  else if (meaningful.length > 6) headlineStrength = 0.55 // too long for a 2–6 word thump
  else if (meaningful.length === 1) headlineStrength = 0.60

  // searchDemand — high-interest topic keywords proxy for search volume.
  const searchDemand = HIGH_DEMAND.has(key) ? 0.84 : key === 'GENERAL' ? 0.45 : 0.62

  // competition — inverse proxy: broad "GENERAL NEWS" is the most crowded space.
  const competition = key === 'GENERAL' ? 0.38 : HIGH_DEMAND.has(key) ? 0.58 : 0.50

  return {
    topicInterest, urgency, novelty, audienceFit,
    visualPotential, headlineStrength, searchDemand, competition,
  }
}

/**
 * Score a topic's viral potential.
 *
 * @param {object} input
 *   { topic?, title?, description?, category?, thumbnailConcept?,
 *     novelty?, urgency?, audienceFit?, visualPotential?, headlineStrength?,
 *     competition?, searchDemand? }  — explicit signals override derivation.
 * @param {object} opts
 *   { weights? (override DEFAULT_WEIGHTS), profileKey? (niche key, defaults to category) }
 * @returns
 *   { signals, weighted, total, verdict, contribution, reasons, at }
 */
export function scoreViralPotential(input = {}, opts = {}) {
  const title = input.title || input.topic || ''
  const description = input.description || ''
  const category = input.category || 'general'
  const profileKey = opts.profileKey || category

  const derived = deriveSignals({ title, description, category, profileKey })

  // Explicit per-signal values win; otherwise use derived deterministic values.
  const raw = {
    topicInterest: input.topicInterest ?? derived.topicInterest,
    urgency: input.urgency ?? derived.urgency,
    novelty: input.novelty ?? derived.novelty,
    audienceFit: input.audienceFit ?? derived.audienceFit,
    visualPotential: input.visualPotential ?? derived.visualPotential,
    headlineStrength: input.headlineStrength ?? derived.headlineStrength,
    searchDemand: input.searchDemand ?? derived.searchDemand,
    competition: input.competition ?? derived.competition,
  }
  const signals = {}
  for (const k of Object.keys(raw)) signals[k] = clamp01(raw[k])

  const weights = { ...DEFAULT_WEIGHTS, ...(opts.weights || {}) }
  // Weights may be 0 to exclude a signal; the normalized total only sums the
  // signals that actually contribute.
  let acc = 0
  let weightSum = 0
  const contribution = {}
  for (const k of Object.keys(signals)) {
    const w = Number(weights[k]) || 0
    // competition is inverted: less competition => more opportunity.
    const value = k === 'competition' ? 1 - signals[k] : signals[k]
    contribution[k] = { signal: signals[k], weight: w, value }
    if (w > 0) {
      acc += value * w
      weightSum += w
    }
  }
  const total = weightSum > 0 ? acc / weightSum : 0

  let verdict
  if (total < THRESHOLD_REJECT) verdict = 'REJECT'
  else if (total < THRESHOLD_REGENERATE) verdict = 'REGENERATE'
  else if (total < THRESHOLD_PRIORITY) verdict = 'ACCEPT'
  else verdict = 'PRIORITY'

  const reasons = buildReasons({ signals, contribution, total, verdict })

  return {
    signals,
    weighted: contribution,
    total: Number(total.toFixed(3)),
    verdict,
    contribution,
    reasons,
    at: new Date().toISOString(),
  }
}

// Human-readable summary of why the verdict was reached.
function buildReasons({ signals, contribution, total, verdict }) {
  const ordering = Object.entries(contribution)
    .sort((a, b) => b[1].value - a[1].value)
    .slice(0, 3)
  return ordering.map(([k, c]) => `${k}=${c.signal.toFixed(2)} (contributes ${c.value.toFixed(2)} × w${c.weight})`)
    .concat(`weighted=${total.toFixed(3)} => ${verdict}`)
}

export const TopicOpportunityEngine = Object.freeze({
  score: scoreViralPotential,
  THRESHOLD_REJECT,
  THRESHOLD_REGENERATE,
  THRESHOLD_PRIORITY,
  DEFAULT_WEIGHTS,
})

export default TopicOpportunityEngine
