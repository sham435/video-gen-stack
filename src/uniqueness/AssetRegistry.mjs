// AssetRegistry — rolling inventory of all production assets.
//
// Tracks scripts, images, and music with deterministic hashes.
// Assets age out after ROLLING_WINDOW (default 50 published videos).
// At 48/day, uniqueness cannot depend on randomness — this registry
// is the single source of truth for "was this asset used before?"
//
// Persisted as JSON (same pattern as ProviderBudgets/ResourceGovernor).
// SQLite would be better at scale; JSON keeps the dependency tree flat.

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
    return { scripts: {}, images: {}, music: {}, publishedVideos: [] }
  }

  _save() {
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true })
    fs.writeFileSync(this.filePath, JSON.stringify(this.state, null, 2))
  }

  // ── Script tracking ──────────────────────────────────────────────────

  /**
   * Record a script as used. The hash is sha256 of the full narration text.
   */
  recordScript(hash, { articleHash, jobId, title } = {}) {
    const existing = this.state.scripts[hash]
    this.state.scripts[hash] = {
      firstUsed: existing?.firstUsed || new Date().toISOString(),
      lastUsed: new Date().toISOString(),
      articleHash: articleHash || null,
      jobId: jobId || null,
      title: title || null,
      usageCount: (existing?.usageCount || 0) + 1,
    }
    this._save()
  }

  /**
   * Check if a script hash was used within the rolling window.
   * Only counts scripts that appeared in a published video.
   * Multiple generations without publish are not duplicates.
   */
  isScriptDuplicate(hash) {
    return this.state.publishedVideos.slice(-this.rollingWindow).some(v =>
      v.scriptHash === hash
    )
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
    for (const [hash, entry] of Object.entries(this.state.scripts)) {
      if (!recentScriptHashes.has(hash)) {
        delete this.state.scripts[hash]
        removed++
      }
    }
    if (removed > 0) this._save()
    return removed
  }

  // ── Image tracking ───────────────────────────────────────────────────

  recordImage(hash, { sourceId, url, jobId } = {}) {
    const existing = this.state.images[hash]
    this.state.images[hash] = {
      firstUsed: existing?.firstUsed || new Date().toISOString(),
      lastUsed: new Date().toISOString(),
      sourceId: sourceId || null,
      url: url || null,
      jobId: jobId || null,
      usageCount: (existing?.usageCount || 0) + 1,
    }
    this._save()
  }

  isImageDuplicate(hash) {
    return this.state.publishedVideos.slice(-this.rollingWindow).some(v =>
      v.imageHashes?.includes(hash)
    )
  }

  // ── Music tracking ───────────────────────────────────────────────────

  recordMusic(trackId, { trackHash, family, jobId } = {}) {
    const existing = this.state.music[trackId]
    this.state.music[trackId] = {
      firstUsed: existing?.firstUsed || new Date().toISOString(),
      lastUsed: new Date().toISOString(),
      trackHash: trackHash || null,
      family: family || null,
      jobId: jobId || null,
      usageCount: (existing?.usageCount || 0) + 1,
    }
    this._save()
  }

  isMusicDuplicate(trackId) {
    return this.state.publishedVideos.slice(-this.rollingWindow).some(v =>
      v.musicTrackId === trackId
    )
  }

  // ── Published video tracking ─────────────────────────────────────────

  recordPublishedVideo(videoId, { scriptHash, imageHashes, musicTrackId, articleHash, jobId, category } = {}) {
    this.state.publishedVideos.push({
      videoId,
      scriptHash: scriptHash || null,
      imageHashes: imageHashes || [],
      musicTrackId: musicTrackId || null,
      articleHash: articleHash || null,
      jobId: jobId || null,
      category: category || null,
      publishedAt: new Date().toISOString(),
    })
    // Enforce rolling window — trim oldest
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
      publishedVideos: this.state.publishedVideos.length,
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
    this.state = { scripts: {}, images: {}, music: {}, publishedVideos: [] }
    try { fs.unlinkSync(this.filePath) } catch { /* ok */ }
  }
}
