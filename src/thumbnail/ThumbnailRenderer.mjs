// ThumbnailRenderer — renders thumbnail candidates to disk.
//
// Wraps CoverComposer.composeThumbnail() with batch rendering for
// multiple candidates. Each candidate is rendered to a separate file.
// Deterministic: same input → same output.

import { CoverComposer } from '../video-studio/CoverComposer.mjs'
import fs from 'node:fs'
import path from 'node:path'

export class ThumbnailRenderer {
  constructor(options = {}) {
    this.composer = options.composer || new CoverComposer()
  }

  async renderAll(candidates, outputDir) {
    fs.mkdirSync(outputDir, { recursive: true })
    const results = []

    for (const candidate of candidates) {
      const outPath = path.join(outputDir, `thumb_${candidate.strategy}.png`)
      try {
        const brief = {
          headline: candidate.headline,
          text_overlay: candidate.text_overlay,
          accent_color: candidate.accent_color,
          nicheProfile: candidate.nicheProfile,
          category: candidate.category,
          mood: candidate.mood,
          hideBranding: candidate.hideBranding,
          _pillar: candidate._pillar || null,
          source_label: candidate.source_label || 'NEWS-MONSTER',
        }
        await this.composer.composeThumbnail(brief, candidate.heroImage, outPath)
        results.push({ ...candidate, path: outPath, rendered: true })
      } catch (e) {
        results.push({ ...candidate, path: null, rendered: false, error: e.message })
      }
    }

    return results
  }

  async renderOne(candidate, outputDir) {
    fs.mkdirSync(outputDir, { recursive: true })
    const outPath = path.join(outputDir, `thumb_${candidate.strategy}.png`)
    const brief = {
      headline: candidate.headline,
      text_overlay: candidate.text_overlay,
      accent_color: candidate.accent_color,
      nicheProfile: candidate.nicheProfile,
      category: candidate.category,
      mood: candidate.mood,
      hideBranding: candidate.hideBranding,
      _pillar: candidate._pillar || null,
      source_label: candidate.source_label || 'NEWS-MONSTER',
    }
    await this.composer.composeThumbnail(brief, candidate.heroImage, outPath)
    return { ...candidate, path: outPath, rendered: true }
  }
}
