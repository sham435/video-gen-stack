// UniquenessPreflight — pre-publish content uniqueness gate.
//
// Lifecycle: RESERVE → COMMIT → (or RELEASE on failure)
//
//   ProductionUniquenessManifest
//     ↓
//   UniquenessPreflight.validate(manifest)  ← checks committed + other reservations
//     ↓
//   PASS → reserve()  ← locks assets for this job
//     ↓
//   UPLOAD → PUBLISH → VERIFY
//     ↓
//   commit()  ← assets become permanent
//     ↓
//   (on failure) release()  ← assets free for retry
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
   * Excludes the current job's own reservations from duplicate checks.
   *
   * @param {object} manifest — from ProductionUniquenessManifest.build()
   * @param {object} opts — { jobId }
   * @returns {{ pass: boolean, details: object, violations: Array }}
   */
  validate(manifest, { jobId } = {}) {
    const jid = jobId || manifest.jobId
    const violations = []
    const details = {
      script: null,
      scenes: null,
      music: null,
      articleHash: manifest.articleHash,
      jobId: jid,
    }

    // 1. Script uniqueness
    if (manifest.scriptHash) {
      const isDup = this.registry.isScriptDuplicate(manifest.scriptHash, jid)
      details.script = {
        hash: manifest.scriptHash,
        pass: !isDup,
        reason: isDup ? `SCRIPT_DUPLICATE: hash=${manifest.scriptHash}` : null,
      }
      if (isDup) {
        violations.push({ type: 'SCRIPT', hash: manifest.scriptHash, reason: details.script.reason })
      }
    }

    // 2. Scene image uniqueness
    if (manifest.scenes?.length) {
      const sceneResult = this.sceneCheck.validate(manifest.scenes, {
        rollingWindow: this.registry.rollingWindow,
        excludeJobId: jid,
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
        excludeJobId: jid,
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
   * Reserve assets for a job. Called in UNIQUENESS stage after validation passes.
   * Blocks other jobs from using the same assets until commit() or release().
   *
   * @param {object} manifest — the built manifest
   * @param {object} opts — { jobId }
   * @returns {{ reserved: boolean, conflict: string|null }}
   */
  reserve(manifest, { jobId } = {}) {
    const jid = jobId || manifest.jobId
    return this.registry.reserve(jid, {
      scriptHash: manifest.scriptHash,
      imageHashes: manifest.scenes?.map(s => s.imageHash).filter(Boolean) || [],
      musicTrackId: manifest.music?.trackId,
    })
  }

  /**
   * Commit a reservation — assets become permanently recorded.
   * Called in VERIFY stage after upload is confirmed.
   *
   * @param {string} jobId
   * @param {object} opts — { videoId, category }
   */
  commit(jobId, { videoId, category } = {}) {
    return this.registry.commit(jobId, { videoId, category })
  }

  /**
   * Release a reservation — assets become free for retry.
   * Called on UPLOAD/PUBLISH/VERIFY failure.
   *
   * @param {string} jobId
   */
  release(jobId) {
    return this.registry.release(jobId)
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
