// ProductionUniquenessManifest — describes what a production job produced.
//
// Built after RENDER + THUMBNAIL but before PUBLISH. The manifest captures
// every content hash that must be unique: script, scene images, music, thumbnail.
//
// The UniquenessPreflight uses this manifest to gate PUBLISH.
// If any hash is a duplicate within the rolling window, the job is blocked
// and must regenerate.

import crypto from 'node:crypto'

export class ProductionUniquenessManifest {
  constructor() {
    this.manifest = {
      articleHash: null,
      scriptHash: null,
      scenes: [],
      music: { trackId: null, trackHash: null, family: null },
      thumbnail: { artifactHash: null },
      jobId: null,
      createdAt: null,
    }
  }

  /**
   * Set the article hash (deterministic from title + category + date).
   */
  setArticle(article) {
    this.manifest.articleHash = ProductionUniquenessManifest.hashArticle(article)
    return this
  }

  /**
   * Set the script hash from the full narration text.
   */
  setScript(narrationText) {
    this.manifest.scriptHash = ProductionUniquenessManifest.hashText(narrationText)
    return this
  }

  /**
   * Add a scene with its image hash.
   */
  addScene(sceneIndex, { imageHash, sourceId, headline } = {}) {
    this.manifest.scenes.push({
      sceneIndex,
      imageHash: imageHash || null,
      sourceId: sourceId || null,
      headline: headline || null,
    })
    return this
  }

  /**
   * Set the music track info.
   */
  setMusic(trackId, { trackHash, family } = {}) {
    this.manifest.music = { trackId: trackId || null, trackHash: trackHash || null, family: family || null }
    return this
  }

  /**
   * Set the thumbnail artifact hash.
   */
  setThumbnail(artifactHash) {
    this.manifest.thumbnail = { artifactHash: artifactHash || null }
    return this
  }

  /**
   * Set the job ID.
   */
  setJobId(jobId) {
    this.manifest.jobId = jobId
    return this
  }

  /**
   * Finalize and return the manifest.
   */
  build() {
    this.manifest.createdAt = new Date().toISOString()
    return { ...this.manifest }
  }

  /**
   * Get all image hashes (scenes + thumbnail) for batch dedup check.
   */
  getAllImageHashes() {
    const hashes = this.manifest.scenes.map(s => s.imageHash).filter(Boolean)
    if (this.manifest.thumbnail.artifactHash) hashes.push(this.manifest.thumbnail.artifactHash)
    return hashes
  }

  // ── Static hashing helpers ───────────────────────────────────────────

  static hashText(text) {
    return crypto.createHash('sha256').update(String(text || '')).digest('hex').slice(0, 16)
  }

  static hashArticle(article) {
    const key = [
      (article.title || '').trim().toLowerCase(),
      (article.category || '').trim().toLowerCase(),
      (article.publishedAt || '').slice(0, 10),
    ].join('|')
    return ProductionUniquenessManifest.hashText(key)
  }
}
