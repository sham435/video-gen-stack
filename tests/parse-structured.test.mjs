import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseStructured, extractJson, validateSchema, StructuredParseError } from '../src/ai/parseStructured.mjs'

test('parses clean JSON with a valid schema', async () => {
  const result = await parseStructured('{"title":"Foo","scenes":[{"duration":5}]}', {
    schema: { title: 'string', 'scenes[]': 'object', 'scenes[].duration': 'number' },
  })
  assert.equal(result.title, 'Foo')
  assert.equal(result.scenes[0].duration, 5)
})

test('extracts JSON from markdown code fences', async () => {
  const raw = 'Here you go:\n```json\n{"title":"X"}\n```\nHope that helps!'
  const result = await parseStructured(raw, { schema: { title: 'string' } })
  assert.equal(result.title, 'X')
})

test('retries once with a correction request on schema mismatch', async () => {
  let generateCalls = 0
  const result = await parseStructured('{"title": 123}', {
    schema: { title: 'string' },
    attempts: 1,
    generate: async (prompt) => {
      generateCalls++
      assert.match(prompt, /title/i)
      return '{"title":"Fixed"}'
    },
    correct: (detail) => `You made a mistake: ${detail.errors?.join('; ')}. Fix it.`,
  })
  assert.equal(result.title, 'Fixed')
  assert.equal(generateCalls, 1)
})

test('throws after retry when output stays invalid', async () => {
  await assert.rejects(
    parseStructured('{"title": 123}', {
      schema: { title: 'string' },
      attempts: 1,
      generate: async () => '{"title": false}',
      correct: () => 'fix it',
    }),
    (err) => err instanceof StructuredParseError && /Schema mismatch/.test(err.message)
  )
})

test('throws on invalid JSON', async () => {
  await assert.rejects(
    parseStructured('not json at all', { schema: { title: 'string' } }),
    (err) => err instanceof StructuredParseError && /Invalid JSON/.test(err.message)
  )
})

test('never returns a raw string for malformed content', async () => {
  await assert.rejects(
    parseStructured('just some text', { schema: { title: 'string' }, attempts: 0 }),
    StructuredParseError
  )
})

test('validateSchema reports typed mismatches', () => {
  const errors = validateSchema({ title: 'ok', scenes: [{}] }, {
    title: 'string',
    'scenes[].duration': 'number',
  })
  assert.ok(errors.some((e) => e.includes('scenes[0].duration')))
})

// JSON-001: wiring — StoryDirector/StoryPlanner route LLM JSON through
// parseStructured so fenced/malformed/truncated output retries once and never
// silently reaches validate() as a raw string.

import { StoryDirector } from '../src/ai/StoryDirector.mjs'
import { StoryPlanner } from '../src/ai/StoryPlanner.mjs'

function directorWith(rawSequence) {
  let i = 0
  const provider = {
    name: 'Stub',
    supportedFeatures: ['chat', 'json-mode'],
    generate: async () => rawSequence[Math.min(i++, rawSequence.length - 1)],
  }
  return new StoryDirector(provider)
}

test('StoryDirector — accepts markdown-fenced JSON through the structured gate', async () => {
  const d = directorWith(['```json\n{"headline":"H","scenePlan":[{"type":"fact","duration":4}]}\n```'])
  const story = await d.queryLLM([{ role: 'user', content: 'go' }], { title: 'T' })
  assert.equal(story.headline, 'H')
  assert.equal(story.scenePlan.length, 1)
})

test('StoryDirector — malformed JSON retries once with correction, then falls back', async () => {
  // First response: wrong-typed headline (number). Second: valid.
  let calls = 0
  const provider = {
    name: 'Stub',
    supportedFeatures: ['chat', 'json-mode'],
    generate: async () => {
      calls++
      if (calls === 1) return '{"headline":123,"scenePlan":[]}'
      return '{"headline":"Fixed","scenePlan":[{"type":"fact","duration":4}]}'
    },
  }
  const d = new StoryDirector(provider)
  const story = await d.queryLLM([{ role: 'user', content: 'go' }], { title: 'T' })
  assert.equal(story.headline, 'Fixed')
  assert.equal(calls, 2, 'correction retry fired once')
})

test('StoryDirector — only valid parsed/validated structure is returned (no raw string)', async () => {
  const d = directorWith(['just prose, no json', 'also not json'])
  const story = await d.queryLLM([{ role: 'user', content: 'go' }], { title: 'T' })
  // Fails twice → parseStructured throws → queryLLM falls back to fallbackPlan.
  assert.ok(Array.isArray(story.scenePlan) && story.scenePlan.length >= 2, 'fell back to a valid plan')
})

test('StoryPlanner — validates a minimal plan via the structured gate', async () => {
  const provider = {
    name: 'Stub',
    supportedFeatures: ['chat', 'json-mode'],
    generate: async () => '{"headline":"H","scenes":[{"type":"hook","duration":3}]}',
  }
  const p = new StoryPlanner(provider)
  const plan = await p.queryLLM([{ role: 'user', content: 'go' }], { title: 'T' })
  assert.equal(plan.headline, 'H')
  assert.equal(plan.scenes.length, 1)
})