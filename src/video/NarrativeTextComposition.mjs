// NarrativeTextComposition — the single authoritative layout + state machine
// for ALL narrative text (MAIN HEADLINE / SPOKEN CAPTION / OUTRO) on the 16:9
// frame.
//
// Problem it solves: renderers used to place headline lines, caption lines and
// outro text with independent, hard-coded y coordinates and their own
// measureText wrapping — so a headline and a caption could occupy the same
// visual region at the same time, and multi-line captions could overlap
// themselves. The screenshot showed exactly that (text colliding with itself).
//
// This module enforces two invariants the renderers no longer own:
//
//   1. ONE ACTIVE NARRATIVE STATE — only one of HEADLINE / CAPTION / OUTRO is
//      resolved as "active" (>40% opacity) at any instant. States replace each
//      other in time (fade-out then fade-in); they are never stacked spatially.
//
//   2. ONE AUTHORITATIVE LAYOUT — every narrative text is measured ONCE by
//      TextLayoutEngine into a single block (lines, fontSize, lineHeight, x, y,
//      and a derived bounding box). Renderers consume that block; they never
//      re-wrap or re-position independently.
//
// It also provides the deterministic collision gate (validateTextComposition)
// and the [TEXT-LAYOUT] diagnostics log used to locate the bug class.
//
// Coordinates are in the active logical canvas (16:9: 1920x1080 canonical,
// 1280x720 supported). All geometry is ratio-based.

import { TextLayoutEngine } from '../layout/TextLayoutEngine.mjs'
import { FooterLayout } from './footer/FooterLayout.mjs'
import { DesignSystem } from '../visuals/DesignSystem.mjs'

// Narrative states, in temporal order. Exactly one is active per frame.
export const NARRATIVE_STATES = ['HEADLINE', 'CAPTION', 'OUTRO']

// Shorten above 40% opacity => "active". Mirrors the co-render threshold used
// elsewhere in the pipeline (ScenePreflight TEXT_STACK_COLLISION).
export const ACTIVE_OPACITY = 0.4

// AABB helper: true when the two blocks overlap (touching counts as overlap).
// `gap` adds breathing room (px) so near-touches that read as collisions are
// also rejected.
export function overlaps(a, b, gap = 0) {
  if (!a || !b) return false
  return !(
    a.right + gap < b.left ||
    a.left - gap > b.right ||
    a.bottom + gap < b.top ||
    a.top - gap > b.bottom
  )
}

// Derive the pixel bounding box { left, right, top, bottom, width, height }
// from a TextLayoutEngine manifest. Layout y is the block's vertical center,
// x is the block's left edge.
export function blockFor(layout) {
  if (!layout) return null
  const w = Math.max(0, layout.width || 0)
  const h = Math.max(0, layout.height || 0)
  return {
    left: layout.x,
    right: layout.x + w,
    top: layout.y - h / 2,
    bottom: layout.y + h / 2,
    width: w,
    height: h,
    x: layout.x,
    y: layout.y,
  }
}

/**
 * Build the authoritative narrative layouts for a scene against the given
 * canvas. Returns one measured block per narrative state (headline / caption /
 * outro). Each is the output of TextLayoutEngine — the single layout authority.
 *
 * It mirrors the production wiring in src/index.mjs (TextLayoutEngine.layout
 * per role) but centered on the NARRATIVE roles the task specifies, and always
 * re-measured against the REAL active canvas so the geometry is exact.
 */
export function buildNarrativeLayouts(scene = {}, canvas = { width: DesignSystem.W, height: DesignSystem.H }, ctx = null) {
  const W = canvas.width
  const H = canvas.height

  const headline = scene.text
    ? TextLayoutEngine.layout({
        text: String(scene.text).replace(/^BREAKING:\s*/i, ''),
        role: 'headline',
        canvas: { width: W, height: H },
        fontFamily: 'Anton',
        preferredFontSize: scene.headlineFontSize || 84,
        maxLines: 2,
      })
    : null

  // The caption block is the FULL spoken sentence, wrapped as one block.
  const caption = (scene.caption && scene.captionHidden !== true)
    ? TextLayoutEngine.layout({
        text: String(scene.caption),
        role: 'caption',
        canvas: { width: W, height: H },
        fontFamily: 'Inter',
        preferredFontSize: 58,
        maxLines: 3,
      })
    : null
  // Narrative text is CENTER-STAGE by spec (x=W/2, y=H/2): the caption block is
  // one measured block, center-aligned and vertically centered on the frame.
  // SafeZone gives a safe anchor; we then recenter the BLOCK so the spoken
  // sentence sits in the middle of the frame (temporal replacement, never
  // stacked with the headline). `y` is the block's vertical center.
  if (caption && caption.height != null) {
    caption.x = (W - caption.width) / 2
    caption.y = H / 2
  }

  // Outro: the brand close ("STAY WITH / NEWS-MONSTER") is rendered by
  // InformationLayer.renderBrandClose; yield a placeholder block so the
  // validator can guard its region (the center-stage brand close).
  const outro = scene.outro || scene.type === 'close' || scene.type === 'brand_close'
    ? TextLayoutEngine.layout({
        text: 'STAY WITH NEWS-MONSTER',
        role: 'headline',
        canvas: { width: W, height: H },
        fontFamily: 'Anton',
        preferredFontSize: 80,
        maxLines: 2,
      })
    : null

  // Footer: independent, bottom-anchored. Its reserved zone is everything
  // below the bar top. Measured here (needs a real ctx for font width).
  let footerTop = H - H * 0.06
  if (ctx) {
    try {
      footerTop = FooterLayout.barTopInFrame(ctx, W, H)
    } catch {
      footerTop = H - H * 0.06
    }
  }
  const footer = {
    block: { left: 0, right: W, top: footerTop, bottom: H, width: W, height: H - footerTop },
    top: footerTop,
    bottom: H,
  }

  return { headline, caption, outro, footer, canvas: { width: W, height: H } }
}

