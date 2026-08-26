// AssetRegistry — rolling inventory of all production assets.
//
// Tracks scripts, images, and music with deterministic hashes.
// Assets age out after ROLLING_WINDOW (default 50 published videos).
// At 48/day, uniqueness cannot depend on randomness — this registry
// is the single source of truth for "was this asset used before?"
//
// Lifecycle: RESERVE → COMMIT → (or RELEASE on failure)
//
// A reservation locks assets for a job between UNIQUENESS and VERIFY.
// If VERIFY succeeds, the reservation is committed to the permanent index.
// If the job fails at any point, the reservation is released so assets
// can be retried without false-positive duplicate detection.
//
// Persisted as JSON (same pattern as ProviderBudgets/ResourceGovernor).

import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'

const DEFAULT_REGISTRY_PATH = path.resolve(process.cwd(), 'data', 'asset-registry.json')
const ROLLING_WINDOW = 50

export class AssetRegistry {
  constructor(options = {}) {
    this.filePath = options.filePath || DEFAULT_REGISTRY_PATH
    this.rollingWindow = options.rollingWindow || ROLLING_WINDOW
    this.state = this._load()
  }

  _load() {
    try {
      if (fs.existsSync(this.filePath)) return JSON.parse(fs.readFileSync(this.filePath, 'utf-8'))
    } catch { /* corrupt file — reset */ }
    return { scripts: {}, images: {}, music: {}, thumbnails: {}, publishedVideos: [], reservations: {} }
  }

