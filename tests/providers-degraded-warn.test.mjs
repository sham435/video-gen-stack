import { test } from 'node:test'
import assert from 'node:assert/strict'
import { warnDegradedModeOnce } from '../src/ai/providers/resolveProviders.mjs'

// Optimization item 1 regression: provider empty-array/build failure used to
// be fully silent — StoryDirector + CreativeDirectorAgent fell back to
// deterministic output with no log. warnDegradedModeOnce must surface the
// degraded session in production logs exactly ONCE per process (no spam when
// many engines are constructed during test runs).

test('degraded mode warn is emitted exactly once per process', () => {
  const calls = []
  const original = console.warn
  console.warn = (...args) => calls.push(args)
  try {
    warnDegradedModeOnce('no keys configured')
    warnDegradedModeOnce('chain build failed')
    warnDegradedModeOnce('still degraded')
  } finally {
    console.warn = original
  }
  assert.equal(calls.length, 1)
  // The single warning names the degraded mode and carries the first reason.
  assert.match(String(calls[0][0]), /deterministic fallback/i)
  assert.match(String(calls[0][0]), /no keys configured/)
})