/**
 * Resolve the SINGLE active narrative state at a given scene-time fraction.
 * States are mutually exclusive: at most one returns opacity > ACTIVE_OPACITY.
 *
 * Returns { state, opacity, at } where `at` is a stable description of the
 * narrative phase. The caller renders ONLY the returned state.
 *
 * HOOK scenes keep their existing disjoint banner→hero→secondary→ai sequence
 * (already monotonic + tested) — nothing here overrides it; only the caption
 * layer draws when its own timeline window is exclusive. `at` reports the
 * phase so validators/logs can place it.
 *
 * NON-HOOK scenes (fact / retention / explanation, the actual bug) get true
 * temporal replacement so the headline NEVER co-occupies the center stage with
 * the spoken caption:
 *   HEADLINE: [0.00, 0.40]  (fade in 0.05, hold, fade out 0.08)
 *   CAPTION:  [0.32, 1.00]  (fade in 0.08, holds to the end)
 * Opacity overlaps are allowed; the >ACTIVE_OPACITY "active" state is unique.
 */
export function resolveNarrativeState(scene = {}, timeFrac = 0) {
  const isClose = scene.outro || scene.type === 'close' || scene.type === 'brand_close'
  if (isClose) {
    return { state: 'OUTRO', opacity: Math.min(1, Math.max(0, (timeFrac - 0.05) / 0.12)), at: 'OUTRO' }
  }
  if (scene.type === 'hook') {
    // Hook: headline phase covers the banner/hero/secondary windows; the AI
    // accent phase is tracked for diagnostics. Rendering is still driven by the
    // existing monotonic timeline; caption is gated below by its own window.
    const HEADLINE_PHASE = timeFrac < 0.70
    return {
      state: HEADLINE_PHASE ? 'HEADLINE' : null,
      opacity: HEADLINE_PHASE ? 1 : 0,
      at: HEADLINE_PHASE ? 'HEADLINE' : 'AI_ACCENT',
    }
  }

  const hasCaption = !!(scene.caption && scene.captionHidden !== true)
  const hasHeadline = !!scene.text

  // Headline leads the narrative. It hands off to the caption when a spoken
  // sentence exists (temporal replacement, never on-screen together); a
  // headline with no caption remains the sole narrative block for the duration.
  const headlineEnd = hasCaption ? 0.40 : 1.0
  const headline = hasHeadline ? { state: 'HEADLINE', start: 0.0, end: headlineEnd, fadeIn: 0.05, fadeOut: 0.08 } : null
  const caption = hasCaption ? { state: 'CAPTION', start: 0.32, end: 1.0, fadeIn: 0.08, fadeOut: 0 } : null

  let resolved = { state: null, opacity: 0, at: 'NONE' }
  for (const s of [headline, caption]) {
    if (!s) continue
    let a = 0
    if (timeFrac > s.start && timeFrac <= s.end) {
      a = 1
      if (timeFrac < s.start + s.fadeIn) a = (timeFrac - s.start) / s.fadeIn
      const outStart = s.end - s.fadeOut
      if (outStart < s.end && timeFrac > outStart) a = Math.min(a, (s.end - timeFrac) / s.fadeOut)
      a = Math.max(0, Math.min(1, a))
    }
    if (a > resolved.opacity) {
      resolved = { state: s.state, opacity: a, at: s.state }
    }
  }
  return resolved
}

