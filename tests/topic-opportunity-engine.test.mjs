// Tests for TopicOpportunityEngine — the deterministic pre-render ViralPotentialScore.
//
// Covers:
//   1. deterministic signal derivation from title/category (all 0..1)
//   2. verdict buckets (REJECT / REGENERATE / ACCEPT / PRIORITY) + threshold boundaries
//   3. competition is INVERTED (lower competition => higher contribution)
//   4. weighted total normalization (partial weights applied)
//   5. explicit per-signal overrides win over derivation
//   6. integration into ProductionStrategyController (plan carries viralPotential)
//
// Run: node --test tests/topic-opportunity-engine.test.mjs

import test from 'node:test'
import assert from 'node:assert/strict'
import {
  scoreViralPotential,
  TopicOpportunityEngine,
  THRESHOLD_REJECT,
  THRESHOLD_REGENERATE,
  THRESHOLD_PRIORITY,
  DEFAULT_WEIGHTS,
} from '../src/ai/TopicOpportunityEngine.mjs'
import { ProductionStrategyController } from '../src/ai/ProductionStrategyController.mjs'

const SIGNALS = [
  'topicInterest', 'novelty', 'urgency', 'audienceFit',
  'visualPotential', 'headlineStrength', 'competition', 'searchDemand',
]

test('derives all 8 signals bounded in [0,1] for a strong tech story', () => {
  const r = scoreViralPotential({
    title: 'AI gaming agent breakthrough for competitive esports',
    category: 'AI',
  })
  for (const s of SIGNALS) {
    assert.ok(typeof r.signals[s] === 'number', `signal ${s} present`)
    assert.ok(r.signals[s] >= 0 && r.signals[s] <= 1, `${s}=${r.signals[s]} in [0,1]`)
  }
  assert.ok(r.total >= 0 && r.total <= 1)
  assert.ok(Array.isArray(r.reasons) && r.reasons.length >= 1)
  assert.ok(typeof r.verdict === 'string')
})

test('REJECT bucket — weak / generic topics fall below threshold', () => {
  const r = scoreViralPotential({
    title: 'Local council issues weekly parking notice update',
    category: 'general',
  })
  assert.ok(r.total < THRESHOLD_REJECT, `total ${r.total} < ${THRESHOLD_REJECT}`)
  assert.equal(r.verdict, 'REJECT')
})

test('REGENERATE bucket — neutral topics sit in the 0.55..0.70 band', () => {
  const r = scoreViralPotential({
    title: 'Tech firm publishes annual memo',
    category: 'technology',
  })
  assert.ok(r.total >= THRESHOLD_REJECT && r.total < THRESHOLD_REGENERATE,
    `total ${r.total} in [0.55,0.70)`)
  assert.equal(r.verdict, 'REGENERATE')
})

test('ACCEPT bucket — solid breaking story crosses into acceptable band', () => {
  const r = scoreViralPotential({
    title: 'Microsoft unveils a new autonomous AI gaming agent',
    category: 'AI',
  })
  assert.ok(r.total >= THRESHOLD_REGENERATE && r.total < THRESHOLD_PRIORITY,
    `total ${r.total} in [0.70,0.82)`)
  assert.equal(r.verdict, 'ACCEPT')
})

test('PRIORITY bucket — strong signals produce > 0.82 priority', () => {
  const r = scoreViralPotential({
    title: 'AI gaming agent breakthrough; the world was not ready',
    category: 'AI',
    topicInterest: 0.95,
    novelty: 0.95,
    urgency: 0.95,
    audienceFit: 0.95,
    visualPotential: 0.95,
    headlineStrength: 0.95,
    searchDemand: 0.95,
    competition: 0.10,
  })
  assert.ok(r.total > THRESHOLD_PRIORITY, `total ${r.total} > ${THRESHOLD_PRIORITY}`)
  assert.equal(r.verdict, 'PRIORITY')
})

test('explicit weak signals yield REJECT', () => {
  const r = scoreViralPotential({
    title: 'anything',
    topicInterest: 0.2,
    novelty: 0.2,
    urgency: 0.2,
    audienceFit: 0.2,
    visualPotential: 0.2,
    headlineStrength: 0.2,
    searchDemand: 0.2,
    competition: 0.9, // high competition => low contribution
  })
  assert.ok(r.total < THRESHOLD_REJECT, `total ${r.total} < ${THRESHOLD_REJECT}`)
  assert.equal(r.verdict, 'REJECT')
})

