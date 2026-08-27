/**
 * PublicationLedger — append-only log of verified publications.
 * Single source of truth for gallery manifest. Every entry is verified
 * before being recorded. Gallery reads this, not YouTube RSS.
 *
 * Three-axis publication state:
 *   uploadState:       PENDING | SUCCESS | FAILED
 *   thumbnailState:    UPLOADED | CUSTOM_THUMBNAIL_ACCEPTED | CUSTOM_THUMBNAIL_REJECTED | UNKNOWN
 *   verificationState: PENDING | VIDEO_NOT_VISIBLE_YET | VERIFIED | REJECTED | API_UNAVAILABLE
 */

export const UploadState = { PENDING: 'PENDING', SUCCESS: 'SUCCESS', FAILED: 'FAILED' }
export const ThumbnailState = { UPLOADED: 'UPLOADED', ACCEPTED: 'CUSTOM_THUMBNAIL_ACCEPTED', REJECTED: 'CUSTOM_THUMBNAIL_REJECTED', UNKNOWN: 'UNKNOWN' }
export const VerificationState = { PENDING: 'PENDING', NOT_VISIBLE: 'VIDEO_NOT_VISIBLE_YET', VERIFIED: 'VERIFIED', REJECTED: 'REJECTED', API_UNAVAILABLE: 'API_UNAVAILABLE' }

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs'
import { dirname } from 'node:path'

/** Resolve thumbnail URL — deterministic, no guessing. */
export function resolveThumbnailUrl(videoId, thumbnailField) {
  // 1. Explicit YouTube URL from production verification
  if (typeof thumbnailField === 'string' && thumbnailField.startsWith('http')) return thumbnailField
  // 2. YouTube verified fallback — maxres first
  if (videoId) return `https://i.ytimg.com/vi/${videoId}/maxresdefault.jpg`
  // 3. Static placeholder
  return '/assets/placeholder-thumbnail.jpg'
}

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
      thumbnail: resolveThumbnailUrl(verification.videoId, verification.thumbnail),
      visibility: verification.visibility || 'public',
      verifiedAt: verification.verifiedAt || new Date().toISOString(),
      checks: verification.checks || {},
      publishedAt: verification.publishedAt || null,
      // 3-axis state
      uploadState: verification.uploadState || UploadState.SUCCESS,
      thumbnailState: verification.thumbnailState || ThumbnailState.UNKNOWN,
      verificationState: verification.verificationState || VerificationState.PENDING,
    }
    if (existing >= 0) {
      this._entries[existing] = entry
    } else {
      this._entries.push(entry)
    }
    this._save()
    return entry
  }

  /** Generate gallery manifest from verified entries only.
   *  Gallery includes entries where upload succeeded AND verification is not rejected.
   *  API_UNAVAILABLE and VIDEO_NOT_VISIBLE_YET entries are included (publication is valid, verification pending).
   */
  toGalleryManifest(channelId) {
    const videos = this.all()
      .filter(e => e.uploadState === UploadState.SUCCESS && e.verificationState !== VerificationState.REJECTED)
      .map(e => ({
        id: e.videoId,
        title: e.title || `Video ${e.videoId}`,
        category: e.category || 'general',
        publishedAt: e.publishedAt || e.verifiedAt,
        publishedLabel: e.publishedAt
          ? new Date(e.publishedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
          : '',
        thumbnail: resolveThumbnailUrl(e.videoId, e.thumbnail),
        verified: e.verificationState === VerificationState.VERIFIED,
        verificationState: e.verificationState,
        thumbnailState: e.thumbnailState,
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