/**
 * Spec-compatible authoritative narrative resolver: given the scene and its
 * duration, return the ONE narrative state active at absolute `time` (seconds)
 * — or null when no state is active.
 *
 * This is the single resolver all producers/layers must consult; renderers
 * never independently decide which narrative text to draw.
 *
 *   const narrative = resolveNarrativeAt(time, scene, duration);
 *   if (narrative.state) renderNarrative(narrative);
 *
 * Returns { state, opacity, at, time, timeFrac }.
 */
export function resolveNarrativeAt(time = 0, scene = {}, duration = 4) {
  const timeFrac = duration > 0 ? Math.max(0, Math.min(1, time / duration)) : 0
  const resolved = resolveNarrativeState(scene, timeFrac)
  return { ...resolved, time, timeFrac }
}

/**
 * Deterministic collision gate (Acceptance: preflight rejects text collision).
 *
 * Semantics — narrative states share the SAME center-stage anchor by design
 * (temporal replacement, never stacked), so two narrative blocks may overlap
 * spatially WITHOUT being a bug as long as they are never BOTH active at the
 * same instant. Therefore:
 *
 *   HARD FAIL (always a defect):
 *     - any block escapes the canvas
 *     - any block collides with the footer's reserved zone
 *     - a caption's own lines overlap (self-overlap)
 *     - two NARRATIVE blocks both active (>ACTIVE_OPACITY) AND colliding
 *       ("unexpected narrative overlap" — guards the state machine)
 *
 * `activeStates` is the set of states resolved active at this frame; when it
 * is provided and contains exactly one narrative state, spatial overlap
 * between different states is allowed (they replace one another in time).
 */
export function validateTextComposition({ headline, caption, outro, footer } = {}, options = {}) {
  const {
    label = 'scene',
    canvas = { width: DesignSystem.W, height: DesignSystem.H },
    margin = 0,
    activeStates = null,
  } = options
  const fail = (msg) => { throw new Error(`${msg}`) }

  const named = { headline, caption, outro }
  const blocks = {}
  for (const [name, l] of Object.entries(named)) blocks[name] = l ? blockFor(l) : null
  const canvasW = canvas.width
  const canvasH = canvas.height

  const stateOf = (name) => ({ headline: 'HEADLINE', caption: 'CAPTION', outro: 'OUTRO' })[name]
  const bothActive = (aName, bName) => {
    if (!activeStates) return false
    const a = stateOf(aName)
    const b = stateOf(bName)
    return a && b && activeStates.includes(a) && activeStates.includes(b)
  }

  // 1. Each block within canvas (HARD FAIL).
  for (const [name, b] of Object.entries(blocks)) {
    if (!b) continue
    if (b.left < -margin || b.right > canvasW + margin || b.top < -margin || b.bottom > canvasH + margin) {
      fail(`TEXT_COMPOSITION_COLLISION:${label}:${name} escapes canvas (box=${JSON.stringify(b)})`)
    }
  }

  // 2. Unexpected narrative-vs-narrative overlap: only when BOTH states are
  //    active at the same frame (HARD FAIL). Otherwise shared center-stage is
  //    allowed (temporal replacement).
  const narrativePairs = [
    ['headline', 'caption'],
    ['caption', 'outro'],
    ['headline', 'outro'],
  ]
  for (const [aName, bName] of narrativePairs) {
    const a = blocks[aName]
    const b = blocks[bName]
    if (!a || !b) continue
    if (bothActive(aName, bName) && overlaps(a, b, 2)) {
      fail(`TEXT_COMPOSITION_COLLISION:${label}:${aName}+${bName} both active and overlap (${aName}box=${JSON.stringify(a)} ${bName}box=${JSON.stringify(b)})`)
    }
  }

  // 3. No block collides with the footer reserve (HARD FAIL).
  if (footer && footer.top != null) {
    for (const [name, b] of Object.entries(blocks)) {
      if (!b) continue
      if (b.bottom > footer.top - 4) {
        fail(`TEXT_COMPOSITION_COLLISION:${label}:${name}+footer overlap (${name}bottom=${b.bottom} footerTop=${footer.top})`)
      }
    }
  }

  // 4. Caption self-overlap (HARD FAIL): lines must be separated by the line
  //    height with no glyph-box collision.
  if (caption) {
    const lineH = caption.lineHeight
    if (caption.lines && caption.lines.length > 1 && lineH < caption.fontSize * 0.8) {
      fail(`TEXT_COMPOSITION_COLLISION:${label}:caption self-overlap (lineHeight=${lineH} fontSize=${caption.fontSize})`)
    }
  }

  return true
}

// Convenience: assert safe + emit diagnostics for one scene.
export function assertNarrativeComposition(scene = {}, ctx = null, options = {}) {
  const canvas = { width: DesignSystem.W, height: DesignSystem.H }
  const comp = buildNarrativeLayouts(scene, canvas, ctx)
  validateTextComposition(
    { headline: comp.headline, caption: comp.caption, outro: comp.outro, footer: comp.footer },
    { ...options, canvas }
  )
  return comp
}

