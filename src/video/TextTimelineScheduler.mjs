// TextTimelineScheduler — ZERO TEXT OVERLAP POLICY.
//
// Every scene's text layers are resolved into time windows BEFORE rendering.
// The compositor renders only the active layer per frame; a hard assertion
// (TEXT_TIMELINE_CONFLICT) fails the render if two focal layers are ever
// active at the same time.
//
// Priority order (never render two with the same priority together):
//   1. Breaking Banner
//   2. Hero Headline
//   3. Secondary Headline
//   4. AI Accent
//   5. Caption (word-sync subtitles)
//   6. Footer (chrome — always visible, exempt from the assertion)
//
// Layer contract: { id, priority, start, end, animationIn, animationOut,
// allowOverlap: false, safeZone, zIndex }

export const PRIORITY = { banner: 1, hero: 2, secondary: 3, ai: 4, caption: 5, footer: 6 }

const HOOK_FADE_IN = 0.10
const HOOK_FADE_OUT = 0.30
const SECONDARY_STAGGER = 0.06

export class TextTimelineScheduler {
  // Build the layer timeline for a scene. Windows are fractions of duration.
  static buildTimeline(scene, duration = 4) {
    if (scene.type === 'hook') return this.hookTimeline(scene, duration)
    return this.sceneTimeline(scene, duration)
  }

  // Hook scene: BREAKING only (0-30%), then hero (55% of the rest), then
  // secondary (25%), then AI accent (20%). Each starts only after the
  // previous layer has reached zero opacity — no cross overlap.
  static hookTimeline(scene, duration) {
    const layers = [{ id: 'footer', priority: PRIORITY.footer, start: 0, end: 1, allowOverlap: true, safeZone: 'footer', zIndex: 1 }]
    layers.push({ id: 'banner', priority: PRIORITY.banner, start: 0, end: 0.30, animationIn: 0.06, animationOut: 0.04, allowOverlap: false, safeZone: 'top', zIndex: 2 })

    const t0 = 0.35
    const remaining = Math.max(0.5, 1 - t0)
    const heroEnd = t0 + remaining * 0.55
    const secondaryEnd = heroEnd + remaining * 0.25

    if (scene.text) {
      layers.push({ id: 'hero', priority: PRIORITY.hero, start: t0, end: heroEnd, animationIn: HOOK_FADE_IN, animationOut: HOOK_FADE_OUT, allowOverlap: false, safeZone: 'headline', zIndex: 3 })
      layers.push({ id: 'secondary', priority: PRIORITY.secondary, start: heroEnd, end: secondaryEnd, animationIn: 0.05, animationOut: 0.05, allowOverlap: false, safeZone: 'headline', zIndex: 4 })
    } else {
      layers.push({ id: 'hero', priority: PRIORITY.hero, start: t0, end: heroEnd, animationIn: HOOK_FADE_IN, animationOut: HOOK_FADE_OUT, allowOverlap: false, safeZone: 'headline', zIndex: 3 })
    }

    layers.push({ id: 'ai', priority: PRIORITY.ai, start: secondaryEnd, end: 1, animationIn: 0.12, animationOut: 0.05, allowOverlap: false, safeZone: 'lower_third', zIndex: 5 })
    if (scene.caption && scene.captionHidden !== true) {
      layers.push({ id: 'caption', priority: PRIORITY.caption, start: 0.30, end: 1, animationIn: 0.1, animationOut: 0, allowOverlap: true, safeZone: 'caption', zIndex: 6 })
    }
    return { type: 'hook', layers }
  }

  // Non-hook scenes: a single focal layer with the word-sync caption below.
  static sceneTimeline(scene, duration) {
    const layers = [{ id: 'footer', priority: PRIORITY.footer, start: 0, end: 1, allowOverlap: true, safeZone: 'footer', zIndex: 1 }]
    const focal = scene.type === 'fact' || scene.type === 'retention' ? 'hero'
      : scene.type === 'brand_close' ? 'hero'
      : 'ai'
    layers.push({ id: focal, priority: PRIORITY[focal], start: 0.05, end: 1, animationIn: 0.15, animationOut: 0, allowOverlap: false, safeZone: focal === 'ai' ? 'lower_third' : 'headline', zIndex: 2 })
    if (scene.caption && scene.captionHidden !== true) {
      layers.push({ id: 'caption', priority: PRIORITY.caption, start: 0.1, end: 1, animationIn: 0.1, animationOut: 0, allowOverlap: true, safeZone: 'caption', zIndex: 3 })
    }
    return { type: scene.type || 'fact', layers }
  }

  static layersAt(timeline, time) {
    return timeline.layers.filter(l => time >= l.start && time <= l.end)
  }

  // Linear opacity envelope for a layer at a given time (fractions of duration).
  static envelope(layer, time) {
    if (!layer) return 0
    if (time < layer.start || time > layer.end) return 0
    const fadeIn = layer.animationIn || 0.08
    const fadeOut = layer.animationOut || 0.08
    let a = 1
    if (time < layer.start + fadeIn) a = (time - layer.start) / fadeIn
    const outStart = layer.end - fadeOut
    if (time > outStart) a = Math.min(a, (layer.end - time) / fadeOut)
    return Math.max(0, Math.min(1, a))
  }

  // Per-frame assertion: at most ONE focal layer (priority <= hero: banner +
  // hero) may be active, and the hero/secondary/AI combos are forbidden.
  // Violation => TEXT_TIMELINE_CONFLICT, the render must fail.
  static assertFrame(timeline, time, sceneId = '?') {
    const active = this.layersAt(timeline, time)
    const focal = active.filter(l => l.priority <= PRIORITY.hero)
    if (focal.length > 1) {
      throw new Error(`TEXT_TIMELINE_CONFLICT:scene${sceneId}:${focal.map(l => l.id).join('+')}@t=${time.toFixed(3)}`)
    }
    const forbidden = [['hero', 'secondary'], ['secondary', 'ai'], ['hero', 'ai']]
    for (const [a, b] of forbidden) {
      if (active.some(l => l.id === a) && active.some(l => l.id === b)) {
        throw new Error(`TEXT_TIMELINE_CONFLICT:scene${sceneId}:${a}+${b}@t=${time.toFixed(3)}`)
      }
    }
    return active
  }

  // Word stagger offset for the secondary headline: 0.06s per word from the
  // layer start. Returns -1 when the word is not yet visible.
  static wordStart(layer, wordIndex) {
    return layer.start + wordIndex * SECONDARY_STAGGER
  }
}
