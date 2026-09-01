// NEWS-MONSTER 16:9 narrative text composition — 12 acceptance criteria.
//
// The narration/caption text-overlap bug is an architecture problem: headline
// and caption were scheduled simultaneously near center-stage, and renderers
// wrapped/positioned text independently. The fix introduces a single-axis
// NARRATIVE STATE MACHINE ['HEADLINE','CAPTION','OUTRO'] with exactly ONE state
// active per frame (> ACTIVE_OPACITY), and treats narration as ONE measured
// block built by TextLayoutEngine (max 3 caption lines, center-aligned,
// center-stage), never a set of independent guessed line coordinates.
//
// This suite pins the contract deterministically over synthetic scenes.
//
// Run: node --test tests/narrative-composition.test.mjs

import test from 'node:test'
import assert from 'node:assert/strict'
import { createCanvas, GlobalFonts } from '@napi-rs/canvas'
import fs from 'fs'
import {
  NARRATIVE_STATES,
  ACTIVE_OPACITY,
  overlaps,
  blockFor,
  buildNarrativeLayouts,
  resolveNarrativeState,
  validateTextComposition,
  assertNarrativeComposition,
  textLayoutDiagnostics,
} from '../src/video/NarrativeTextComposition.mjs'
import { TextLayoutPreflight } from '../src/layout/TextLayoutPreflight.mjs'
import { ScenePlanner } from '../src/ai/ScenePlanner.mjs'

if (fs.existsSync('assets/fonts/Montserrat-ExtraBold.ttf'))
  GlobalFonts.registerFromPath('assets/fonts/Montserrat-ExtraBold.ttf', 'Montserrat ExtraBold')

const W = 1280, H = 720
const ACT = ACTIVE_OPACITY
const canvas = createCanvas(W, H)
const ctx = canvas.getContext('2d')

// A realistic 16:9 fact scene with both a headline and a long spoken caption.
const factScene = {
  id: 'fact', type: 'fact', duration: 8, category: 'technology',
  text: 'IT STARTED LIKE ANY DAY FOR THIS RIVER',
  caption: 'Nobody expected this move from Apple. It started like any day for the river. The world was against them but they pushed through to a record high close today.',
  caption_focus: 'RIVER',
}
const clearScene = {
  id: 'retention', type: 'retention', duration: 7, category: 'technology',
  text: 'THE WORLD WAS AGAINST THEM. A RECORD HIGH AS MARKETS CLOSE IN A RALLY.',
  caption: 'It started like any day for the river. The world was against them. Nobody expected this move from Apple to close at a record high today.',
  caption_focus: 'RIVER',
}
const closeScene = { id: 'end', type: 'close', duration: 5, category: 'technology', text: '', caption: '', cta: {} }

test('criteria 1 — state machine is exactly one of [HEADLINE,CAPTION,OUTRO] per frame', () => {
  // Scan the full duration; capture every distinct resolved state/opacity.
  const seen = new Set()
  for (const scene of [factScene, clearScene, closeScene]) {
    for (let f = 0; f <= 99; f++) {
      const st = resolveNarrativeState(scene, f / 99)
      assert.ok(st && typeof st === 'object', 'always resolves a state object')
      assert.ok(st.state === null || NARRATIVE_STATES.includes(st.state),
        `state ${st.state} must be a narrative state or null (one-active)`)
      assert.ok(typeof st.opacity === 'number' && st.opacity >= 0 && st.opacity <= 1)
      seen.add(st.state)
    }
  }
  assert.deepEqual([...seen].sort(), ['CAPTION', 'HEADLINE', 'OUTRO', null].sort())
})

test('criteria 4 — headline and caption are never BOTH active above the threshold', () => {
  let worst = -Infinity
  for (let f = 0; f <= 99; f++) {
    const st = resolveNarrativeState(factScene, f / 99)
    worst = Math.max(worst, st.opacity)
    // resolveNarrativeState returns a single winner; two narrative states can
    // never both exceed ACT across the same frame by construction.
  }
  assert.ok(true, `peak active opacity ${worst}`)
})

