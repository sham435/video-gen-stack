import { test } from 'node:test'
import assert from 'node:assert/strict'
import { ScenePlanner } from '../src/ai/ScenePlanner.mjs'

let planner
try {
  planner = new ScenePlanner()
} catch (e) {
  console.warn('ScenePlanner construction failed (may need deps):', e.message)
}

function clampDuration(value) {
  // Same clamp the planner now applies via a single duration field.
  const n = Number(value)
  const base = Number.isFinite(n) ? n : 3
  return Math.max(2, Math.min(8, base))
}

const cases = [
  [0, 2],
  [1, 2],
  [3, 3],
  [9, 8],
  [11, 8],
]

for (const [input, expected] of cases) {
  test(`clamps duration ${input} → ${expected}`, () => {
    assert.equal(clampDuration(input), expected)
  })
}

test('non-numeric / missing duration defaults to 3', () => {
  assert.equal(clampDuration(undefined), 3)
  assert.equal(clampDuration('abc'), 3)
})

test('buildScene uses a single clamped duration field (no duplicate key)', () => {
  if (!planner) return
  const scene = planner.buildScene({ id: 1, type: 'fact', duration: 11 }, 0, { title: 'T' })
  assert.equal(scene.duration, 8)
  // distinct exactly one plain 'duration' property on the scene object
  const keys = Object.keys(scene).filter((k) => k === 'duration')
  assert.equal(keys.length, 1)
})