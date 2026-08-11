import { renderCaptions } from '../CaptionEngine.mjs'
import { DesignSystem } from '../../visuals/DesignSystem.mjs'
import { BROADCAST_TEXT } from '../../style/text-tokens.mjs'

export class CaptionLayer {
  draw(ctx, scene, progress, wordIndex, alpha = 1) {
    if (alpha <= 0.01 || !scene.caption || scene.captionHidden) return
    // Single-owner rule: the brand-outro scene already renders STAY WITH /
    // NEWS-MONSTER as its own centered headline stack (InformationLayer). The
    // caption layer must not re-print that text in the lower third — it
    // collides with the footer zone and duplicates the outro content.
    if (scene.outro || scene.type === 'close' || scene.type === 'brand_close') return
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
