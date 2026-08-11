import { test } from 'node:test'
import assert from 'node:assert/strict'
import { retentionConfidence, RETENTION_CONFIDENCE_MAX, RETENTION_CONFIDENCE_SEED } from '../src/analytics/retentionConfidence.mjs'

// LEARN-001: retention confidence model. Tests the REAL shared implementation
// (RetentionPatternLearner imports it), not a mirrored copy of the formula —
// so a drift in the learner can never pass while the curve here diverges.

test('confidence with 1 observation ≈ 0.518', () => {
  assert.equal(retentionConfidence(1), 0.52)
  assert.ok(Math.abs(retentionConfidence(1) - 0.518) < 0.01)
})

test('confidence with 10 observations ≈ 0.634', () => {
  assert.equal(retentionConfidence(10), 0.63)
  assert.ok(Math.abs(retentionConfidence(10) - 0.634) < 0.01)
})

test('confidence with 100 observations ≈ 0.876', () => {
  assert.ok(Math.abs(retentionConfidence(100) - 0.876) < 0.01)
})

test('confidence asymptotes at 0.97', () => {
  assert.equal(retentionConfidence(100000), RETENTION_CONFIDENCE_MAX)
  assert.equal(RETENTION_CONFIDENCE_MAX, 0.97)
})

test('single observation does not grant high confidence', () => {
  assert.ok(retentionConfidence(1) < 0.6)
  assert.ok(retentionConfidence(1) > RETENTION_CONFIDENCE_SEED)
})

test('monotonic non-decreasing with observations', () => {
  let prev = 0
  for (let n = 0; n <= 200; n++) {
    const c = retentionConfidence(n)
    assert.ok(c >= prev, `confidence must not decrease at n=${n}`)
    prev = c
  }
})

test('zero / negative / invalid inputs map to the seed confidence', () => {
  assert.equal(retentionConfidence(0), RETENTION_CONFIDENCE_SEED)
  assert.equal(retentionConfidence(-5), RETENTION_CONFIDENCE_SEED)
  assert.equal(retentionConfidence(NaN), RETENTION_CONFIDENCE_SEED)
  assert.equal(retentionConfidence(undefined), RETENTION_CONFIDENCE_SEED)
})

test('learner import chain — RetentionPatternLearner uses the shared model', async () => {
  const mod = await import('../src/analytics/RetentionPatternLearner.mjs')
  assert.equal(typeof mod.RetentionPatternLearner, 'function', 'RetentionPatternLearner named export')
  const src = await import('node:fs').then(fs => fs.readFileSync(new URL('../src/analytics/RetentionPatternLearner.mjs', import.meta.url), 'utf8'))
  assert.ok(src.includes("retentionConfidence"), 'learner imports the shared confidence model')
  assert.ok(!src.includes('(0.5 + (0.47 * n / (n + 25)))'), 'no inline duplicate of the formula in the learner')
})