  _save() {
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true })
    fs.writeFileSync(this.filePath, JSON.stringify(this.state, null, 2))
  }

  // ── Reservation lifecycle ──────────────────────────────────────────────

  /**
   * Reserve assets for a job. Blocks other jobs from using the same assets
   * until commit() or release() is called.
   *
   * @param {string} jobId
   * @param {object} manifest — { scriptHash, imageHashes: string[], musicTrackId }
   * @returns {{ reserved: boolean, conflict: string|null }}
   */
  reserve(jobId, manifest) {
    if (!jobId) throw new Error('reserve() requires a jobId')
    if (!manifest?.scriptHash && !manifest?.imageHashes?.length && !manifest?.musicTrackId && !manifest?.thumbnailHash && !manifest?.thumbnailCompositionHash) {
      return { reserved: true, conflict: null }
    }

    // Check for conflicts BEFORE reserving
    const conflict = this._checkReservationConflict(manifest, jobId)
    if (conflict) return { reserved: false, conflict }

    this.state.reservations[jobId] = {
      scriptHash: manifest.scriptHash || null,
      scriptText: manifest.scriptText || null,
      imageHashes: manifest.imageHashes || [],
      musicTrackId: manifest.musicTrackId || null,
      thumbnailHash: manifest.thumbnailHash || null,
      thumbnailCompositionHash: manifest.thumbnailCompositionHash || null,
      reservedAt: new Date().toISOString(),
    }
    this._save()
    return { reserved: true, conflict: null }
  }

  /**
   * Commit a reservation — assets become permanently recorded.
   * Called after VERIFY succeeds.
   */
  commit(jobId, { videoId, category } = {}) {
    const res = this.state.reservations[jobId]
    if (!res) return false

    // Record to permanent indexes
    if (res.scriptHash) {
      this._recordScript(res.scriptHash, { jobId, text: res.scriptText || null })
    }
    for (const h of res.imageHashes) {
      this._recordImage(h, { jobId })
    }
    if (res.musicTrackId) {
      this._recordMusic(res.musicTrackId, { jobId })
    }
    if (res.thumbnailHash || res.thumbnailCompositionHash) {
      this._recordThumbnail({
        compositionHash: res.thumbnailCompositionHash || res.thumbnailHash,
        perceptualHash: res.thumbnailHash,
      }, { jobId })
    }

    // Record the published video in the rolling window
    this.state.publishedVideos.push({
      videoId: videoId || `job-${jobId}`,
      scriptHash: res.scriptHash,
      scriptText: res.scriptText || null,
      imageHashes: res.imageHashes,
      musicTrackId: res.musicTrackId,
      thumbnailCompositionHash: res.thumbnailCompositionHash || null,
      thumbnailPerceptualHash: res.thumbnailHash || null,
      jobId,
      category: category || null,
      publishedAt: new Date().toISOString(),
    })
    if (this.state.publishedVideos.length > this.rollingWindow) {
      this.state.publishedVideos = this.state.publishedVideos.slice(-this.rollingWindow)
    }

    // Remove reservation
    delete this.state.reservations[jobId]
    this._save()
    return true
  }

  /**
   * Release a reservation — assets become free for retry.
   * Called on UPLOAD/PUBLISH/VERIFY failure.
   */
  release(jobId) {
    if (this.state.reservations[jobId]) {
      delete this.state.reservations[jobId]
      this._save()
    }
  }

  /**
   * List all active reservations (for crash recovery reconciliation).
   */
  listReservations() {
    return { ...this.state.reservations }
  }

  /**
   * Check if any asset in a manifest conflicts with an existing reservation
   * from a DIFFERENT job.
   */
  _checkReservationConflict(manifest, excludeJobId) {
    for (const [jid, res] of Object.entries(this.state.reservations)) {
      if (jid === excludeJobId) continue

      if (manifest.scriptHash && res.scriptHash === manifest.scriptHash) {
        return `SCRIPT reserved by job ${jid}`
      }
      if (manifest.musicTrackId && res.musicTrackId === manifest.musicTrackId) {
        return `MUSIC reserved by job ${jid}`
      }
      if (manifest.imageHashes?.length && res.imageHashes?.length) {
        const overlap = manifest.imageHashes.filter(h => res.imageHashes.includes(h))
        if (overlap.length > 0) {
          return `IMAGE ${overlap[0]} reserved by job ${jid}`
        }
      }
      if (manifest.thumbnailHash && res.thumbnailHash === manifest.thumbnailHash) {
        return `THUMBNAIL reserved by job ${jid}`
      }
      if (manifest.thumbnailCompositionHash && res.thumbnailCompositionHash === manifest.thumbnailCompositionHash) {
        return `THUMBNAIL_COMPOSITION reserved by job ${jid}`
      }
    }
    return null
  }

  // ── Script tracking (committed) ────────────────────────────────────────

  _recordScript(hash, { jobId, title, text } = {}) {
    const existing = this.state.scripts[hash]
    this.state.scripts[hash] = {
      firstUsed: existing?.firstUsed || new Date().toISOString(),
      lastUsed: new Date().toISOString(),
      jobId: jobId || null,
      title: title || null,
      text: text || existing?.text || null,
      usageCount: (existing?.usageCount || 0) + 1,
    }
  }

  /**
   * Public convenience: record a script directly (for testing / one-off use).
   * Prefer reserve() + commit() for production pipeline.
   */
  recordScript(hash, opts) {
    this._recordScript(hash, opts)
    this._save()
  }

  /**
   * Check if a script hash was used within the rolling window.
   * Returns true if in committed publishedVideos OR reserved by another job.
   */
  isScriptDuplicate(hash, excludeJobId = null) {
    if (this.state.publishedVideos.slice(-this.rollingWindow).some(v => v.scriptHash === hash)) {
      return true
    }
    // Check reservations from other jobs
    for (const [jid, res] of Object.entries(this.state.reservations)) {
      if (jid === excludeJobId) continue
      if (res.scriptHash === hash) return true
    }
    return false
  }

  /**
   * Age out scripts not used in the last `windowSize` published videos.
   */
  ageOutScripts(windowSize) {
    const window = windowSize || this.rollingWindow
    const recentScriptHashes = new Set(
      this.state.publishedVideos.slice(-window).map(v => v.scriptHash).filter(Boolean)
    )
    let removed = 0
    for (const [hash] of Object.entries(this.state.scripts)) {
      if (!recentScriptHashes.has(hash)) {
        delete this.state.scripts[hash]
        removed++
      }
    }
    if (removed > 0) this._save()
    return removed
  }

  // ── Image tracking (committed) ─────────────────────────────────────────

  _recordImage(hash, { jobId } = {}) {
    const existing = this.state.images[hash]
    this.state.images[hash] = {
      firstUsed: existing?.firstUsed || new Date().toISOString(),
      lastUsed: new Date().toISOString(),
      jobId: jobId || null,
      usageCount: (existing?.usageCount || 0) + 1,
    }
  }

  /**
   * Public convenience: record an image directly (for testing / one-off use).
   */
  recordImage(hash, opts) {
    this._recordImage(hash, opts)
    this._save()
  }

  /**
   * Check if an image hash was used within the rolling window.
   * Returns true if in committed publishedVideos OR reserved by another job.
   */
  isImageDuplicate(hash, excludeJobId = null) {
    if (this.state.publishedVideos.slice(-this.rollingWindow).some(v => v.imageHashes?.includes(hash))) {
      return true
    }
    for (const [jid, res] of Object.entries(this.state.reservations)) {
      if (jid === excludeJobId) continue
      if (res.imageHashes?.includes(hash)) return true
    }
    return false
  }

  // ── Music tracking (committed) ─────────────────────────────────────────

  _recordMusic(trackId, { trackHash, family, jobId } = {}) {
    const existing = this.state.music[trackId]
    this.state.music[trackId] = {
      firstUsed: existing?.firstUsed || new Date().toISOString(),
      lastUsed: new Date().toISOString(),
      trackHash: trackHash || null,
      family: family || null,
      jobId: jobId || null,
      usageCount: (existing?.usageCount || 0) + 1,
    }
  }

  /**
   * Public convenience: record a music track directly (for testing / one-off use).
   */
  recordMusic(trackId, opts) {
    this._recordMusic(trackId, opts)
    this._save()
  }

  /**
   * Check if a music track was used within the rolling window.
   * Returns true if in committed publishedVideos OR reserved by another job.
   */
  isMusicDuplicate(trackId, excludeJobId = null) {
    if (this.state.publishedVideos.slice(-this.rollingWindow).some(v => v.musicTrackId === trackId)) {
      return true
    }
    for (const [jid, res] of Object.entries(this.state.reservations)) {
      if (jid === excludeJobId) continue
      if (res.musicTrackId === trackId) return true
    }
    return false
  }

  // ── Thumbnail tracking (committed) ────────────────────────────────────

  _recordThumbnail({ compositionHash, perceptualHash }, { jobId } = {}) {
    const key = compositionHash || perceptualHash
    if (!key) return
    const existing = this.state.thumbnails[key]
    this.state.thumbnails[key] = {
      compositionHash: compositionHash || null,
      perceptualHash: perceptualHash || null,
      firstUsed: existing?.firstUsed || new Date().toISOString(),
      lastUsed: new Date().toISOString(),
      jobId: jobId || null,
      usageCount: (existing?.usageCount || 0) + 1,
    }
  }

  /**
   * Public convenience: record a thumbnail directly (for testing / one-off use).
   */
  recordThumbnail({ compositionHash, perceptualHash }, opts) {
    this._recordThumbnail({ compositionHash, perceptualHash }, opts)
    this._save()
  }

  /**
   * Check if a thumbnail composition hash was used within the rolling window.
   */
  isThumbnailDuplicate(compositionHash, excludeJobId = null) {
    if (!compositionHash) return false
    if (this.state.publishedVideos.slice(-this.rollingWindow).some(v => v.thumbnailCompositionHash === compositionHash)) {
      return true
    }
    for (const [jid, res] of Object.entries(this.state.reservations)) {
      if (jid === excludeJobId) continue
      if (res.thumbnailCompositionHash === compositionHash) return true
    }
    return false
  }

  /**
   * Check if a thumbnail perceptual hash was used within the rolling window.
   */
  isThumbnailPerceptualDuplicate(perceptualHash, excludeJobId = null) {
    if (!perceptualHash) return false
    if (this.state.publishedVideos.slice(-this.rollingWindow).some(v => v.thumbnailPerceptualHash === perceptualHash)) {
      return true
    }
    for (const [jid, res] of Object.entries(this.state.reservations)) {
      if (jid === excludeJobId) continue
      if (res.thumbnailHash === perceptualHash) return true
    }
    return false
  }

  /**
   * Public convenience: record a published video directly (for testing / one-off use).
   * Prefer reserve() + commit() for production pipeline.
   */
  recordPublishedVideo(videoId, { scriptHash, imageHashes, musicTrackId, articleHash, jobId, category, thumbnailCompositionHash, thumbnailPerceptualHash } = {}) {
    this.state.publishedVideos.push({
      videoId,
      scriptHash: scriptHash || null,
      imageHashes: imageHashes || [],
      musicTrackId: musicTrackId || null,
      articleHash: articleHash || null,
      jobId: jobId || null,
      category: category || null,
      thumbnailCompositionHash: thumbnailCompositionHash || null,
      thumbnailPerceptualHash: thumbnailPerceptualHash || null,
      publishedAt: new Date().toISOString(),
    })
    if (this.state.publishedVideos.length > this.rollingWindow) {
      this.state.publishedVideos = this.state.publishedVideos.slice(-this.rollingWindow)
    }
    this._save()
  }

  // ── Convenience ──────────────────────────────────────────────────────

  getStats() {
    return {
      scripts: Object.keys(this.state.scripts).length,
      images: Object.keys(this.state.images).length,
      music: Object.keys(this.state.music).length,
      thumbnails: Object.keys(this.state.thumbnails).length,
      publishedVideos: this.state.publishedVideos.length,
      activeReservations: Object.keys(this.state.reservations).length,
      rollingWindow: this.rollingWindow,
    }
  }

  /**
   * Static helper: deterministic hash from text content.
   */
  static hash(text) {
    return crypto.createHash('sha256').update(String(text || '')).digest('hex').slice(0, 16)
  }

  cleanup() {
    this.state = { scripts: {}, images: {}, music: {}, thumbnails: {}, publishedVideos: [], reservations: {} }
    try { fs.unlinkSync(this.filePath) } catch { /* ok */ }
  }
}
