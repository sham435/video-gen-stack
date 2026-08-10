// YouTubeCommunityPublisher — publishes the promotional update to the channel's
// YouTube Community tab (if official API support exists) or queues it for
// manual publication.
//
// IMPORTANT: Do NOT use Selenium/browser automation or unofficial scraping for
// Community posts. As of the 2025-2026 YouTube Data API v3, the public API does
// NOT expose Community-post creation (no ytapi.community endpoint; only uploads,
// playlists, comments, captions, thumbnails). So this publisher reports
// `unsupported` with a clear reason and persists the generated payload in the
// manual queue — never fakes success.
//
// Architecture note: `publish()` is async so that when Google ships an official
// endpoint, only the `_apiPublish` path changes — the manager/store/tests stay.

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { resolve, dirname } from 'node:path'

const MANUAL_QUEUE_FILE = resolve(process.cwd(), 'data', 'youtube-community-manual-queue.json')

// Verifies whether the official YouTube Data API exposes Community post
// creation. Kept as a function so the check can evolve with the API.
function apiSupport() {
  return {
    supported: false,
    reason: 'YouTube public Data API v3 does not expose Community post creation (no yt.community.* endpoint). Manual queue provided.',
    evidence: 'https://developers.google.com/youtube/v3/docs (upload, comments, playlists, captions, thumbnails — no community posts)',
  }
}

function loadQueue(queueFile) {
  try {
    if (existsSync(queueFile)) return JSON.parse(readFileSync(queueFile, 'utf-8'))
  } catch { /* ignore */ }
  return []
}

function saveQueue(queueFile, queue) {
  try {
    mkdirSync(dirname(queueFile), { recursive: true })
    writeFileSync(queueFile, JSON.stringify(queue, null, 2))
  } catch (e) { console.warn(`[YOUTUBE-COMMUNITY] queue persist failed: ${e.message}`) }
}

export class YouTubeCommunityPublisher {
  constructor({ queueFile = MANUAL_QUEUE_FILE, support = null } = {}) {
    this.queueFile = queueFile
    this._support = support || apiSupport()
  }

  support() {
    return this._support
  }

  /**
   * Attempt publish. Returns { platform, status, reason, queued }.
   * status: 'unsupported' | 'published' | 'failed'
   */
  async publish({ videoId, post }) {
    const sup = this.support()
    if (!sup.supported) {
      // Persist the generated payload for manual publication — do NOT fake
      // success: status stays 'unsupported'.
      const entry = {
        queuedAt: new Date().toISOString(),
        videoId,
        title: post.title,
        text: post.text,
        thumbnailPath: post.thumbnailPath || null,
      }
      const queue = loadQueue(this.queueFile)
      if (!queue.some(q => q.videoId === videoId)) queue.push(entry)
      saveQueue(this.queueFile, queue)
      return {
        platform: 'youtube-community',
        status: 'unsupported',
        reason: sup.reason,
        queued: true,
        payload: entry,
      }
    }
    // Official path — not yet reachable; kept for future API.
    try {
      await this._apiPublish(post)
      return { platform: 'youtube-community', status: 'published', postId: null, url: null }
    } catch (e) {
      return { platform: 'youtube-community', status: 'failed', reason: e.message }
    }
  }

  /** Future: call the official YouTube Community endpoint here. */
  async _apiPublish() {
    throw new Error('YouTube Community post API not implemented (unavailable in public Data API)')
  }
}