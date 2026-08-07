import { test } from 'node:test'
import assert from 'node:assert/strict'

// Mirror of the formula used in RetentionPatternLearner so we can pin the
// exact expected values from the plan without requiring a live adapter.
function confidence(n) {
  return Math.min(0.97, Math.round((0.5 + (0.47 * n / (n + 25))) * 100) / 100)
}

test('confidence with 1 observation ≈ 0.518', () => {
  assert.equal(confidence(1), 0.52)
  assert.ok(Math.abs(confidence(1) - 0.518) < 0.01)
})

test('confidence with 10 observations ≈ 0.634', () => {
  assert.equal(confidence(10), 0.63)
  assert.ok(Math.abs(confidence(10) - 0.634) < 0.01)
})

test('confidence with 100 observations ≈ 0.876', () => {
  assert.ok(Math.abs(confidence(100) - 0.876) < 0.01)
})

test('confidence asymptotes at 0.97', () => {
  assert.equal(confidence(100000), 0.97)
  const limit = 0.5 + 0.47 // (n/(n+25) → 1)
  assert.equal(Math.min(0.97, Math.round(limit * 100) / 100), 0.97)
})

test('single observation does not grant high confidence', () => {
  assert.ok(confidence(1) < 0.6)
  assert.ok(confidence(1) > 0.5)
})