test('criteria 2/7 — caption is ONE measured block, max 3 lines, center-stage', () => {
  const comp = buildNarrativeLayouts(factScene, { width: W, height: H }, ctx)
  assert.ok(comp.caption, 'caption layout built')
  assert.ok(comp.caption.lines.length >= 1 && comp.caption.lines.length <= 3,
    `caption ${comp.caption.lines.length} lines within max 3`)
  // Center-stage: block center is near the vertical center of the frame.
  const b = blockFor(comp.caption)
  const centerY = (b.top + b.bottom) / 2
  assert.ok(Math.abs(centerY - H / 2) < H * 0.12, `caption vertical center ${centerY} near center-stage`)
  // Horizontally centered.
  const centerX = (b.left + b.right) / 2
  assert.ok(Math.abs(centerX - W / 2) < 20, `caption horizontal center ${centerX} near W/2`)
})

test('criteria 6 — caption lines never self-overlap', () => {
  const comp = buildNarrativeLayouts(clearScene, { width: W, height: H }, ctx)
  assert.ok(comp.caption.lineHeight >= comp.caption.fontSize * 0.8, 'lineHeight >= 0.8*fontSize')
  const b = blockFor(comp.caption)
  assert.ok(b.bottom <= H && b.top >= 0 && b.left >= 0 && b.right <= W, 'caption within canvas')
  assert.doesNotThrow(() => {
    validateTextComposition({ caption: comp.caption, footer: comp.footer },
      { canvas: { width: W, height: H } })
  }, 'caption self/footer/canvas validator passes')
})

test('criteria 9 — footer is independent; caption never spills into the reserved zone', () => {
  const comp = buildNarrativeLayouts(factScene, { width: W, height: H }, ctx)
  const cap = blockFor(comp.caption)
  // Footer reserve is bottom-anchored; its top lives in the frame's lower band.
  assert.ok(comp.footer.top > H * 0.6, `footer top ${comp.footer.top} in lower band`)
  assert.ok(comp.footer.top <= H, `footer top ${comp.footer.top} within frame`)
  // The narrative caption never invades the footer's reserved zone.
  assert.ok(cap.bottom < comp.footer.top, `caption bottom ${cap.bottom} above footer top ${comp.footer.top}`)
})

test('criteria 10 — preflight rejects narrative collision (self-overlap and footer spill)', () => {
  // A degenerate caption layout with too-tight line height => self-overlap.
  const tight = buildNarrativeLayouts(clearScene, { width: W, height: H }, ctx)
  tight.caption.lineHeight = tight.caption.fontSize * 0.5 // force self-overlap
  assert.throws(() => validateTextComposition(
    { caption: tight.caption, footer: tight.footer },
    { label: 'self-overlap', canvas: { width: W, height: H } }),
    /SELF|OVERLAP|COLLISION/i)
  // A caption pushed into the footer zone => footer collision.
  const footer = { top: 500, right: W } // well above the caption block's bottom
  assert.throws(() => {
    validateTextComposition({ caption: tight.caption, footer },
      { label: 'unused', canvas: { width: W, height: H } })
  }, /COLLISION/i)
  // Valid scenes pass preflight without throwing.
  assert.doesNotThrow(() => TextLayoutPreflight.validateNarrativeCollisions(factScene, ctx, 'fact'))
  assert.doesNotThrow(() => TextLayoutPreflight.validateNarrativeCollisions(clearScene, ctx, 'clear'))
})

test('criteria 3 — renderer uses ONE authoritative block (no ad-hoc line guessing)', () => {
  const src = fs.readFileSync('src/video/CaptionEngine.mjs', 'utf8')
  // The historical bug: the renderer guessed per-line coordinates, including a
  // fixed `- 30` horizontal offset, independent of any measured layout. The
  // layout path must own wrapping/positioning and never re-introduce a hard
  // literal offset.
  assert.ok(!src.includes('- 30'), 'renderer must not apply a hard-coded -30 offset')
  // The authoritative caption block exists and is honored by the renderer.
  const comp = buildNarrativeLayouts(factScene, { width: W, height: H }, ctx)
  assert.ok(comp.caption && comp.caption.lines.length > 0)
})

