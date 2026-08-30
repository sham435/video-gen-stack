// EmphasisLayer — the AI accent keyword, anchored 200px from the bottom edge
// (above the footer border), always in the category accent color — NEVER
// white — so it can never compete with the white headlines. The keyword
// (scene.caption_focus) is the one piece of text that must never duplicate
// anything else on screen: the resolver picked it precisely because it is
// absent from the headline, and this layer only draws in its own timeline
// window.
import { DesignSystem } from '../../visuals/DesignSystem.mjs'
import { BROADCAST_TEXT } from '../../style/text-tokens.mjs'
import { canRenderText } from '../TextPolicy.mjs'
import { FooterLayout } from '../footer/FooterLayout.mjs'

// Category accent palette for the AI layer (per production spec):
// technology = electric cyan / neon blue, business = emerald,
// finance = gold, science = purple, politics = orange, sports = green,
// entertainment = pink.
export const AI_ACCENT_BY_CATEGORY = {
  technology: '#39D5FF',
  ai: '#39D5FF',
  programming: '#39D5FF',
  cybersecurity: '#39D5FF',
  space: '#39D5FF',
  gaming: '#E100FF',
  quantum: '#E100FF',
  business: '#00E58A',
  biotech: '#00E58A',
  finance: '#FFD700',
  science: '#B15CFF',
  politics: '#FF7A00',
  sports: '#00E05C',
  entertainment: '#FF4FA3',
}

export class EmphasisLayer {
  draw(ctx, scene, progress, category = 'technology', alpha = 1) {
    if (alpha <= 0.01) return
    const word = scene.caption_focus || scene.focus || ''
    if (!word) return
    // Hard boundary: outro scenes own their text exclusively.
    // Non-hook scenes: caption visible -> the word is highlighted inside the
    // caption itself. Hook scenes schedule the AI accent as a dedicated phase
    // (after the secondary headline), so it renders regardless of the caption.
    if (scene.type !== 'hook' && !scene.captionHidden && scene.caption) return
    if (!canRenderText(scene, 'emphasis')) return

    const layout = scene.emphasisLayout
    const accent = AI_ACCENT_BY_CATEGORY[category] || DesignSystem.brand.accent || '#00E5FF'

    const fontSize = layout?.fontSize || 72
    const lineH = layout?.lineHeight || fontSize * 1.25
    const lines = layout?.lines?.length ? layout.lines : [word.toUpperCase()]
    // AI accent locked 200px from the bottom — sits above the footer border.
    const x = layout ? layout.x + layout.width / 2 : DesignSystem.W / 2
    const y = Math.min(layout?.y || DesignSystem.H - 200, DesignSystem.H - 200)

    ctx.save()
    const p = Math.min(1, progress * 1.2)
    const scale = 0.7 + p * 0.3
    ctx.translate(x, y)
    ctx.scale(scale, scale)

    const glow = 12 + Math.sin(progress * 6) * 6
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.shadowColor = accent
    ctx.shadowBlur = glow * p

    lines.forEach((line, i) => {
      ctx.globalAlpha = Math.max(0.05, Math.min(1, (p - i * 0.15) * alpha))
      ctx.font = `900 ${fontSize}px Anton, Impact, sans-serif`
      ctx.lineWidth = BROADCAST_TEXT.emphasis.strokeWidth
      ctx.lineJoin = 'round'
      ctx.strokeStyle = 'rgba(0,0,0,0.85)'
      ctx.strokeText(line, 0, i * lineH)
      ctx.fillStyle = accent
      ctx.fillText(line, 0, i * lineH)
    })

    ctx.shadowBlur = 0
    ctx.restore()
  }
}
