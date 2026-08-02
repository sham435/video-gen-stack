import { BackgroundLayer } from './layers/BackgroundLayer.mjs'
import { HeroVisualLayer } from './layers/HeroVisualLayer.mjs'
import { GlassCardLayer } from './layers/GlassCardLayer.mjs'
import { InformationLayer } from './layers/InformationLayer.mjs'
import { EmphasisLayer } from './layers/EmphasisLayer.mjs'
import { CaptionLayer } from './layers/CaptionLayer.mjs'
import { BroadcastUILayer } from './layers/BroadcastUILayer.mjs'
import { BrandingLayer } from './layers/BrandingLayer.mjs'
import { PostProcessLayer } from './layers/PostProcessLayer.mjs'
import { getDirector } from '../ai/CategoryDirector.mjs'

export class Compositor {
  constructor() {
    this.background = new BackgroundLayer()
    this.hero = new HeroVisualLayer()
    this.glass = new GlassCardLayer()
    this.info = new InformationLayer()
    this.emphasis = new EmphasisLayer()
    this.captions = new CaptionLayer()
    this.broadcast = new BroadcastUILayer()
    this.branding = new BrandingLayer()
    this.post = new PostProcessLayer()
  }

  async compose(ctx, scene, progress, wordIndex, category) {
    const director = getDirector(category)
    const layout = director.getLayout(scene.type)

    this.background.draw(ctx, scene, progress, category)
    if (scene.image || scene.backgroundImage || scene.bRoll) {
      await this.hero.draw(ctx, scene, progress)
    }

    if (layout.glassCard) {
      this.glass.draw(ctx, scene, progress, {
        category,
        y: layout.textPosition === 'bottom' ? 0.62 : 0.55,
        height: layout.textPosition === 'bottom' ? 300 : 250,
        accentLine: layout.accentLine,
        delay: 0.05,
        borderColor: layout.borderPulse ? undefined : 'rgba(255,255,255,0.08)',
      })
    }

    await this.info.draw(ctx, scene, progress, category)
    this.emphasis.draw(ctx, scene, progress, category)
    this.captions.draw(ctx, scene, progress, wordIndex)

    if (director.getOverlays().liveBadge) {
      this.broadcast.draw(ctx, scene, progress, category)
    }

    this.branding.draw(ctx, scene, progress)
    this.post.draw(ctx, scene, progress, category)
  }
}