test('competition is inverted: lower competition raises the total', () => {
  const low = scoreViralPotential({ title: 'x', novelty: 0.9, urgency: 0.9, topicInterest: 0.9, audienceFit: 0.9, visualPotential: 0.9, headlineStrength: 0.9, searchDemand: 0.9, competition: 0.1 })
  const high = scoreViralPotential({ title: 'x', novelty: 0.9, urgency: 0.9, topicInterest: 0.9, audienceFit: 0.9, visualPotential: 0.9, headlineStrength: 0.9, searchDemand: 0.9, competition: 0.9 })
  assert.ok(low.total > high.total, `lowCompetition ${low.total} > highCompetition ${high.total}`)
  // And the raw competition signal is stored uninverted.
  assert.equal(low.signals.competition, 0.1)
  assert.equal(high.signals.competition, 0.9)
})

test('partial weights normalize the total (signals with zero weight are excluded)', () => {
  // Zero out the biggest default weight (topicInterest 0.20); total must still
  // be a valid normalized number in [0,1].
  const weights = Object.fromEntries(Object.entries(DEFAULT_WEIGHTS).map(([k, v]) => [k, k === 'topicInterest' ? 0 : v]))
  const r = scoreViralPotential({ title: 'AI gaming breakthrough', category: 'AI' }, { weights })
  assert.ok(r.total >= 0 && r.total <= 1)
  assert.ok(r.weighted.topicInterest.weight === 0, 'topicInterest excluded')
})

test('explicit overrides win over deterministic derivation', () => {
  const r = scoreViralPotential({ title: 'AI gaming breakthrough', category: 'AI', urgency: 0.13 })
  assert.equal(r.signals.urgency, 0.13, 'explicit urgency wins over derivation')
})

test('deterministic: same input => identical output', () => {
  const a = scoreViralPotential({ title: 'AI gaming breakthrough for esports', category: 'GAMING' })
  const b = scoreViralPotential({ title: 'AI gaming breakthrough for esports', category: 'GAMING' })
  assert.equal(a.total, b.total)
  assert.deepEqual(a.signals, b.signals)
})

test('threshold exports are consistent with verdict boundaries', () => {
  assert.ok(THRESHOLD_REJECT < THRESHOLD_REGENERATE)
  assert.ok(THRESHOLD_REGENERATE < THRESHOLD_PRIORITY)
  assert.ok(THRESHOLD_REJECT === 0.55)
  assert.ok(THRESHOLD_REGENERATE === 0.70)
  assert.ok(THRESHOLD_PRIORITY === 0.82)
})

test('TopicOpportunityEngine object exposes score + thresholds', () => {
  assert.equal(typeof TopicOpportunityEngine.score, 'function')
  assert.equal(TopicOpportunityEngine.THRESHOLD_PRIORITY, THRESHOLD_PRIORITY)
  assert.equal(typeof TopicOpportunityEngine.score({ title: 'x', category: 'AI' }).verdict, 'string')
})

test('integration — ProductionStrategyController attaches viralPotential to the plan', async () => {
  const ctrl = new ProductionStrategyController({ topicOpportunityEngine: scoreViralPotential })
  const plan = await ctrl.planProduction({
    title: 'AI gaming agent breakthrough for esports',
    description: 'x',
    category: 'AI',
  })
  assert.ok(plan.viralPotential, 'viralPotential attached by controller')
  assert.ok(typeof plan.viralPotential.total === 'number')
  assert.ok(['ACCEPT', 'PRIORITY', 'REGENERATE', 'REJECT'].includes(plan.viralPotential.verdict))
  assert.ok(Array.isArray(plan.viralPotential.reasons))
  // plan remains frozen (immutability contract preserved)
  assert.ok(Object.isFrozen(plan))
})

test('integration — controller without engine leaves viralPotential null', async () => {
  const ctrl = new ProductionStrategyController()
  const plan = await ctrl.planProduction({ title: 'x', category: 'AI' })
  assert.equal(plan.viralPotential, null)
})
