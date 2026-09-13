import { test } from 'node:test'
import assert from 'node:assert/strict'
import { StoryDirector } from '../src/ai/StoryDirector.mjs'
import { ScriptUniqueness } from '../src/uniqueness/ScriptUniqueness.mjs'

// Fix D regression: _connectiveNewsLine only had 4 templates with idx % 4.
// A title-only article (zero usable description sentences) yields 1 fact →
// 5 connector slots → idx 1,2,3,4,5 → c1,c2,c3,c0,c1: the c1 line repeats,
// tripping the pre-TTS within-video narration gate (≥0.85 similarity) and
// hard-failing the render exactly when all LLM providers are down. The six
// distinct templates mean the degraded fallback always passes the gate.

function fallbackDirector() {
  // null provider → every path falls back to the deterministic plan.
  return new StoryDirector(null, {})
}

function narrationLines(plan) {
  return plan.scenePlan.slice(0, 6).map((s) => s.narration)
}

test('fallback plan: title-only article emits SIX distinct narration lines', () => {
  const plan = fallbackDirector().fallbackPlan({
    title: 'OpenAI unveils new flagship AI video model',
    source: 'Tech News',
    category: 'technology',
  })
  const lines = narrationLines(plan)
  assert.equal(new Set(lines).size, 6, 'narration lines must all be distinct')
})

test('fallback plan: title-only article passes the within-video narration gate', () => {
  const plan = fallbackDirector().fallbackPlan({
    title: 'OpenAI unveils new flagship AI video model',
    source: 'Tech News',
    category: 'technology',
  })
  const verdict = ScriptUniqueness.validateWithinVideo(narrationLines(plan))
  assert.equal(verdict.pass, true, verdict.reason || '')
})

test('fallback plan: news-first — scene 1 narration IS the article title', () => {
  const plan = fallbackDirector().fallbackPlan({
    title: 'OpenAI unveils new flagship AI video model',
    source: 'Tech News',
    category: 'technology',
  })
  assert.equal(plan.scenePlan[0].narration, 'OpenAI unveils new flagship AI video model')
})

test('fallback plan: rich article (3 facts) keeps 6 distinct lines too', () => {
  const plan = fallbackDirector().fallbackPlan({
    title: 'Tesla opens first European mega-factory',
    description: 'The plant will build 500,000 cars a year. Local officials approved the permit last week. Battery production starts in March.',
    source: 'Reuters',
    category: 'business',
  })
  const lines = narrationLines(plan)
  assert.equal(new Set(lines).size, 6)
  assert.equal(ScriptUniqueness.validateWithinVideo(lines).pass, true)
})