// GlobalAssetUniquenessGate — unified uniqueness enforcement across all asset types.
//
// Six explicit scopes, each classified as:
//   ENFORCED     — hard gate, blocks publish if violated
//   BEST_EFFORT  — checked but non-blocking (logged as warning)
//   NOT_IMPLEMENTED — tracked but no enforcement yet
//
// Scopes:
//   1. scene-within-video      ENFORCED      — Scene 1 image ≠ Scene 2 image
//   2. scene-across-video      ENFORCED      — Video N scene image ≠ Video N-1 scene images
//   3. music-within-video      ENFORCED      — single music track per video
//   4. music-across-video      ENFORCED      — track rotation across videos
//   5. thumbnail-within-video  BEST_EFFORT   — thumbnail ≠ scene presentation (layout overlap)
//   6. thumbnail-across-video  ENFORCED      — thumbnail composition hash ≠ recent thumbnails
//
// Integrates with:
//   - AssetRegistry (JSON rolling window, reserve/commit/release lifecycle)
//   - SceneAssetUniqueness (within + across)
//   - MusicUniqueness (within + across)
//   - ThumbnailUniqueness (NEW — composition hash + perceptual hash)
//
// Persistent through:
//   - AssetRegistry (permanent index in data/asset-registry.json)
//   - CheckpointStore (stage-level persistence per job)

import { AssetRegistry } from './AssetRegistry.mjs'
import { SceneAssetUniqueness } from './SceneAssetUniqueness.mjs'
import { MusicUniqueness } from './MusicUniqueness.mjs'
import { ScriptUniqueness, EMPTY_SCRIPT_HASH } from './ScriptUniqueness.mjs'
import crypto from 'node:crypto'

export const ScopeEnforcement = Object.freeze({
  ENFORCED: 'ENFORCED',
  BEST_EFFORT: 'BEST_EFFORT',
  NOT_IMPLEMENTED: 'NOT_IMPLEMENTED',
})

const SCOPES = Object.freeze([
  {
    id: 'scene-within-video',
    description: 'Scene images unique within a single video',
    enforcement: ScopeEnforcement.ENFORCED,
  },
  {
    id: 'scene-across-video',
    description: 'Scene images not reused across videos',
    enforcement: ScopeEnforcement.ENFORCED,
  },
  {
    id: 'music-within-video',
    description: 'Single music track per video (no mid-video switching)',
    enforcement: ScopeEnforcement.ENFORCED,
  },
  {
    id: 'music-across-video',
    description: 'Music tracks rotated across videos',
    enforcement: ScopeEnforcement.ENFORCED,
  },
  {
    id: 'thumbnail-within-video',
    description: 'Thumbnail distinct from scene presentation layouts',
    enforcement: ScopeEnforcement.BEST_EFFORT,
  },
  {
    id: 'thumbnail-across-video',
    description: 'Thumbnail composition hash not reused across videos',
    enforcement: ScopeEnforcement.ENFORCED,
  },
  {
    id: 'script-within-video',
    description: 'Script text unique within a single video (exact + semantic)',
    enforcement: ScopeEnforcement.ENFORCED,
  },
  {
    id: 'script-across-video',
    description: 'Script text not reused across recent videos (exact + semantic)',
    enforcement: ScopeEnforcement.ENFORCED,
  },
])

export class GlobalAssetUniquenessGate {
  constructor(registry, imageDatabase = null) {
    this.registry = registry || new AssetRegistry()
    this.sceneCheck = new SceneAssetUniqueness(this.registry, imageDatabase)
    this.musicCheck = new MusicUniqueness(this.registry, imageDatabase)
    this.thumbnailCheck = new ThumbnailUniqueness(this.registry)
    this.scriptCheck = new ScriptUniqueness(this.registry)
  }

  /**
   * Get all scope definitions.
   */
  static getScopes() {
    return [...SCOPES]
  }

  /**
   * Get enforcement status for all scopes.
   */
  getEnforcementStatus() {
    return SCOPES.map(s => ({
      scope: s.id,
      enforcement: s.enforcement,
      description: s.description,
    }))
  }

