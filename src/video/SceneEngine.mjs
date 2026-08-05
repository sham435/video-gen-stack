import { createCanvas, GlobalFonts } from '@napi-rs/canvas'
import { applyMotionEffect } from './MotionEngine.mjs'
import { Compositor } from './Compositor.mjs'
import { DesignSystem } from '../visuals/DesignSystem.mjs'
import fs from 'fs'

let fontsRegistered = false
// Register the broadcast typefaces ONCE for the whole render pipeline. Without
// this the caption font string ('Montserrat, Inter, sans-serif') silently falls
// back to generic sans — the "clean bold" look never actually renders.
function registerPipelineFonts() {
  if (fontsRegistered) return
  fontsRegistered = true
  try {
    if (fs.existsSync('assets/fonts/Montserrat-ExtraBold.ttf')) {
      GlobalFonts.registerFromPath('assets/fonts/Montserrat-ExtraBold.ttf', 'Montserrat ExtraBold')
    }
    if (fs.existsSync('assets/fonts/Anton-Regular.ttf')) {
      GlobalFonts.registerFromPath('assets/fonts/Anton-Regular.ttf', 'Anton')
    }
  } catch (e) {
    console.warn('[fonts] registration skipped:', e.message)
  }
}

export class SceneEngine {
  constructor(config) {
    this.config = config
    this.compositor = new Compositor()
    registerPipelineFonts()
  }

  async renderSceneFrame(scene, progress, wordTimings, wordIndex, renderManifest = null) {
    const canvas = createCanvas(DesignSystem.W, DesignSystem.H)
    const ctx = canvas.getContext('2d')

    applyMotionEffect(ctx, 'camera_shake', progress)

    const category = scene.category || this.config.category || 'technology'

    await this.compositor.compose(ctx, scene, progress, wordIndex, category, renderManifest)

    return canvas.toBuffer('image/png')
  }
}