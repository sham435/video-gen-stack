import { renderCaptions } from '../CaptionEngine.mjs'
import { DesignSystem } from '../../visuals/DesignSystem.mjs'
import { BROADCAST_TEXT } from '../../style/text-tokens.mjs'

export class CaptionLayer {
  draw(ctx, scene, progress, wordIndex, alpha = 1) {
    if (alpha <= 0.01 || !scene.caption || scene.captionHidden) return
    // Broadcast minimum: never render reading text below 32px on a 1080p frame
    const cap = BROADCAST_TEXT.caption
    const captionText = scene.caption.length > cap.maxChars ? scene.caption.slice(0, cap.maxChars).trimEnd() + '…' : scene.caption
    const catStyle = DesignSystem.getCategoryStyle(scene.category || 'technology')
    const accent = catStyle?.colors?.primary || DesignSystem.brand.accent
    renderCaptions(
      ctx,
      captionText,
      wordIndex,
      progress,
      scene.caption_focus || scene.focus,
      accent,
      Math.max(cap.minSize, scene.captionLayout?.fontSize || 58),
      scene.captionLayout || null
    )
  }
}
