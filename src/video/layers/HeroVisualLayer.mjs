import { loadImage } from '@napi-rs/canvas'
import { DesignSystem } from '../../visuals/DesignSystem.mjs'

// Entity image highlight — a subtle scale-pulse + accent-ring on the hero image,
// timed to when a named brand/entity (e.g. "SAMSUNG") FIRST appears in the
// scene's on-screen text. This is a RECOGNITION cue, not a transition effect:
// it reuses the entity data the pipeline already computes (scene.assetEntity /
// visualIntent.brand) and never re-detects it here.
//
// Pacing uses the same broadcast word-stagger as the caption headline so the
// ring fires exactly as the entity word lands on screen (0.30s stagger between
// word starts).
const STAGGER = 0.30
const PULSE_MS = 0.35      // scale 1.0 -> 1.04 -> 1.0 over ~350ms
const PULSE_SCALE = 0.04
const RING_ALPHA = 0.5
const RING_WIDTH = Math.round(4)

export class HeroVisualLayer {
  constructor() {
    this.cache = {}
  }

  async load(url) {
    if (this.cache[url]) return this.cache[url]
    try {
      const img = await loadImage(url)
      this.cache[url] = img
      return img
    } catch {
      return null
    }
  }

  // Compute a 0-1 "highlight intensity" for the current scene time.
  // Returns 0 when no entity highlight is active this frame.
  highlightAmount(scene, time, layerStart = 0) {
    const entity = this._entity(scene)
    if (!entity || typeof time !== 'number' || time < 0) return 0
    // On-screen text that would display the entity (headline/secondary path).
    const text = String(scene.text || scene.subheadline || '').toUpperCase()
    const ent = entity.toUpperCase()
    if (!ent || !text.includes(ent)) return 0
    // Approximate the entity word's appearance time using the broadcast
    // word-stagger (0.30s per word), relative to the secondary layer start.
    const words = text.split(/\s+/)
    const idx = words.findIndex(w => w.includes(ent))
    if (idx < 0) return 0
    const base = typeof layerStart === 'number' ? layerStart : 0
    const appearAt = base + idx * STAGGER + 0.05
    const t = time - appearAt
    if (t < 0 || t > PULSE_MS) return 0
    // Single up-down pulse: 0 -> 1 -> 0 across the window.
    const p = t / PULSE_MS
    return Math.max(0, Math.min(1, Math.sin(p * Math.PI)))
  }

  _entity(scene) {
    return scene.assetEntity || scene.visualIntent?.brand || scene.entity || null
  }

  async draw(ctx, scene, progress, time = 0, layerStart = 0, accentColor = null) {
    const { W, H } = DesignSystem
    const urls = scene.images || (scene.image ? [scene.image] : null) || (scene.bRoll ? [scene.bRoll] : null) || (scene.backgroundImage ? [scene.backgroundImage] : null)
    if (!urls || urls.length === 0) return

    // B-roll cycling: swap the hero image every ~2.5s within the scene
    const cycle = Math.floor(progress * 3.5) % urls.length
    const imgUrl = urls[cycle]
    const img = await this.load(imgUrl)
    if (!img) return

    // Crossfade between images on swap
    const local = progress * 3.5 - Math.floor(progress * 3.5)
    const blendAlpha = 0.6 * (1 - Math.abs(local - 0.5) * 1.4)

    ctx.save()

    const zoom = 1 + Math.sin(progress * Math.PI) * 0.03
    const offsetX = Math.sin(progress * 0.3) * 20
    const offsetY = Math.cos(progress * 0.4) * 15

    // Entity highlight: subtle scale-pulse on the hero image, timed to the
    // brand's first appearance in the on-screen text (recognition cue).
    const hl = this.highlightAmount(scene, time, layerStart)
    const pulseScale = 1 + hl * PULSE_SCALE

    const imgW = img.width
    const imgH = img.height
    const aspect = imgW / imgH
    const targetAspect = W / H

    let sx, sy, sw, sh
    if (aspect > targetAspect) {
      sh = imgH
      sw = imgH * targetAspect
      sx = (imgW - sw) / 2
      sy = 0
    } else {
      sw = imgW
      sh = imgW / targetAspect
      sx = 0
      sy = (imgH - sh) / 2
    }

    ctx.globalAlpha = Math.max(0.35, blendAlpha)
    ctx.drawImage(img, sx, sy, sw, sh, offsetX, offsetY, W * zoom * pulseScale, H * zoom * pulseScale)

    const fadeGrad = ctx.createLinearGradient(0, H * 0.5, 0, H)
    fadeGrad.addColorStop(0, 'rgba(0,0,0,0)')
    fadeGrad.addColorStop(1, 'rgba(0,0,0,0.7)')
    ctx.fillStyle = fadeGrad
    ctx.fillRect(0, 0, W, H)

    // Accent-ring pulse on the frame edge while the entity is highlighted,
    // using the scene's existing accent color (emotionColors primary) when
    // available. There is no hardcoded "second yellow" — it inherits the scene.
    if (hl > 0.01) {
      const ring = accentColor || scene.colors?.primary || DesignSystem.brand.primary
      ctx.save()
      ctx.globalAlpha = hl * RING_ALPHA
      ctx.strokeStyle = ring
      ctx.lineWidth = RING_WIDTH
      ctx.strokeRect(W * 0.01, H * 0.01, W * 0.98, H * 0.98)
      ctx.restore()
    }

    ctx.restore()
  }
}