import { BackgroundLayer } from './layers/BackgroundLayer.mjs'
import { HeroVisualLayer } from './layers/HeroVisualLayer.mjs'
import { GlassCardLayer } from './layers/GlassCardLayer.mjs'
import { InformationLayer } from './layers/InformationLayer.mjs'
import { EmphasisLayer } from './layers/EmphasisLayer.mjs'
import { CaptionLayer } from './layers/CaptionLayer.mjs'
import { BroadcastUILayer } from './layers/BroadcastUILayer.mjs'
import { BrandingLayer } from './layers/BrandingLayer.mjs'
import { PostProcessLayer } from './layers/PostProcessLayer.mjs'
import { DesignSystem } from '../visuals/DesignSystem.mjs'
import { TextTimelineScheduler } from './TextTimelineScheduler.mjs'
import { canRenderText } from './TextPolicy.mjs'
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

  async compose(ctx, scene, progress, wordIndex, category, renderManifest = null) {
    const director = getDirector(category)
    const layout = director.getLayout(scene.type)
    const duration = scene.duration || 4

    // RenderManifest: no layer renders unless the manifest grants ownership.
    // Compositor is the RenderDirector — renderers draw only when instructed.
    const owned = (layer) => renderManifest === null || renderManifest.canRender(layer, 'canvas')

    // Text timeline: resolve visibility windows, then render only the active
    // layer. A violation of the zero-overlap policy fails the render.
    const timeline = TextTimelineScheduler.buildTimeline(scene, duration)
    const time = Math.max(0, Math.min(duration, progress * duration))
    TextTimelineScheduler.assertFrame(timeline, time, scene.id)
    const env = (id) => TextTimelineScheduler.envelope(timeline.layers.find(l => l.id === id), time)

    this.background.draw(ctx, scene, progress, category)
    if (scene.image || scene.backgroundImage || scene.bRoll) {
      await this.hero.draw(ctx, scene, progress)
    }

    if (layout.glassCard) {
      this.glass.draw(ctx, scene, progress, {
        category,
        y: layout.textPosition === 'bottom' ? 0.62 : 0.55,
        // 9:16 design-space card heights scaled to the active frame.
        height: DesignSystem.sy(layout.textPosition === 'bottom' ? 300 : 250),
        accentLine: layout.accentLine,
        delay: 0.05,
        borderColor: layout.borderPulse ? undefined : 'rgba(255,255,255,0.08)',
      })
    }

    if (owned('headline')) await this.info.draw(ctx, scene, progress, category, timeline, time)
    if (owned('emphasis') && canRenderText(scene, 'emphasis')) this.emphasis.draw(ctx, scene, progress, category, env('ai'))
    if (owned('caption') && canRenderText(scene, 'caption')) this.captions.draw(ctx, scene, progress, wordIndex, env('caption'))

    // Cinematic grade (vignette, color grade, scan lines, noise) runs over the
    // CONTENT stack only. Chrome (LIVE, footer, ticker, bug) must be drawn
    // AFTER it — otherwise the vignette (0.4–0.5 black at frame edges) paints
    // over the footer and LIVE, making them unreadably dim in the final MP4.
    this.post.draw(ctx, scene, progress, category)

    if (director.getOverlays().liveBadge) {
      this.broadcast.draw(ctx, scene, progress, category)
    }

    if (owned('footer')) this.branding.draw(ctx, scene, progress)

    // Watermark sits ABOVE post (vignette + grade) so it stays crisp/visible.
    // Always on — every scene, every frame. Skipped when hideBranding is set.
    this.branding.drawBug(ctx, scene)
  }
}