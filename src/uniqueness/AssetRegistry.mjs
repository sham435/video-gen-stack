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

const DEFAULT_REGISTRY_PATH = process.env.ASSET_REGISTRY_PATH || path.resolve(process.cwd(), 'data', 'asset-registry.json')
const ROLLING_WINDOW = 50

// Mandatory rolling image quarantine: a final image committed by ANY video is
// unavailable for reuse for the next QUARANTINE_DAYS × 24 hours. At 48
// videos/day this protects ~336 videos inside the rolling window. The window
// is TIME-based (never a calendar-week reset): an image used at T becomes
// eligible again only at/after T + QUARANTINE_DAYS * 24h.
export const QUARANTINE_DAYS = 7
export const QUARANTINE_MS = QUARANTINE_DAYS * 24 * 60 * 60 * 1000

export class AssetRegistry {
  constructor(options = {}) {
    this.filePath = options.filePath || DEFAULT_REGISTRY_PATH
    this.rollingWindow = options.rollingWindow || ROLLING_WINDOW
    this._corrupt = false
    this.state = this._load()
  }

  _load() {
    if (fs.existsSync(this.filePath)) {
      try {
        return JSON.parse(fs.readFileSync(this.filePath, 'utf-8'))
      } catch {
        // FAIL CLOSED: a corrupt ledger means history is unavailable. Do NOT
        // silently reset to a fresh ledger — that would let any image be
        // treated as "never used". Quarantine checks treat the ledger as
        // UNKNOWN (see isImageQuarantined) until the file is repaired.
        this._corrupt = true
        console.warn(`[AssetRegistry] ledger corrupt — fail-closed until repaired: ${this.filePath}`)
      }
    }
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
  commit(jobId, { videoId, category, now } = {}) {
    const res = this.state.reservations[jobId]
    if (!res) return false

    // Record to permanent indexes
    if (res.scriptHash) {
      this._recordScript(res.scriptHash, { jobId, text: res.scriptText || null, now })
    }
    for (const h of res.imageHashes) {
      this._recordImage(h, { jobId, now })
    }
    if (res.musicTrackId) {
      this._recordMusic(res.musicTrackId, { jobId, now })
    }
    if (res.thumbnailHash || res.thumbnailCompositionHash) {
      this._recordThumbnail({
        compositionHash: res.thumbnailCompositionHash || res.thumbnailHash,
        perceptualHash: res.thumbnailHash,
      }, { jobId, now })
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
      publishedAt: (now || new Date()).toISOString(),
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

  _recordScript(hash, { jobId, title, text, now } = {}) {
    const existing = this.state.scripts[hash]
    this.state.scripts[hash] = {
      firstUsed: existing?.firstUsed || (now || new Date()).toISOString(),
      lastUsed: (now || new Date()).toISOString(),
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

  _recordImage(hash, { jobId, now } = {}) {
    const existing = this.state.images[hash]
    this.state.images[hash] = {
      firstUsed: existing?.firstUsed || (now || new Date()).toISOString(),
      lastUsed: (now || new Date()).toISOString(),
      jobId: jobId || existing?.jobId || null,
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

  _recordMusic(trackId, { trackHash, family, jobId, now } = {}) {
    const existing = this.state.music[trackId]
    this.state.music[trackId] = {
      firstUsed: existing?.firstUsed || (now || new Date()).toISOString(),
      lastUsed: (now || new Date()).toISOString(),
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

  _recordThumbnail({ compositionHash, perceptualHash }, { jobId, now } = {}) {
    const key = compositionHash || perceptualHash
    if (!key) return
    const existing = this.state.thumbnails[key]
    this.state.thumbnails[key] = {
      compositionHash: compositionHash || null,
      perceptualHash: perceptualHash || null,
      firstUsed: existing?.firstUsed || (now || new Date()).toISOString(),
      lastUsed: (now || new Date()).toISOString(),
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
  recordPublishedVideo(videoId, { scriptHash, imageHashes, musicTrackId, articleHash, jobId, category, thumbnailCompositionHash, thumbnailPerceptualHash, now } = {}) {
    const iso = (now || new Date()).toISOString()
    for (const h of imageHashes || []) {
      this._recordImage(h, { jobId, now })
    }
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
      publishedAt: iso,
    })
    if (this.state.publishedVideos.length > this.rollingWindow) {
      this.state.publishedVideos = this.state.publishedVideos.slice(-this.rollingWindow)
    }
    this._save()
  }

  /**
   * Rolling 7-day image quarantine — the mandatory final-asset invariant.
   *
   * An image becomes quarantined when it is COMMITTED as a final production
   * asset (state.images is written only by commit() / recordImage() /
   * recordPublishedVideo(), i.e. the production/ledger lifecycle). It remains
   * unavailable for [now, usedAt + QUARANTINE_DAYS×24h). The window is rolling
   * and TIME-based — never a calendar-week reset.
   *
   * FAIL CLOSED: if the ledger is corrupt or a historical record cannot be
   * timestamped, the image is treated as quarantined (unknown=true). No image
   * is assumed fresh merely because its history is unavailable.
   *
   * @param {string} hash canonical asset fingerprint (sha256)
   * @param {object} [opts] { excludeJobId, now, days }
   * @returns {{ quarantined:boolean, unknown:boolean, reason:string|null,
   *   usedAt:string|null, reservedBy:string|null }}
   */
  isImageQuarantined(hash, { excludeJobId = null, now = new Date(), days = QUARANTINE_DAYS } = {}) {
    const nowMs = toIsoMs(now)
    const windowMs = days * 24 * 60 * 60 * 1000

    // Corrupt ledger → history unavailable → fail closed.
    if (this._corrupt) {
      return { quarantined: true, unknown: true, reason: 'LEDGER_CORRUPT', usedAt: null, reservedBy: null }
    }
    if (!hash) {
      return { quarantined: false, unknown: false, reason: null, usedAt: null, reservedBy: null }
    }

    // 1. Committed final asset (permanent image index — the source of truth).
    const img = this.state.images[hash]
    if (img?.lastUsed) {
      const usedMs = toIsoMs(img.lastUsed)
      if (Number.isFinite(usedMs)) {
        if (nowMs - usedMs < windowMs) {
          return { quarantined: true, unknown: false, reason: 'IMAGE_QUARANTINED_7D', usedAt: img.lastUsed, reservedBy: null }
        }
      } else {
        // Unparseable timestamp → cannot prove freshness → fail closed.
        return { quarantined: true, unknown: true, reason: 'AMBIGUOUS_HISTORY', usedAt: img.lastUsed, reservedBy: null }
      }
    }

    // 2. Published videos window (second reference). An entry inside the time
    //    window with an unparseable publishedAt is ambiguous history → fail.
    for (const v of this.state.publishedVideos) {
      if (v.excludeJobId === excludeJobId) continue
      if (!v.imageHashes?.includes(hash)) continue
      const atMs = toIsoMs(v.publishedAt)
      if (!Number.isFinite(atMs)) {
        return { quarantined: true, unknown: true, reason: 'AMBIGUOUS_HISTORY', usedAt: v.publishedAt ?? null, reservedBy: null }
      }
      if (nowMs - atMs < windowMs) {
        return { quarantined: true, unknown: false, reason: 'IMAGE_QUARANTINED_7D', usedAt: v.publishedAt, reservedBy: null }
      }
    }

    // 3. Reservations of OTHER jobs — atomic reserve→commit lifecycle.
    for (const [jid, res] of Object.entries(this.state.reservations)) {
      if (jid === excludeJobId) continue
      if (res.imageHashes?.includes(hash)) {
        return { quarantined: true, unknown: false, reason: 'IMAGE_RESERVED', usedAt: res.reservedAt || null, reservedBy: jid }
      }
    }

    return { quarantined: false, unknown: false, reason: null, usedAt: null, reservedBy: null }
  }

  /**
   * Time at which a committed image becomes eligible again (usedAt + 7d).
   * Returns null when the image has no committed history.
   */
  quarantineEligibleAt(hash, { now = new Date(), days = QUARANTINE_DAYS } = {}) {
    const img = this.state.images[hash]
    if (!img?.lastUsed) return null
    const usedMs = toIsoMs(img.lastUsed)
    if (!Number.isFinite(usedMs)) return null
    return new Date(usedMs + days * 24 * 60 * 60 * 1000).toISOString()
  }

  /**
   * All final images committed within the previous `days`×24h (cross-video
   * quarantine set). Used for the acceptance assertion
   * `currentVideoFinalImages ∩ previous7DayFinalImages = ∅`.
   */
  recentCommittedImages({ now = new Date(), days = QUARANTINE_DAYS } = {}) {
    if (this._corrupt) return { images: [], unknown: true }
    const nowMs = toIsoMs(now)
    const windowMs = days * 24 * 60 * 60 * 1000
    const images = new Set()
    let unknown = false
    for (const [hash, img] of Object.entries(this.state.images || {})) {
      if (!img?.lastUsed) { unknown = true; continue }
      const usedMs = toIsoMs(img.lastUsed)
      if (!Number.isFinite(usedMs)) { unknown = true; continue }
      if (nowMs - usedMs < windowMs) images.add(hash)
    }
    return { images: [...images], unknown }
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

/**
 * Normalized epoch-millis for timestamps written by this registry (ISO 8601)
 * or by SQLite datetime() ('YYYY-MM-DD HH:MM:SS' UTC). Returns NaN when the
 * value cannot be parsed — callers treat that as AMBIGUOUS history (fail closed).
 */
function toIsoMs(value) {
  if (value instanceof Date) return value.getTime()
  if (typeof value !== 'string' || !value) return Number.NaN
  const iso = value.includes('T') ? value : String(value).replace(' ', 'T') + 'Z'
  return new Date(iso).getTime()
}
