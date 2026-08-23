// UniquenessPreflight — pre-publish content uniqueness gate.
//
// A production job CANNOT reach PUBLISH unless its uniqueness manifest passes.
// This is the missing layer that turns "we generate different things most of
// the time" into an actual production invariant.
//
// Architecture:
//
//   ProductionUniquenessManifest
//     ↓
//   UniquenessPreflight.validate(manifest)
//     ↓
//   ┌──────────────┬──────────────┐
//   │  PASS        │  FAIL        │
//   │  ↓           │  ↓           │
//   │  PUBLISH     │  REGENERATE  │
//   │              │    ↓         │
//   │              │  revalidate  │
//   └──────────────┴──────────────┘
//
// At 48/day, uniqueness cannot depend on randomness. This gate
// enforces deterministic asset separation across all production runs.

import { ScriptUniqueness } from './ScriptUniqueness.mjs'
import { SceneAssetUniqueness } from './SceneAssetUniqueness.mjs'
import { MusicUniqueness } from './MusicUniqueness.mjs'

export class UniquenessPreflight {
  constructor(registry, imageDatabase = null) {
    this.registry = registry
    this.scriptCheck = new ScriptUniqueness(registry)
    this.sceneCheck = new SceneAssetUniqueness(registry, imageDatabase)
    this.musicCheck = new MusicUniqueness(registry, imageDatabase)
  }

  /**
   * Validate a full production manifest for uniqueness.
   *
   * @param {object} manifest — from ProductionUniquenessManifest.build()
   * @returns {{ pass: boolean, details: object, violations: Array }}
   */
  validate(manifest) {
    const violations = []
    const details = {
      script: null,
      scenes: null,
      music: null,
      articleHash: manifest.articleHash,
      jobId: manifest.jobId,
    }

    // 1. Script uniqueness
    if (manifest.scriptHash) {
      const scriptEntry = this.registry.state.scripts[manifest.scriptHash]
      const isDup = this.registry.isScriptDuplicate(manifest.scriptHash)
      details.script = {
        hash: manifest.scriptHash,
        pass: !isDup,
        reason: isDup ? `SCRIPT_DUPLICATE: hash=${manifest.scriptHash}` : null,
      }
      if (isDup) {
        violations.push({
          type: 'SCRIPT',
          hash: manifest.scriptHash,
          reason: details.script.reason,
          duplicateOf: scriptEntry,
        })
      }
    }

    // 2. Scene image uniqueness
    if (manifest.scenes?.length) {
      const sceneResult = this.sceneCheck.validate(manifest.scenes, {
        rollingWindow: this.registry.rollingWindow,
      })
      details.scenes = {
        total: sceneResult.total,
        pass: sceneResult.pass,
        violations: sceneResult.violations,
      }
      violations.push(...sceneResult.violations.map(v => ({ type: 'SCENE_IMAGE', ...v })))
    }

    // 3. Music uniqueness
    if (manifest.music?.trackId) {
      const musicResult = this.musicCheck.validate(manifest.music, {
        rollingWindow: this.registry.rollingWindow,
      })
      details.music = {
        trackId: manifest.music.trackId,
        pass: musicResult.pass,
        reason: musicResult.reason,
      }
      if (!musicResult.pass) {
        violations.push({
          type: 'MUSIC',
          trackId: manifest.music.trackId,
          reason: musicResult.reason,
          duplicateOf: musicResult.duplicateOf,
        })
      }
    }

    const pass = violations.length === 0
    return { pass, details, violations }
  }

  /**
   * Record all assets from a manifest as used (call after PUBLISH succeeds).
   * This prevents the same assets from being reused in subsequent runs.
   */
  record(manifest, narrationText) {
    const ctx = {
      articleHash: manifest.articleHash,
      jobId: manifest.jobId,
    }

    // Record script
    if (narrationText) {
      this.scriptCheck.record(narrationText, ctx)
    }

    // Record scene images
    if (manifest.scenes?.length) {
      this.sceneCheck.record(manifest.scenes, ctx)
    }

    // Record music
    if (manifest.music?.trackId) {
      this.musicCheck.record(manifest.music, ctx)
    }

    // Record the full video in the rolling window
    this.registry.recordPublishedVideo(
      `job-${manifest.jobId}`,
      {
        scriptHash: manifest.scriptHash,
        imageHashes: manifest.scenes?.map(s => s.imageHash).filter(Boolean) || [],
        musicTrackId: manifest.music?.trackId,
        articleHash: manifest.articleHash,
        jobId: manifest.jobId,
      }
    )
  }

  /**
   * Convenience: build a manifest from pipeline context.
   * The caller must import ProductionUniquenessManifest separately
   * to avoid circular deps.
   */
  static buildManifest(ProductionUniquenessManifest, { article, narrationText, scenes, music, thumbnail, jobId }) {
    const manifest = new ProductionUniquenessManifest()
      .setArticle(article)
      .setScript(narrationText)
      .setJobId(jobId)

    if (scenes?.length) {
      for (const s of scenes) {
        manifest.addScene(s.id || s.sceneIndex, {
          imageHash: s.imageHash || s.heroImageHash || null,
          sourceId: s.imageSource || s.sourceId || null,
          headline: s.headline || s.caption || null,
        })
      }
    }

    if (music) {
      manifest.setMusic(music.trackId || music.track, {
        trackHash: music.trackHash || null,
        family: music.family || null,
      })
    }

    if (thumbnail) {
      manifest.setThumbnail(thumbnail.hash || thumbnail.artifactHash || null)
    }

    return manifest.build()
  }
}
