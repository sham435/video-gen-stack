/**
 * NARRATION-DEDUP gate tests.
 *
 * Covers the two new layers that stop a repeated narration line from ever
 * reaching the voice track:
 *   1. ScriptUniqueness statics — within-video duplicate detection
 *      (exact + near-dup at the scene-level 0.85 bar, NOT the full-script
 *      0.55 policy which false-positives on short segments).
 *   2. StoryDirector plan-time regeneration — one bounded LLM correction
 *      pass on duplicate scenePlan narration, falling back to the
 *      deterministic template when regeneration fails.
 *
 * The pre-TTS hard gate itself (index.mjs) is a thin call over
 * validateWithinVideo — covered here through the static + director layers
 * and exercised end-to-end by the full suite / composer render path.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { ScriptUniqueness, NARRATION_SCENE_SIMILARITY_MAX } from '../src/uniqueness/ScriptUniqueness.mjs'
import { StoryDirector } from '../src/ai/StoryDirector.mjs'

const outroText = 'Stay with NEWS-MONSTER. Unfiltered breaking news from the future.'

test('within-video: exact duplicate narration caught', () => {
  const res = ScriptUniqueness.findDuplicateSegments(['Same sentence twice.', 'Same sentence twice.', 'A different line.'])
  assert.equal(res.pass, false)
  assert.equal(res.duplicates.length, 1)
  assert.equal(res.duplicates[0].similarity, 1.0)
  assert.deepEqual([res.duplicates[0].a, res.duplicates[0].b], [0, 1])
})

test('within-video: near-duplicate at or above 0.85 caught', () => {
  // Same content, trivial tail difference → normalized tokens fully overlap
  const res = ScriptUniqueness.findDuplicateSegments([
    'Apple unveiled a new chip. The end.',
    'Apple unveiled a new chip.',
    outroText,
  ])
  assert.equal(res.pass, false)
  assert.ok(res.duplicates[0].similarity >= NARRATION_SCENE_SIMILARITY_MAX)
})

test('within-video: distinct scenes pass (below 0.85)', () => {
  // Shares subject tokens but materially different content → MUST pass
  const res = ScriptUniqueness.findDuplicateSegments([
    'Apple unveils a brand new chip for laptops.',
    'Apple faces a chip shortage this quarter.',
    outroText,
  ])
  assert.equal(res.pass, true)
})

test('within-video: same hook strategy across videos is NOT a within-video dup', () => {
  // The fallback hook "Nobody expected this move from BRAND." appears once
  // per video. Within-video check only flags repeated segments in the SAME
  // script — cross-video reuse is the composer registry's job.
  const res = ScriptUniqueness.findDuplicateSegments([
    'Nobody expected this move from APPLE.',
    'It started like any day for the tech.',
    outroText,
  ])
  assert.equal(res.pass, true)
})

test('validateWithinVideo: reason includes scene indices', () => {
  const res = ScriptUniqueness.validateWithinVideo(['Repeat line.', 'Repeat line.', outroText])
  assert.equal(res.pass, false)
  assert.match(res.reason, /NARRATION_DUPLICATE_WITHIN_VIDEO/)
  assert.match(res.reason, /1~2/)
})

test('validateWithinVideo: missing narration is not a false positive', () => {
  const res = ScriptUniqueness.validateWithinVideo(['', null, undefined, 'Only one real line.', outroText])
  assert.equal(res.pass, true)
})

test('threshold override respected', () => {
  const texts = ['One two three four five.', 'One two three four six.']
  // At the lenient full-script policy bar this flags; at the scene bar it passes
  const lenient = ScriptUniqueness.findDuplicateSegments(texts, { threshold: 0.55 })
  const strict = ScriptUniqueness.findDuplicateSegments(texts, { threshold: NARRATION_SCENE_SIMILARITY_MAX })
  assert.equal(lenient.pass, false)
  assert.equal(strict.pass, true)
})

test('StoryDirector: duplicate scenePlan narration is regenerated once', async () => {
  const dupPlan = {
    headline: 'Apple did it again',
    scenePlan: [
      { type: 'fact', duration: 5.5, narration: 'Apple unveiled its biggest chip yet today.' },
      { type: 'fact', duration: 5.5, narration: 'Apple unveiled its biggest chip yet today.' },
      { type: 'reveal', duration: 4.5, narration: 'The whole industry is paying attention now.' },
    ],
  }
  const fixedPlan = {
    headline: 'Apple did it again',
    scenePlan: [
      { type: 'fact', duration: 5.5, narration: 'Apple unveiled its biggest chip yet today.' },
      { type: 'fact', duration: 5.5, narration: 'The new silicon doubles last years performance.' },
      { type: 'reveal', duration: 4.5, narration: 'The whole industry is paying attention now.' },
    ],
  }
  let calls = 0
  const provider = {
    generate: async (messages) => {
      calls += 1
      return calls === 1 ? JSON.stringify(dupPlan) : JSON.stringify(fixedPlan)
    },
  }
  const director = new StoryDirector(provider)
  const story = await director.plan({ title: 'Apple', category: 'tech' })
  const texts = story.scenePlan.map(s => s.narration)
  const gate = ScriptUniqueness.validateWithinVideo(texts)
  assert.equal(gate.pass, true, `regenerated plan must have no duplicates: ${gate.reason || ''}`)
  assert.equal(calls, 2, 'exactly one bounded correction pass')
})

test('StoryDirector: falls back to deterministic template when regeneration fails', async () => {
  const dupPlan = {
    headline: 'Apple did it again',
    scenePlan: [
      { type: 'fact', duration: 5.5, narration: 'Apple unveiled its biggest chip yet today.' },
      { type: 'fact', duration: 5.5, narration: 'Apple unveiled its biggest chip yet today.' },
      { type: 'reveal', duration: 4.5, narration: 'The whole industry is paying attention now.' },
    ],
  }
  let calls = 0
  const provider = {
    generate: async (messages) => {
      calls += 1
      if (calls === 2) throw new Error('fix LLM down')
      return JSON.stringify(dupPlan)
    },
  }
  const director = new StoryDirector(provider)
  const story = await director.plan({ title: 'Apple', category: 'tech', description: 'A long enough article description with several sentences. The second sentence keeps the story moving. A third sentence rounds out the context.' })
  const gate = ScriptUniqueness.validateWithinVideo(story.scenePlan.map(s => s.narration))
  assert.equal(gate.pass, true, `fallback template must be structurally unique: ${gate.reason || ''}`)
})

test('StoryDirector: LLM failure skips regeneration (fallback flag)', async () => {
  const provider = {
    generate: async () => { throw new Error('LLM down') },
  }
  const director = new StoryDirector(provider)
  const story = await director.plan({ title: 'Apple', category: 'tech', description: 'A long enough article description with several sentences. The second sentence keeps the story moving. A third sentence rounds out the context.' })
  assert.equal(director._lastUsedFallback, true)
  const gate = ScriptUniqueness.validateWithinVideo(story.scenePlan.map(s => s.narration))
  assert.equal(gate.pass, true)
  assert.ok(story.scenePlan.length >= 7, 'fallback plan is a full 7-scene structure')
})

test('fallbackPlan is structurally unique by construction', () => {
  const director = new StoryDirector(null)
  const story = director.fallbackPlan({ title: 'OpenAI', category: 'ai', description: 'New model released today with huge performance gains. Developers are already testing it in production. The benchmarks look extraordinary.' })
  const gate = ScriptUniqueness.validateWithinVideo(story.scenePlan.map(s => s.narration))
  assert.equal(gate.pass, true, `fallback: ${gate.reason || 'ok'}`)
})