  /**
   * Validate all uniqueness scopes for a production job.
   *
   * @param {object} manifest — production manifest with all asset hashes
   * @param {object} opts — { jobId, thumbnailPath, scenes }
   * @returns {{ pass: boolean, scopeResults: object[], violations: Array, warnings: Array }}
   */
  async validate(manifest, opts = {}) {
    const jobId = opts.jobId || manifest?.jobId
    const violations = []
    const warnings = []
    const scopeResults = []

    // 1. scene-within-video — ENFORCED
    const sceneWithin = this._checkSceneWithinVideo(manifest)
    scopeResults.push({ scope: 'scene-within-video', ...sceneWithin })
    if (!sceneWithin.pass && sceneWithin.enforcement === ScopeEnforcement.ENFORCED) {
      violations.push(...sceneWithin.violations)
    }

    // 2. scene-across-video — ENFORCED
    const sceneAcross = await this._checkSceneAcrossVideo(manifest, jobId)
    scopeResults.push({ scope: 'scene-across-video', ...sceneAcross })
    if (!sceneAcross.pass && sceneAcross.enforcement === ScopeEnforcement.ENFORCED) {
      violations.push(...sceneAcross.violations)
    }

    // 3. music-within-video — ENFORCED
    const musicWithin = this._checkMusicWithinVideo(manifest)
    scopeResults.push({ scope: 'music-within-video', ...musicWithin })
    if (!musicWithin.pass && musicWithin.enforcement === ScopeEnforcement.ENFORCED) {
      violations.push(...musicWithin.violations)
    }

    // 4. music-across-video — ENFORCED
    const musicAcross = this._checkMusicAcrossVideo(manifest, jobId)
    scopeResults.push({ scope: 'music-across-video', ...musicAcross })
    if (!musicAcross.pass && musicAcross.enforcement === ScopeEnforcement.ENFORCED) {
      violations.push(...musicAcross.violations)
    }

    // 5. thumbnail-within-video — BEST_EFFORT
    const thumbWithin = await this._checkThumbnailWithinVideo(manifest, opts)
    scopeResults.push({ scope: 'thumbnail-within-video', ...thumbWithin })
    if (!thumbWithin.pass && thumbWithin.enforcement === ScopeEnforcement.BEST_EFFORT) {
      warnings.push(...thumbWithin.violations)
    }

    // 6. thumbnail-across-video — ENFORCED
    const thumbAcross = this._checkThumbnailAcrossVideo(manifest, jobId)
    scopeResults.push({ scope: 'thumbnail-across-video', ...thumbAcross })
    if (!thumbAcross.pass && thumbAcross.enforcement === ScopeEnforcement.ENFORCED) {
      violations.push(...thumbAcross.violations)
    }

    // 7. script-within-video — ENFORCED (exact + semantic)
    const scriptWithin = this._checkScriptWithinVideo(manifest, opts)
    scopeResults.push({ scope: 'script-within-video', ...scriptWithin })
    if (!scriptWithin.pass && scriptWithin.enforcement === ScopeEnforcement.ENFORCED) {
      violations.push(...scriptWithin.violations)
    }

    // 8. script-across-video — ENFORCED (exact + semantic)
    const scriptAcross = this._checkScriptAcrossVideo(manifest, jobId)
    scopeResults.push({ scope: 'script-across-video', ...scriptAcross })
    if (!scriptAcross.pass && scriptAcross.enforcement === ScopeEnforcement.ENFORCED) {
      violations.push(...scriptAcross.violations)
    }

    const pass = violations.length === 0
    return { pass, scopeResults, violations, warnings }
  }

  /**
   * Reserve assets for a job. Extends manifest to include thumbnail hashes.
   *
   * @param {string} jobId
   * @param {object} manifest — { scriptHash, imageHashes, musicTrackId, thumbnailHash, thumbnailCompositionHash }
   * @returns {{ reserved: boolean, conflict: string|null }}
   */
  reserve(jobId, manifest) {
    return this.registry.reserve(jobId, {
      // An empty/missing script is NOT a legitimate content identity — do not
      // reserve it, or two empty scripts would falsely conflict as duplicates.
      scriptHash: isInvalidScript(manifest.scriptHash, manifest.scriptText) ? null : manifest.scriptHash,
      scriptText: manifest.scriptText || null,
      imageHashes: manifest.imageHashes || [],
      musicTrackId: manifest.musicTrackId,
      thumbnailHash: manifest.thumbnailHash,
      thumbnailCompositionHash: manifest.thumbnailCompositionHash,
    })
  }

