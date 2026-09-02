// tests/cinematic-refinement.test.mjs
//
// Targeted tests for the cinematic caption & timing refinement spec:
//   1. "No silent scenes" ContractValidator gate (new assertion).
//   2. Word-stagger hold smoke test (graphical — verifies assemble + tail hold).
//   3. Tagline swap verification.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { ContractValidator } from '../src/video-studio/ContractValidator.mjs'

const cv = new ContractValidator()

function makeContract(scenes) {
  return {
    story: { headline: 'Test Headline', hook: 'Test hook for the scene' },
    cover: { headline: 'Test Cover Headline' },
    scenes,
    voice: { speed: 1.0 },
    retention: { pattern: 'hook' },
  }
}

// ─── 1. "No silent scenes" ContractValidator gate ───────────────────────────

test('no-silent-scenes: narration with no on-screen text -> error', () => {
  const contract = makeContract([
    { id: 1, duration: 5, narration: 'A spoken sentence here', visual_prompt: 'x', camera: 'push_in', emotion: 'neutral' },
    { id: 2, duration: 5, narration: 'Second scene narration', text: 'SECOND HEADLINE', visual_prompt: 'x', camera: 'push_in', emotion: 'neutral' },
  ])
  const result = cv.validate(contract)
  assert.ok(
    result.errors.some(e => e.includes('silent scene')),
    `expected silent-scene error; got: ${result.errors.join('; ')}`
  )
})

test('no-silent-scenes: narration + text -> ok', () => {
  const contract = makeContract([
    { id: 1, duration: 5, narration: 'Spoken sentence', text: 'HEADLINE', visual_prompt: 'x', camera: 'push_in', emotion: 'neutral' },
    { id: 2, duration: 5, narration: 'Second narration', text: 'SECOND', visual_prompt: 'x', camera: 'push_in', emotion: 'neutral' },
  ])
  const result = cv.validate(contract)
  assert.ok(
    !result.errors.some(e => e.includes('silent scene')),
    `unexpected silent-scene error: ${result.errors.join('; ')}`
  )
})

test('no-silent-scenes: narration + caption -> ok', () => {
  const contract = makeContract([
    { id: 1, duration: 5, narration: 'Spoken', caption: 'Caption text', visual_prompt: 'x', camera: 'push_in', emotion: 'neutral' },
    { id: 2, duration: 5, narration: 'Second', text: 'OK', visual_prompt: 'x', camera: 'push_in', emotion: 'neutral' },
  ])
  const result = cv.validate(contract)
  assert.ok(
    !result.errors.some(e => e.includes('silent scene')),
    `unexpected silent-scene error: ${result.errors.join('; ')}`
  )
})

test('no-silent-scenes: narration + callout -> ok', () => {
  const contract = makeContract([
    { id: 1, duration: 5, narration: 'Spoken', callout: 'KEY INSIGHT', visual_prompt: 'x', camera: 'push_in', emotion: 'neutral' },
    { id: 2, duration: 5, narration: 'Second', text: 'OK', visual_prompt: 'x', camera: 'push_in', emotion: 'neutral' },
  ])
  const result = cv.validate(contract)
  assert.ok(
    !result.errors.some(e => e.includes('silent scene')),
    `unexpected silent-scene error: ${result.errors.join('; ')}`
  )
})

test('no-silent-scenes: empty narration -> gate not triggered (narration check catches it)', () => {
  const contract = makeContract([
    { id: 1, duration: 5, narration: '', visual_prompt: 'x', camera: 'push_in', emotion: 'neutral' },
    { id: 2, duration: 5, narration: 'OK', text: 'SECOND', visual_prompt: 'x', camera: 'push_in', emotion: 'neutral' },
  ])
  const result = cv.validate(contract)
  // The narration field is required and empty — the SCENE_REQUIRED gate flags it,
  // but the silent-scenes gate does NOT fire (hasNarration is false for '').
  assert.ok(
    result.errors.some(e => e.includes('narration missing')),
    `expected narration-missing error; got: ${result.errors.join('; ')}`
  )
  assert.ok(
    !result.errors.some(e => e.includes('silent scene')),
    'silent-scene gate should not fire when narration is empty'
  )
})

// ─── 2. Tagline swap verification ────────────────────────────────────────────

test('tagline reads UNFILTERED NEWS FROM THE FUTURE (not UNFILTERED BREAKING)', async () => {
  const brandMod = await import('../src/publishing/BrandOutro.mjs')
  assert.equal(
    brandMod.BRAND_OUTRO.tagline,
    'UNFILTERED NEWS FROM THE FUTURE',
    'BrandOutro tagline should be updated'
  )
  assert.ok(
    !brandMod.BRAND_OUTRO.tagline.includes('BREAKING'),
    'tagline should not contain BREAKING'
  )
})
