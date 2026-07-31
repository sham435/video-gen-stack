import { applyMotionEffect, applyDefaultEffects } from '../MotionEngine.mjs'
import { DesignSystem } from '../../visuals/DesignSystem.mjs'
import { drawGlitchOverlay } from '../../visuals/BreakingBanner.mjs'
import { FrameEnhancer } from '../enhancement/FrameEnhancer.mjs'

const { W, H } = DesignSystem

export class PostProcessLayer {
  constructor() {
    this.enhancer = new FrameEnhancer()
  }

  draw(ctx, scene, progress, category) {
    const catStyle = DesignSystem.getCategoryStyle(category)
    this.drawVignette(ctx, progress)

    // Category profile enhance: sharpen + denoise + contrast + saturation + grade
    this.enhancer.enhance(ctx, category)

    if (scene.effect) {
      applyMotionEffect(ctx, scene.effect, progress)
    }

    if (scene.type === 'hook') {
      drawGlitchOverlay(ctx, progress)
      applyMotionEffect(ctx, 'particle_burst', progress)
    }

    for (const effect of (catStyle.effects || [])) {
      if (effect === 'glitch' && Math.random() < 0.02) {
        applyMotionEffect(ctx, 'glitch', progress)
      }
    }

    applyDefaultEffects(ctx, progress)
  }

  drawVignette(ctx, progress) {
    const grad = ctx.createRadialGradient(W / 2, H / 2, H * 0.3, W / 2, H / 2, H * 0.8)
    grad.addColorStop(0, 'rgba(0,0,0,0)')
    grad.addColorStop(1, 'rgba(0,0,0,0.4)')
    ctx.fillStyle = grad
    ctx.fillRect(0, 0, W, H)
  }
}