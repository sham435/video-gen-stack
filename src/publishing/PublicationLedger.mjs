/**
 * PublicationLedger — append-only log of verified publications.
 * Single source of truth for gallery manifest. Every entry is verified
 * before being recorded. Gallery reads this, not YouTube RSS.
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs'
import { dirname } from 'node:path'

export class PublicationLedger {
  constructor(options = {}) {
    this.filePath = options.filePath || 'data/publication-ledger.json'
    this._entries = this._load()
  }

  _load() {
    try {
      if (!existsSync(this.filePath)) return []
      return JSON.parse(readFileSync(this.filePath, 'utf-8')).entries || []
    } catch {
      return []
    }
  }

  _save() {
    const dir = dirname(this.filePath)
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
    writeFileSync(this.filePath, JSON.stringify({ entries: this._entries }, null, 2))
  }

  /** All verified entries, newest first */
  all() {
    return [...this._entries].reverse()
  }

  /** Append a verified publication. Overwrites if videoId already exists. */
  record(verification) {
    const existing = this._entries.findIndex(e => e.videoId === verification.videoId)
    const entry = {
      videoId: verification.videoId,
      jobId: verification.jobId,
      title: verification.title || null,
      category: verification.category || null,
      thumbnail: verification.thumbnail || null,
      visibility: verification.visibility || 'public',
      verifiedAt: verification.verifiedAt || new Date().toISOString(),
      checks: verification.checks || {},
      publishedAt: verification.publishedAt || null,
    }
    if (existing >= 0) {
      this._entries[existing] = entry
    } else {
      this._entries.push(entry)
    }
    this._save()
    return entry
  }

  /** Generate gallery manifest from verified entries only. */
  toGalleryManifest(channelId) {
    const videos = this.all().map(e => ({
      id: e.videoId,
      title: e.title || `Video ${e.videoId}`,
      category: e.category || 'general',
      publishedAt: e.publishedAt || e.verifiedAt,
      publishedLabel: e.publishedAt
        ? new Date(e.publishedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
        : '',
      thumbnail: e.thumbnail || `https://i.ytimg.com/vi/${e.videoId}/hqdefault.jpg`,
      verified: true,
    }))
    return {
      channelId,
      updatedAt: new Date().toISOString(),
      source: 'publication-ledger',
      videos,
    }
  }

  /** Find entry by videoId */
  findByVideoId(videoId) {
    return this._entries.find(e => e.videoId === videoId) || null
  }

  /** Count verified entries */
  count() {
    return this._entries.length
  }
}