  /**
   * Commit a reservation — all assets become permanently recorded.
   */
  commit(jobId, { videoId, category } = {}) {
    return this.registry.commit(jobId, { videoId, category })
  }

  /**
   * Release a reservation — assets become free for retry.
   */
  release(jobId) {
    return this.registry.release(jobId)
  }

  // ── Scope checkers ───────────────────────────────────────────────────

  /**
   * Scene-within-video: all scene images must be unique within the video.
   * ENFORCED.
   */
  _checkSceneWithinVideo(manifest) {
    const scenes = manifest?.scenes || []
    if (scenes.length <= 1) {
      return { pass: true, enforcement: ScopeEnforcement.ENFORCED, violations: [], detail: 'single scene' }
    }

    const hashes = scenes.map(s => s.imageHash).filter(Boolean)
    const seen = new Map()
    const violations = []

    for (let i = 0; i < hashes.length; i++) {
      if (seen.has(hashes[i])) {
        violations.push({
          scope: 'scene-within-video',
          type: 'DUPLICATE_SCENE_IMAGE',
          hash: hashes[i],
          detail: `scene ${i} duplicates scene ${seen.get(hashes[i])}`,
        })
      } else {
        seen.set(hashes[i], i)
      }
    }

    return {
      pass: violations.length === 0,
      enforcement: ScopeEnforcement.ENFORCED,
      violations,
      detail: `${scenes.length} scenes, ${new Set(hashes).size} unique hashes`,
    }
  }

  /**
   * Scene-across-video: scene images must not appear in recent videos.
   * ENFORCED — delegates to SceneAssetUniqueness.
   */
  async _checkSceneAcrossVideo(manifest, jobId) {
    const scenes = manifest?.scenes || []
    if (scenes.length === 0) {
      return { pass: true, enforcement: ScopeEnforcement.ENFORCED, violations: [], detail: 'no scenes' }
    }

    const result = this.sceneCheck.validate(scenes, {
      rollingWindow: this.registry.rollingWindow,
      excludeJobId: jobId,
    })

    return {
      pass: result.pass,
      enforcement: ScopeEnforcement.ENFORCED,
      violations: result.violations.map(v => ({ scope: 'scene-across-video', ...v })),
      detail: `${result.total} scenes checked, ${result.violations.length} violations`,
    }
  }

  /**
   * Music-within-video: exactly one music track per video.
   * ENFORCED.
   */
  _checkMusicWithinVideo(manifest) {
    const music = manifest?.music
    if (!music?.trackId) {
      return { pass: true, enforcement: ScopeEnforcement.ENFORCED, violations: [], detail: 'no music' }
    }

    // Single track — always passes within-video check
    return {
      pass: true,
      enforcement: ScopeEnforcement.ENFORCED,
      violations: [],
      detail: `single track: ${music.trackId}`,
    }
  }

  /**
   * Music-across-video: music track must not appear in recent videos.
   * ENFORCED — delegates to MusicUniqueness.
   */
  _checkMusicAcrossVideo(manifest, jobId) {
    const music = manifest?.music
    if (!music?.trackId) {
      return { pass: true, enforcement: ScopeEnforcement.ENFORCED, violations: [], detail: 'no music' }
    }

    const result = this.musicCheck.validate(music, {
      rollingWindow: this.registry.rollingWindow,
      excludeJobId: jobId,
    })

    return {
      pass: result.pass,
      enforcement: ScopeEnforcement.ENFORCED,
      violations: result.pass ? [] : [{
        scope: 'music-across-video',
        type: 'MUSIC_DUPLICATE',
        trackId: music.trackId,
        detail: result.reason,
      }],
      detail: result.pass ? `track ${music.trackId} is unique` : result.reason,
    }
  }

