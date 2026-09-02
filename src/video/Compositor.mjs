import { BackgroundLayer } from './layers/BackgroundLayer.mjs'
import { HeroVisualLayer } from './layers/HeroVisualLayer.mjs'
import { GlassCardLayer } from './layers/GlassCardLayer.mjs'
import { InformationLayer } from './layers/InformationLayer.mjs'
import { EmphasisLayer } from './layers/EmphasisLayer.mjs'
import { CaptionLayer } from './layers/CaptionLayer.mjs'
import { NarrationCalloutLayer } from './layers/NarrationCalloutLayer.mjs'
import { BroadcastUILayer } from './layers/BroadcastUILayer.mjs'
import { BrandingLayer } from './layers/BrandingLayer.mjs'
import { PostProcessLayer } from './layers/PostProcessLayer.mjs'
import { DesignSystem } from '../visuals/DesignSystem.mjs'
import { TextTimelineScheduler } from './TextTimelineScheduler.mjs'
import { canRenderText } from './TextPolicy.mjs'
import { getDirector } from '../ai/CategoryDirector.mjs'
import {
  resolveNarrativeState,
  buildNarrativeLayouts,
  validateTextComposition,
  textLayoutDiagnostics,
  NARRATIVE_STATES,
} from './NarrativeTextComposition.mjs'

// Temporal boundary: the narration caption occupies the early portion of the
// CAPTION state; at this scene-time fraction the "WHY IT MATTERS" label + 2-line
// yellow callout take over, replacing the caption (temporal, not stacked).
const CAPTION_TO_CALLOUT = 0.68
// Minimum scene duration for the callout sub-state to fire. The callout needs
// ~label(0.7s) + 2-line yellow hold(1.5-2s) after the boundary, so the scene
// must have enough real time; short scenes keep the caption instead.
const CALLOUT_MIN_DURATION = 6.5

