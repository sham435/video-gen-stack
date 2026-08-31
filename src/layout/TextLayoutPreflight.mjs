// TextLayoutPreflight — hard failure gate before FFmpeg. Any layout that
// still overflows or escapes its safe zone aborts the render with
// TEXT_OVERFLOW_BLOCKED_RENDER instead of shipping clipped text.
import { SafeZoneManager } from './SafeZoneManager.mjs'
import { buildNarrativeLayouts, validateTextComposition } from '../video/NarrativeTextComposition.mjs'

export class TextLayoutPreflight {
  // validate(layout, label) -> true; throws TEXT_OVERFLOW_BLOCKED_RENDER
  static validate(layout, label = 'text') {
    if (!layout) return true
    if (layout.overflow) {
      throw new Error(
        `TEXT_OVERFLOW_BLOCKED_RENDER: ${label} cannot fit its safe zone at any size ` +
        `(role=${layout.role}, fontSize=${layout.fontSize}px, lines=${layout.lines.length})`
      )
    }
    return SafeZoneManager.assertSafe(layout, label)
  }

  // Validate a scene's full set of layouts before render starts.
  static validateScene(scene, label) {
    for (const role of ['emphasis', 'headline', 'caption', 'source']) {
      const key = `${role}Layout`
      if (scene[key]) TextLayoutPreflight.validate(scene[key], `${label || scene.id || 'scene'}.${role}`)
    }
    return true
  }

  // NARRATIVE COLLISION PREFLIGHT (16:9). Deterministic gate over the
  // authoritative narrative block geometry: any caption/headline/outro that
  // SELF-overlaps, escapes the canvas, or spills into the footer's reserved
  // zone aborts the render (TEXT_COMPOSITION_COLLISION). Narrative-vs-narrative
  // spatial overlap is allowed here because the state machine renders exactly
  // one narrative state per frame (temporal replacement), so only the
  // always-defect rules are enforced. Distinguishes canvas-safe low-risk scenes
  // from shipping clipped/overlapping text.
  static validateNarrativeCollisions(scene, ctx = null, label) {
    const W = scene?.canvasWidth || 1280
    const H = scene?.canvasHeight || 720
    const comp = buildNarrativeLayouts(scene, { width: W, height: H }, ctx)
    // Validate the ACTUAL layouts that will render (production injects them),
    // falling back to the rebuilt authoritative measurement when absent.
    validateTextComposition(
      {
        headline: scene?.headlineLayout || comp.headline,
        caption: (scene?.caption && scene.captionHidden !== true) ? (scene?.captionLayout || comp.caption) : null,
        outro: comp.outro,
        footer: comp.footer,
      },
      {
        label: label || scene.id || 'scene',
        canvas: { width: W, height: H },
        activeStates: null, // preflight: enforce always-defect rules only
      }
    )
    return true
  }
}
