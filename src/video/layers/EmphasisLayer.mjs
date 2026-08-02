// EmphasisLayer — the animated keyword in the lower third. The emphasis word
// (scene.caption_focus) is the one piece of text that must never duplicate
// anything else on screen: the resolver picked it precisely because it is
// absent from the headline, and this layer only draws when the caption is
// hidden, so the word can never be double-rendered.
// Position and size come from the validated emphasis layout (engine output).
import { DesignSystem } from '../../visuals/DesignSystem.mjs'
import { BROADCAST_TEXT } from '../../style/text-tokens.mjs'

export class EmphasisLayer {
  draw(ctx, scene, progress, category = 'technology') {
    const word = scene.caption_focus || scene.focus || ''
    if (!word) return
    // Caption visible -> the word is highlighted inside the caption itself.
    if (!scene.captionHidden && scene.caption) return

    const layout = scene.emphasisLayout
    const catStyle = DesignSystem.getCategoryStyle(category)
    const accent = catStyle?.colors?.accent || DesignSystem.brand.accent || '#00E5FF'

    const fontSize = layout?.fontSize || 58
    const lineH = layout?.lineHeight || fontSize * 1.25
    const lines = layout?.lines?.length ? layout.lines : [word.toUpperCase()]
    const x = layout ? layout.x + layout.width / 2 : DesignSystem.W / 2
    const y = layout ? layout.y : DesignSystem.H * 0.78 - (lines.length * lineH) / 2

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
      ctx.globalAlpha = Math.max(0.05, Math.min(1, p - i * 0.15))
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