export class Compositor {
  constructor() {
    this.background = new BackgroundLayer()
    this.hero = new HeroVisualLayer()
    this.glass = new GlassCardLayer()
    this.info = new InformationLayer()
    this.emphasis = new EmphasisLayer()
    this.captions = new CaptionLayer()
    this.callout = new NarrationCalloutLayer()
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

    // NARRATIVE STATE MACHINE (16:9). At most ONE narrative text state is
    // active at any instant (HEADLINE -> CAPTION -> OUTRO, temporal
    // replacement). The authoritative layout for each narrative state is
    // measured by TextLayoutEngine and validated for collisions before any
    // renderer draws.
    const timeFrac = duration > 0 ? time / duration : 0
    const activeNarrative = resolveNarrativeState(scene, timeFrac)
    const comp = buildNarrativeLayouts(scene, { width: DesignSystem.W, height: DesignSystem.H }, ctx)

    // Prefer the production-injected layouts (src/index.mjs already runs every
    // layer through TextLayoutEngine) but fall back to the narrative comp's
    // authoritative measurement when a scene bypassed the engine.
    const headlineLayout = scene.headlineLayout || comp.headline
    const captionLayout = (scene.caption && scene.captionHidden !== true) ? (scene.captionLayout || comp.caption) : null
    const outroLayout = comp.outro
    try {
      validateTextComposition(
        { headline: headlineLayout, caption: captionLayout, outro: outroLayout, footer: comp.footer },
        {
          label: scene.id || scene.type,
          canvas: { width: DesignSystem.W, height: DesignSystem.H },
          // Only enforce narrative-vs-narrative exclusion when BOTH states are
          // active this frame (shared center-stage across time is intended).
          activeStates: activeNarrative.state ? [activeNarrative.state] : [],
        }
      )
    } catch (e) {
      // Deterministic collision gate: unexpected narrative overlap fails the
      // render (production-quality, per spec).
      throw e
    }
    if (process.env.TEXT_LAYOUT_DIAGNOSTICS === '1' || process.env.TEXT_LAYOUT_DEBUG === '1') {
      console.log(textLayoutDiagnostics(
        { ...comp, headline: headlineLayout, caption: captionLayout, outro: outroLayout },
        activeNarrative
      ))
    }

    this.background.draw(ctx, scene, progress, category)
    if (scene.image || scene.backgroundImage || scene.bRoll) {
      await this.hero.draw(ctx, scene, progress)
    }

    if (layout.glassCard) {
      this.glass.draw(ctx, scene, progress, {
        category,
        y: layout.textPosition === 'bottom' ? 0.62 : 0.55,
        // Design-space card heights scaled to the active (16:9) frame.
        height: DesignSystem.sy(layout.textPosition === 'bottom' ? 300 : 250),
        accentLine: layout.accentLine,
        delay: 0.05,
        borderColor: layout.borderPulse ? undefined : 'rgba(255,255,255,0.08)',
      })
    }

    // Narrative text is drawn from the resolved state machine + authoritative
    // layouts only — never from independent hard-coded positions.
    const narrative = {
      activeState: activeNarrative.state,
      opacity: activeNarrative.opacity,
      headlineLayout,
      captionLayout,
      outroLayout,
      states: NARRATIVE_STATES,
      timeFrac,
    }

    // The narrative state machine guarantees HEADLINE / CAPTION / OUTRO are
    // never both >40% opacity at a frame: headline and spoken caption replace
    // each other in time instead of stacking in the same center-stage region.
    if (owned('headline') && activeNarrative.state === 'HEADLINE') {
      await this.info.draw(ctx, scene, progress, category, timeline, time, narrative)
    } else if (owned('headline') && (scene.outro || scene.type === 'close' || scene.type === 'brand_close')) {
      // Outro scenes draw their brand-close stack through InformationLayer.
      await this.info.draw(ctx, scene, progress, category, timeline, time, narrative)
    }
    // Emphasis (AI accent) yields to a visible caption internally (non-hook);
    // hooks schedule it as their own AI phase. Governed by its own timeline.
    if (owned('emphasis') && canRenderText(scene, 'emphasis')) this.emphasis.draw(ctx, scene, progress, category, env('ai'))
    if (owned('caption') && canRenderText(scene, 'caption') && activeNarrative.state === 'CAPTION') {
      // For narration scenes the callout takes over the rear of the caption
      // window (temporal replacement — never both on screen): the spoken
      // caption is suppressed once the callout begins.
      const hasNarrationCallout = !!scene.narration && !!buildCalloutBody(scene) && duration >= CALLOUT_MIN_DURATION &&
        scene.type !== 'close' && scene.type !== 'brand_close' && !scene.outro
      if (!hasNarrationCallout || timeFrac < CAPTION_TO_CALLOUT) {
        this.captions.draw(ctx, scene, progress, wordIndex, env('caption'), narrative)
      }
    }

    // Narration callout sub-state: "WHY IT MATTERS" underlined + 2-line yellow
    // callout. Fires ONLY in scenes that carry audio narration (the spoken
    // sentence drives it), and ONLY in the rear of the caption window — so it
    // TEMPORALLY REPLACES the spoken-sentence caption rather than stacking with
    // it (the same one-active-narrative-text block rule). It bridges the
    // narration toward the outro. Gated to `timeFrac >= CAPTION_TO_CALLOUT` so
    // the caption is read first, then gives way to the label + callout.
    if (
      scene.narration &&
      activeNarrative.state === 'CAPTION' &&
      timeFrac >= CAPTION_TO_CALLOUT &&
      duration >= CALLOUT_MIN_DURATION &&
      !scene.outro && scene.type !== 'close' && scene.type !== 'brand_close'
    ) {
      const calloutBody = buildCalloutBody(scene)
      if (calloutBody) {
        const labelT = Math.min(1, Math.max(0, (timeFrac - CAPTION_TO_CALLOUT) / 0.12))
        const calloutP = Math.min(1, Math.max(0, (timeFrac - CAPTION_TO_CALLOUT - 0.12) / 0.10))
        this.callout.draw(ctx, scene, calloutP, labelT, calloutBody)
      }
    }

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
    // During OUTRO the end-card brand stack owns the frame, so the top-left
    // brand bug is suppressed (the footer chrome still draws above post).
    this.branding.drawBug(ctx, scene, narrative.activeState)
  }
}

// Build the 2-line yellow callout body for a narration scene.
// Returns e.g. "STOCK FUTURES FALL\nWHILE BONDS SURGE" (capped at 2 lines /
// 12 words), or '' when the scene has nothing suitable.
// The callout is derived from the scene's own narration/headline text so it is
// NEVER invented content — it re-uses the already-authored story words.
function buildCalloutBody(scene) {
  const MAX_WORDS = 12
  const MAX_LINES = 2
  // Prefer an explicit callout, else derive from the visual headline, else the
  // scene subheadline. Never fall back to an empty narration.
  const seed = (scene.callout || scene.text || scene.subheadline || '').trim()
  if (!seed) return ''
  // Take the first sentence (stop at punctuation) and cap at MAX_WORDS.
  const firstSentence = seed.split(/[.!?]+/)[0].trim()
  const words = firstSentence.split(/\s+/).filter(Boolean)
  const capped = words.slice(0, MAX_WORDS)
  if (!capped.length) return ''
  // Wrap into 2 lines: split roughly in half by word count.
  const mid = Math.ceil(capped.length / 2)
  const line1 = capped.slice(0, mid).join(' ')
  const line2 = capped.slice(mid).join(' ')
  return [line1, line2].filter(Boolean).join('\n')
}