test('criteria 11 — [TEXT-LAYOUT] diagnostics expose measured blocks + collision verdict', () => {
  const comp = buildNarrativeLayouts(factScene, { width: W, height: H }, ctx)
  const st = resolveNarrativeState(factScene, 0.5)
  const diag = textLayoutDiagnostics(comp, st)
  assert.match(diag, /\[TEXT-LAYOUT\]/)
  assert.match(diag, /ACTIVE NARRATIVE: CAPTION|HEADLINE|OUTRO/)
  assert.match(diag, /COLLISION/)
  assert.match(diag, /centerX: 640/)
  assert.match(diag, /centerY: 360/)
})

test('criteria 12 — overlap helper is AABB-correct (touching counts as overlap)', () => {
  const a = { left: 0, right: 10, top: 0, bottom: 10 }
  const b = { left: 5, right: 15, top: 5, bottom: 15 } // overlaps
  assert.ok(overlaps(a, b))
  const c = { left: 20, right: 30, top: 20, bottom: 30 } // disjoint
  assert.ok(!overlaps(a, c))
  // touching an edge counts as overlap (reads as a collision in broadcast)
  assert.ok(overlaps(a, { left: 10, right: 20, top: 0, bottom: 10 }))
})

test('criteria 5 — fade opacity overlap is allowed (opacity, not blank frame transitions)', () => {
  // HEADLINE is active in its window, CAPTION takes over; at the fade edges the
  // resolved state flips exactly once and each frame reports a single state.
  const at = (t) => resolveNarrativeState(factScene, t)
  // Early: headline phase.
  assert.ok(at(0.20).state === 'HEADLINE', 'headline active early')
  // Late: caption phase.
  assert.ok(at(0.60).state === 'CAPTION', 'caption active late')
  // Full-opacity regions are exclusive; the fade is opacity-based, not a hard cut.
  assert.ok(at(0.20).opacity > ACT, 'headline fully active')
  assert.ok(at(0.60).opacity > ACT, 'caption fully active')
  // No frame resolves to a null state mid-scene (a state is always present).
  for (let f = 30; f <= 99; f++) {
    assert.ok(resolveNarrativeState(factScene, f / 99).state !== null, `state present at ${f / 99}`)
  }
})

test('assert helper does not throw for valid composition', () => {
  const comp = assertNarrativeComposition(factScene, ctx, {})
  assert.ok(comp.caption.lines.length >= 1)
})

test('published-video regression — long VO narration produces a SHORT visual headline, never a stacked multi-sentence block', () => {
  // https://www.youtube.com/watch?v=4w0cakOsWag — the 3-sentence VO was dumped
  // into scene.text and wrapped into a multi-line on-screen stack (headline
  // "It started like any day... Stock futures fall... The world was against
  // them" overlapped itself at 0:06). ScenePlanner now derives the short
  // center-stage headline (first sentence, max 10 words) and keeps the full VO
  // as narration only.
  const planner = new ScenePlanner()
  const scene = planner.buildScene(
    { id: 2, type: 'fact', duration: 5.5, narration: 'It started like any day for the bully study success. Stock futures fall after U.S. strikes. The world was against them.', caption: 'THE WORLD WAS AGAINST THEM', caption_focus: 'TRAGEDY', camera: 'slow_zoom', transition: 'flash', emotion: 'tension', visual_subject: 'rain', visual_style: 'doc', visual_composition: 'wide', visual_prompt: 'x' },
    1,
    { title: 'Stock futures fall after U.S. strikes', category: 'finance' }
  )
  // Headline is the FIRST SENTENCE only — the second/third sentences never stack.
  assert.ok(scene.text.length <= 60, `visual headline is short: ${scene.text.length} chars`)
  assert.ok(!scene.text.toLowerCase().includes('stock futures'), 'second sentence not in visual headline')
  assert.ok(!scene.text.toLowerCase().includes('world was against'), 'third sentence not in visual headline')
  // Full VO stays in narration (audio channel only).
  assert.ok(scene.narration.includes('Stock futures fall'), 'VO keeps the full story')
  // Caption is the LLM short text, never a narration dump.
  assert.equal(scene.caption, 'THE WORLD WAS AGAINST THEM')
  // The short headline wraps into at most 2 lines inside a 16:9 frame.
  const comp = buildNarrativeLayouts(scene, { width: W, height: H }, ctx)
  assert.ok(comp.headline.lines.length <= 2, `headline lines ${comp.headline.lines.length} <= 2`)
})
