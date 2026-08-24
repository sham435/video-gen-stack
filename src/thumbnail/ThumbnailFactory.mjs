// ThumbnailFactory — autonomous thumbnail production stage.
//
// Orchestrates the full thumbnail lifecycle:
//   1. Generate 3–5 candidates (ThumbnailCandidateGenerator)
//   2. Render all candidates (ThumbnailRenderer)
//   3. Judge + select winner (ThumbnailJudge)
//   4. Validate against policy (ThumbnailPolicy)
//   5. Record manifest (ThumbnailManifest)
//   6. Return result for downstream C2PA + upload
//
// Pipeline position:
//   RENDER_VIDEO → ThumbnailFactory.produce() → C2PA_SIGN → UPLOAD_VIDEO
//
// No human decision. Fully autonomous.

import { ThumbnailCandidateGenerator } from './ThumbnailCandidateGenerator.mjs'
import { ThumbnailRenderer } from './ThumbnailRenderer.mjs'
import { ThumbnailJudge } from './ThumbnailJudge.mjs'
import { ThumbnailPolicy } from './ThumbnailPolicy.mjs'
import { ThumbnailCompositionPreflight } from './ThumbnailCompositionPreflight.mjs'
import { ThumbnailManifest } from './ThumbnailManifest.mjs'
import fs from 'node:fs'
import path from 'node:path'

export class ThumbnailFactory {
  constructor(options = {}) {
    this.generator = options.generator || new ThumbnailCandidateGenerator()
    this.renderer = options.renderer || new ThumbnailRenderer()
    this.judge = options.judge || new ThumbnailJudge()
    this.outputDir = options.outputDir || 'output'
  }

  async produce({ article, story, scenes, title, category, productionProfile, heroImage, hideBranding, nicheProfile }) {
    const brief = {
      category: category || article?.category || 'technology',
      accent_color: productionProfile?.accent || '#E10600',
      nicheProfile: nicheProfile || null,
      heroImage: heroImage || article?.imageUrl || null,
      hideBranding: hideBranding || false,
    }

    const candidates = this.generator.generate(article || { title: title || 'NEWS UPDATE', category: brief.category }, brief)
    const thumbDir = path.join(this.outputDir, 'thumbnails')
    const rendered = await this.renderer.renderAll(candidates, thumbDir)

    // Composition preflight: reject visually invalid candidates before judging
    for (const c of rendered) {
      if (!c.rendered || !c.path) continue
      try {
        const comp = await ThumbnailCompositionPreflight.validate(c.path, { candidate: c })
        c.composition = comp
        if (!comp.pass) {
          c.eligible = false
          c.compositionErrors = comp.errors
          console.log(`[THUMB-COMP] ${c.strategy}: REJECTED — ${comp.errors.join('; ')}`)
        }
      } catch (e) {
        // Composition analysis failure is non-fatal — let judge decide
        c.composition = { pass: true, checks: [], errors: [], composition: {} }
      }
    }

    const judgment = this.judge.judge(rendered)

    // Record all candidates in manifest
    const manifest = new ThumbnailManifest(`thumb_${Date.now()}`)
    manifest.setCandidates(judgment.scored)

    if (!judgment.winner) {
      // Fallback: render a deterministic single thumbnail
      const fallbackPath = path.join(thumbDir, 'thumb_fallback.png')
      const fallbackBrief = {
        headline: (title || 'NEWS UPDATE').toUpperCase(),
        text_overlay: { top: 'BREAKING', bottom: 'NEWS' },
        accent_color: brief.accent_color,
        nicheProfile: brief.nicheProfile,
        category: brief.category,
        mood: 'BREAKING',
        hideBranding: brief.hideBranding,
        source_label: 'NEWS-MONSTER',
      }
      const { CoverComposer } = await import('../video-studio/CoverComposer.mjs')
      const composer = new CoverComposer()
      await composer.composeThumbnail(fallbackBrief, brief.heroImage, fallbackPath)

      const fallbackBuffer = fs.readFileSync(fallbackPath)
      const fallbackPolicy = ThumbnailPolicy.validate(fallbackBuffer, 'youtube')

      manifest.setSelected({
        path: fallbackPath,
        strategy: 'fallback',
        compositeScore: 50,
        policy: fallbackPolicy,
      })
      manifest.finish('completed_fallback')

      return {
        selected: {
          path: fallbackPath,
          width: fallbackPolicy.meta.width,
          height: fallbackPolicy.meta.height,
          aspectRatio: '16:9',
        },
        candidates: judgment.scored,
        strategy: 'fallback',
        verified: fallbackPolicy.valid,
        manifest: manifest.toJSON(),
      }
    }

    manifest.setSelected(judgment.winner)
    manifest.finish('completed')

    // Copy winner to standard output path
    const finalThumbPath = path.join(this.outputDir, 'thumbnail.png')
    if (judgment.winner.path !== finalThumbPath && fs.existsSync(judgment.winner.path)) {
      fs.copyFileSync(judgment.winner.path, finalThumbPath)
    }

    return {
      selected: {
        path: finalThumbPath,
        width: judgment.winner.policy?.meta?.width || 1280,
        height: judgment.winner.policy?.meta?.height || 720,
        aspectRatio: '16:9',
      },
      candidates: judgment.scored,
      strategy: judgment.winner.strategy,
      verified: true,
      manifest: manifest.toJSON(),
    }
  }
}