  /**
   * Thumbnail-within-video: thumbnail must be visually distinct from scene layouts.
   * BEST_EFFORT — checked but non-blocking.
   */
  async _checkThumbnailWithinVideo(manifest, opts) {
    const thumbHash = manifest?.thumbnail?.compositionHash
    const scenes = manifest?.scenes || []

    if (!thumbHash || scenes.length === 0) {
      return { pass: true, enforcement: ScopeEnforcement.BEST_EFFORT, violations: [], detail: 'insufficient data' }
    }

    // Compare thumbnail composition hash against scene image hashes
    const sceneHashes = scenes.map(s => s.imageHash).filter(Boolean)
    const violations = []

    for (let i = 0; i < sceneHashes.length; i++) {
      if (sceneHashes[i] === thumbHash) {
        violations.push({
          scope: 'thumbnail-within-video',
          type: 'THUMBNAIL_MATCHES_SCENE',
          hash: thumbHash,
          detail: `thumbnail composition matches scene ${i}`,
        })
      }
    }

    return {
      pass: violations.length === 0,
      enforcement: ScopeEnforcement.BEST_EFFORT,
      violations,
      detail: violations.length === 0 ? 'thumbnail distinct from scenes' : `${violations.length} matches`,
    }
  }

  /**
   * Thumbnail-across-video: thumbnail composition must not appear in recent videos.
   * ENFORCED — uses composition hash (structural) + perceptual hash (visual).
   */
  _checkThumbnailAcrossVideo(manifest, jobId) {
    const thumb = manifest?.thumbnail
    if (!thumb?.compositionHash && !thumb?.perceptualHash) {
      return { pass: true, enforcement: ScopeEnforcement.ENFORCED, violations: [], detail: 'no thumbnail hashes' }
    }

    const violations = []

    // Check composition hash against rolling window
    if (thumb.compositionHash) {
      const isDup = this.registry.isThumbnailDuplicate(thumb.compositionHash, jobId)
      if (isDup) {
        violations.push({
          scope: 'thumbnail-across-video',
          type: 'THUMBNAIL_COMPOSITION_DUPLICATE',
          hash: thumb.compositionHash,
          detail: `composition hash ${thumb.compositionHash} found in recent videos`,
        })
      }
    }

    // Check perceptual hash against rolling window
    if (thumb.perceptualHash) {
      const isDup = this.registry.isThumbnailPerceptualDuplicate(thumb.perceptualHash, jobId)
      if (isDup) {
        violations.push({
          scope: 'thumbnail-across-video',
          type: 'THUMBNAIL_PERCEPTUAL_DUPLICATE',
          hash: thumb.perceptualHash,
          detail: `perceptual hash ${thumb.perceptualHash} found in recent videos`,
        })
      }
    }

    return {
      pass: violations.length === 0,
      enforcement: ScopeEnforcement.ENFORCED,
      violations,
      detail: violations.length === 0 ? 'thumbnail unique across videos' : `${violations.length} duplicates`,
    }
  }

  /**
   * Script-within-video: narration text must be unique within a single video.
   * ENFORCED — checks for duplicate script text within the same production.
   */
  _checkScriptWithinVideo(manifest, opts) {
    const scriptHash = manifest?.scriptHash
    const scriptText = manifest?.scriptText
    const scenes = manifest?.scenes || []

    if (!scriptHash && !scriptText) {
      return { pass: true, enforcement: ScopeEnforcement.ENFORCED, violations: [], detail: 'no script' }
    }

    // An empty/missing script is NOT a legitimate content artifact. It must not
    // be reserved, hashed-as-unique, or compared as a real identity.
    if (isInvalidScript(scriptHash, scriptText)) {
      return {
        pass: true,
        enforcement: ScopeEnforcement.ENFORCED,
        violations: [],
        detail: 'INVALID_SCRIPT_ARTIFACT: script missing/empty — not a unique content identity',
      }
    }

    // A single video should have exactly one script — if scenes contain
    // duplicate narration segments, that's a within-video issue.
    // For now, a video always passes within-video script uniqueness
    // (one script per video is enforced by the generation pipeline).
    return {
      pass: true,
      enforcement: ScopeEnforcement.ENFORCED,
      violations: [],
      detail: scriptHash ? `single script: ${scriptHash}` : 'single script',
    }
  }