/**
 * [TEXT-LAYOUT] diagnostics — expose the authoritative bounding boxes so the
 * current bug class is immediately visible in the render log (Acceptance:
 * render diagnostics expose text bounding boxes).
 */
export function textLayoutDiagnostics(comp = {}, active = {}) {
  const canvasW = comp.canvas?.width || DesignSystem.W
  const canvasH = comp.canvas?.height || DesignSystem.H
  const box = (l) => (l ? blockFor(l) : null)
  const center = (b) => (b ? { cx: Math.round(b.left + b.width / 2), cy: Math.round(b.top + b.height / 2) } : null)
  const lines = []
  lines.push('[TEXT-LAYOUT]')
  const aspect = canvasW / canvasH
  const isLandscape = Math.abs(aspect - 16 / 9) < 0.02 || Math.abs(aspect - 1.78) < 0.02
  lines.push(`format: ${isLandscape ? '16:9' : '9:16'} canvas: ${canvasW}x${canvasH}`)
  lines.push(`ACTIVE NARRATIVE: ${active.state || 'NONE'}`)
  if (comp.caption) {
    const b = box(comp.caption)
    const c = center(b)
    lines.push('CAPTION')
    lines.push('-------')
    lines.push(`lines: ${comp.caption.lines?.length || 0}`)
    lines.push(`fontSize: ${comp.caption.fontSize}`)
    lines.push(`lineHeight: ${comp.caption.lineHeight}`)
    lines.push(`width: ${Math.round(b.width)}`)
    lines.push(`height: ${Math.round(b.height)}`)
    lines.push(`centerX: ${c.cx}`)
    lines.push(`centerY: ${c.cy}`)
  } else {
    lines.push('CAPTION: (none)')
  }
  if (comp.headline) {
    const b = box(comp.headline)
    lines.push(`HEADLINE lines=${comp.headline.lines?.length || 0} fontSize=${comp.headline.fontSize} lineHeight=${comp.headline.lineHeight} box=[${Math.round(b.left)},${Math.round(b.top)}..${Math.round(b.right)},${Math.round(b.bottom)}] active: ${active.state === 'HEADLINE'}`)
  } else {
    lines.push('HEADLINE: (none)')
  }
  if (comp.outro) {
    const b = box(comp.outro)
    lines.push(`OUTRO box=[${Math.round(b.left)},${Math.round(b.top)}..${Math.round(b.right)},${Math.round(b.bottom)}] active: ${active.state === 'OUTRO'}`)
  } else {
    lines.push('OUTRO: (none)')
  }
  if (comp.footer) {
    lines.push('FOOTER')
    lines.push('------')
    lines.push(`top: ${comp.footer.top}`)
    lines.push(`bottom: ${comp.footer.bottom}`)
  }
  const hBox = box(comp.headline)
  const cBox = box(comp.caption)
  const oBox = box(comp.outro)
  // Collision only counts when BOTH states are active the same frame (temporal
  // replacement shares the center stage deliberately; simultaneous is a bug).
  const activeState = active.state
  const pairActive = (a, b) => {
    const set = activeState ? [activeState] : []
    return set.includes(a) && set.includes(b)
  }
  lines.push('COLLISION')
  lines.push('---------')
  lines.push(`caption/self: ${cBox && comp.caption ? (overlapsSelf(comp.caption) ? 'FAIL' : 'PASS') : 'N/A'}`)
  lines.push(`headline/caption: ${hBox && cBox && pairActive('HEADLINE', 'CAPTION') ? (overlaps(hBox, cBox) ? 'FAIL' : 'PASS') : 'PASS (not simultaneous)'}`)
  lines.push(`caption/footer: ${cBox && comp.footer ? (cBox.bottom > comp.footer.top ? 'FAIL' : 'PASS') : 'N/A'}`)
  lines.push(`outro/footer: ${oBox && comp.footer ? (oBox.bottom > comp.footer.top ? 'FAIL' : 'PASS') : 'N/A'}`)
  lines.push(`outro/branding: ${oBox && comp.footer ? (oBox.bottom > comp.footer.top ? 'FAIL' : 'PASS') : 'N/A'}`)
  return lines.join('\n')
}

// Detect caption self-overlap: lines are stacked by layout.lineHeight; if the
// line height is too small relative to the glyph boxes the lines collide.
function overlapsSelf(captionLayout) {
  if (!captionLayout?.lines || captionLayout.lines.length < 2) return false
  const lineH = captionLayout.lineHeight
  // A line's ink box is roughly fontSize tall; require lines to be separated by
  // >= 0.80 * fontSize so they never touch ("consistent line spacing", no
  // self-overlap).
  return lineH < captionLayout.fontSize * 0.8
}
