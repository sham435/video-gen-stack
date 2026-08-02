import { renderCaptions } from '../CaptionEngine.mjs'
import { DesignSystem } from '../../visuals/DesignSystem.mjs'

export class CaptionLayer {
  draw(ctx, scene, progress, wordIndex) {
    if (!scene.caption || scene.captionHidden) return
    const catStyle = DesignSystem.getCategoryStyle(scene.category || 'technology')
    const accent = catStyle?.colors?.primary || DesignSystem.brand.accent
    renderCaptions(ctx, scene.caption, wordIndex, progress, scene.caption_focus || scene.focus, accent, scene.captionFontSize || 58)
  }
}