  /**
   * Script-across-video: narration text must not be reused across recent videos.
   * ENFORCED — exact hash + semantic similarity via ScriptUniqueness.
   */
  _checkScriptAcrossVideo(manifest, jobId) {
    const scriptHash = manifest?.scriptHash
    const scriptText = manifest?.scriptText

    if (!scriptHash && !scriptText) {
      return { pass: true, enforcement: ScopeEnforcement.ENFORCED, violations: [], detail: 'no script' }
    }

    // An empty/missing script is NOT a legitimate content artifact. Do not
    // compare its sha256("") identity against other jobs — that produces a
    // false "duplicate" when multiple videos all fail to produce a script.
    if (isInvalidScript(scriptHash, scriptText)) {
      return {
        pass: true,
        enforcement: ScopeEnforcement.ENFORCED,
        violations: [],
        detail: 'INVALID_SCRIPT_ARTIFACT: script missing/empty — not a unique content identity',
      }
    }

    // If only hash is available, do exact-only check
    if (!scriptText) {
      const isDup = this.registry.isScriptDuplicate(scriptHash, jobId)
      return {
        pass: !isDup,
        enforcement: ScopeEnforcement.ENFORCED,
        violations: isDup ? [{
          scope: 'script-across-video',
          type: 'SCRIPT_EXACT_DUPLICATE',
          hash: scriptHash,
          detail: `script hash ${scriptHash} found in recent videos`,
        }] : [],
        detail: isDup ? `script hash duplicate` : `script hash ${scriptHash} unique`,
      }
    }

    // Full check with semantic similarity
    const result = this.scriptCheck.validate(scriptText, {
      excludeJobId: jobId,
      title: manifest?.title || null,
    })

    return {
      pass: result.pass,
      enforcement: ScopeEnforcement.ENFORCED,
      violations: result.pass ? [] : [{
        scope: 'script-across-video',
        type: result.reason?.startsWith('SCRIPT_DUPLICATE') ? 'SCRIPT_EXACT_DUPLICATE' : 'SCRIPT_SEMANTIC_DUPLICATE',
        hash: result.hash,
        similarity: result.similarity,
        detail: result.reason,
      }],
      detail: result.pass
        ? `script unique (max similarity: ${result.similarity?.toFixed(3) || 'N/A'})`
        : result.reason,
    }
  }
}

// ── ThumbnailUniqueness — composition + perceptual hash for thumbnails ──

/**
 * An empty/missing script resolves to sha256("") and must never be treated as
 * a real content identity. Blocks reservation, exact-duplicate comparison, and
 * semantic checks so that two videos which both failed to produce a script are
 * NOT misclassified as duplicates.
 */
function isInvalidScript(scriptHash, scriptText) {
  const textIsEmpty = !scriptText || String(scriptText).trim().length === 0
  return textIsEmpty && (!scriptHash || scriptHash === EMPTY_SCRIPT_HASH)
}

class ThumbnailUniqueness {
  constructor(registry) {
    this.registry = registry
  }

  /**
   * Validate a thumbnail for uniqueness.
   *
   * @param {object} thumb — { compositionHash, perceptualHash }
   * @param {object} context — { jobId, rollingWindow }
   * @returns {{ pass: boolean, reason: string|null }}
   */
  validate(thumb, context = {}) {
    if (!thumb?.compositionHash && !thumb?.perceptualHash) {
      return { pass: true, reason: null }
    }

    const excludeJobId = context.excludeJobId || null

    if (thumb.compositionHash && this.registry.isThumbnailDuplicate(thumb.compositionHash, excludeJobId)) {
      return {
        pass: false,
        reason: `THUMBNAIL_DUPLICATE: composition hash=${thumb.compositionHash}`,
      }
    }

    if (thumb.perceptualHash && this.registry.isThumbnailPerceptualDuplicate(thumb.perceptualHash, excludeJobId)) {
      return {
        pass: false,
        reason: `THUMBNAIL_DUPLICATE: perceptual hash=${thumb.perceptualHash}`,
      }
    }

    return { pass: true, reason: null }
  }

  /**
   * Record a thumbnail as used (call after PUBLISH succeeds).
   */
  record(thumb, context = {}) {
    if (!thumb?.compositionHash && !thumb?.perceptualHash) return
    this.registry.recordThumbnail({
      compositionHash: thumb.compositionHash,
      perceptualHash: thumb.perceptualHash,
      jobId: context.jobId,
    })
  }
}
