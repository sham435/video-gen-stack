import { createCanvas } from '@napi-rs/canvas'
import { applyMotionEffect } from './MotionEngine.mjs'
import { Compositor } from './Compositor.mjs'
import { DesignSystem } from '../visuals/DesignSystem.mjs'

export class SceneEngine {
  constructor(config) {
    this.config = config
    this.compositor = new Compositor()
  }

  async renderSceneFrame(scene, progress, wordTimings, wordIndex) {
    const canvas = createCanvas(DesignSystem.W, DesignSystem.H)
    const ctx = canvas.getContext('2d')

    applyMotionEffect(ctx, 'camera_shake', progress)

    const category = scene.category || this.config.category || 'technology'

    await this.compositor.compose(ctx, scene, progress, wordIndex, category)

    return canvas.toBuffer('image/png')
  }
}