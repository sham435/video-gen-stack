import { renderCaptions } from '../CaptionEngine.mjs'

export class CaptionLayer {
  draw(ctx, scene, progress, wordIndex) {
    if (!scene.caption) return
    renderCaptions(ctx, scene.caption, wordIndex, progress)
  }
}