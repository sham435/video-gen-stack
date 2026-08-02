// TextLayoutPreflight — hard failure gate before FFmpeg. Any layout that
// still overflows or escapes its safe zone aborts the render with
// TEXT_OVERFLOW_BLOCKED_RENDER instead of shipping clipped text.
import { SafeZoneManager } from './SafeZoneManager.mjs'

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
}
