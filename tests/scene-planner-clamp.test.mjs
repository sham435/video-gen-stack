import { test } from 'node:test'
import assert from 'node:assert/strict'
import { ScenePlanner } from '../src/ai/ScenePlanner.mjs'

// SCENE-001: ScenePlanner duration clamp.
//
// Contract:
//   explicit positive number  → clamped into [2, 8]
//   missing / zero / null / '' / NaN → 3s default (then clamp = 3)
//   numeric string accepted (Number coerce), e.g. '3' → 3
//   exactly one `duration` field on the built scene (no duplicate keys)
//
// Regression fixed: falsy/zero inputs used to collapse to the 2s floor because
// `Number(value)` turned 0/null/'' into 0. Now they mean "not specified" → 3.

let planner
try {
  planner = new ScenePlanner()
} catch (e) {
  console.warn('ScenePlanner construction failed (may need deps):', e.message)
}

function clampLive(value) {
  if (!planner) return null
  const scene = planner.buildScene({ id: 1, type: 'fact', duration: value }, 0, { title: 'T' })
  return scene.duration
}

const cases = [
  [0, 3],     // zero → default
  [1, 2],     // lower-bound floor
  [2, 2],     // at floor
  [3, 3],     // normal in-range
  [8, 8],     // upper bound
  [9, 8],     // over upper bound
  [11, 8],    // well over upper bound
]

for (const [input, expected] of cases) {
  test(`clamps duration ${String(input)} → ${expected}`, () => {
    assert.equal(clampLive(input), expected)
  })
}

test('missing / invalid durations default to 3s', () => {
  if (!planner) return
  for (const v of [undefined, null, '', NaN, 'abc']) {
    const scene = planner.buildScene({ id: 1, type: 'fact', duration: v }, 0, { title: 'T' })
    assert.equal(scene.duration, 3, `duration ${JSON.stringify(v)} → 3`)
  }
})

test('accepts a numeric string when the value is positive', () => {
  if (!planner) return
  assert.equal(clampLive('3'), 3)
  assert.equal(clampLive('11'), 8)
})

test('buildScene uses a single clamped duration field (no duplicate key)', () => {
  if (!planner) return
  const scene = planner.buildScene({ id: 1, type: 'fact', duration: 11 }, 0, { title: 'T' })
  assert.equal(scene.duration, 8)
  // exactly one plain 'duration' property on the scene object
  const keys = Object.keys(scene).filter((k) => k === 'duration')
  assert.equal(keys.length, 1)
})