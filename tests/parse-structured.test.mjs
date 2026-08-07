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