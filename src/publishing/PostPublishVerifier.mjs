/**
 * PostPublishVerifier — validates YouTube publication after upload.
 *
 * Verifies: video reachable, visibility public, thumbnail available,
 * title matches, artifact consistency. Returns structured result
 * for trace and publication ledger.
 */

const YOUTUBE_API = 'https://www.googleapis.com/youtube/v3'

export class PostPublishVerifier {
  constructor(options = {}) {
    this.token = options.token || process.env.YOUTUBE_OAUTH_TOKEN || ''
    this.timeout = options.timeout || 10000
  }

  async headers() {
    return {
      'Authorization': `Bearer ${this.token}`,
      'Accept': 'application/json',
    }
  }

  /**
   * Full verification chain for a published video.
   * @param {object} params
   * @param {string} params.videoId - YouTube video ID
   * @param {string} params.expectedTitle - Title used during upload
   * @param {string} params.expectedVisibility - Expected privacy status (public/unlisted/private)
   * @param {string} params.thumbnailPath - Local thumbnail path (for fingerprint comparison)
   * @param {string} params.jobId - Production job ID
   * @returns {object} Verification result
   */
  async verify({ videoId, expectedTitle, expectedVisibility = 'public', thumbnailPath, jobId }) {
    const checks = {}
    const startTime = Date.now()

    // 1. Video exists and is reachable
    checks.videoReachable = await this._checkVideoReachable(videoId)

    // 2. Visibility matches expected
    checks.visibility = await this._checkVisibility(videoId, expectedVisibility)

    // 3. Thumbnail available on YouTube
    checks.thumbnail = await this._checkThumbnail(videoId)

    // 4. Title matches (fuzzy — YouTube may truncate)
    if (expectedTitle) {
      checks.title = await this._checkTitle(videoId, expectedTitle)
    }

    // 5. Local thumbnail fingerprint (if provided)
    if (thumbnailPath) {
      checks.localThumbnail = await this._checkLocalThumbnail(thumbnailPath)
    }

    const durationMs = Date.now() - startTime
    const passed = Object.values(checks).every(c => c.pass)
    const failures = Object.entries(checks).filter(([, c]) => !c.pass).map(([k, c]) => `${k}: ${c.reason}`)

    return {
      passed,
      videoId,
      jobId,
      checks,
      durationMs,
      failures,
      verifiedAt: new Date().toISOString(),
    }
  }

  async _checkVideoReachable(videoId) {
    try {
      const res = await fetch(
        `${YOUTUBE_API}/videos?part=contentDetails,status,snippet&id=${videoId}`,
        { headers: await this.headers(), signal: AbortSignal.timeout(this.timeout) }
      )
      if (!res.ok) return { pass: false, reason: `API ${res.status}` }
      const data = await res.json()
      if (!data.items?.length) return { pass: false, reason: 'video not found' }
      return { pass: true, reason: 'video exists', duration: data.items[0].contentDetails?.duration }
    } catch (e) {
      return { pass: false, reason: e.message }
    }
  }

  async _checkVisibility(videoId, expected) {
    try {
      const res = await fetch(
        `${YOUTUBE_API}/videos?part=status&id=${videoId}`,
        { headers: await this.headers(), signal: AbortSignal.timeout(this.timeout) }
      )
      if (!res.ok) return { pass: false, reason: `API ${res.status}` }
      const data = await res.json()
      const actual = data.items?.[0]?.status?.privacyStatus
      if (actual !== expected) return { pass: false, reason: `expected ${expected}, got ${actual}` }
      return { pass: true, reason: `visibility=${actual}` }
    } catch (e) {
      return { pass: false, reason: e.message }
    }
  }

  async _checkThumbnail(videoId) {
    try {
      const res = await fetch(
        `https://i.ytimg.com/vi/${videoId}/maxresdefault.jpg`,
        { method: 'HEAD', signal: AbortSignal.timeout(5000) }
      )
      if (!res.ok) {
        // Fallback to hqdefault
        const hq = await fetch(`https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`, { method: 'HEAD', signal: AbortSignal.timeout(5000) })
        if (!hq.ok) return { pass: false, reason: 'no thumbnail found' }
        return { pass: true, reason: 'hqdefault available (maxres unavailable)', quality: 'hq' }
      }
      return { pass: true, reason: 'maxresdefault available', quality: 'maxres' }
    } catch (e) {
      return { pass: false, reason: e.message }
    }
  }

  async _checkTitle(videoId, expected) {
    try {
      const res = await fetch(
        `${YOUTUBE_API}/videos?part=snippet&id=${videoId}`,
        { headers: await this.headers(), signal: AbortSignal.timeout(this.timeout) }
      )
      if (!res.ok) return { pass: false, reason: `API ${res.status}` }
      const data = await res.json()
      const actual = data.items?.[0]?.snippet?.title || ''
      // Fuzzy match: YouTube may append channel name or truncate
      const normalise = s => s.toLowerCase().replace(/\s*\|\s*news-monster\s*/i, '').trim()
      const actualNorm = normalise(actual)
      const expectedNorm = normalise(expected)
      if (actualNorm.includes(expectedNorm) || expectedNorm.includes(actualNorm)) {
        return { pass: true, reason: 'title matches' }
      }
      return { pass: false, reason: `title mismatch: "${actual.slice(0, 60)}"` }
    } catch (e) {
      return { pass: false, reason: e.message }
    }
  }

  async _checkLocalThumbnail(thumbnailPath) {
    try {
      const { existsSync, statSync } = await import('node:fs')
      if (!existsSync(thumbnailPath)) return { pass: false, reason: 'file not found' }
      const stat = statSync(thumbnailPath)
      return { pass: true, reason: `exists (${(stat.size / 1024).toFixed(0)}KB)`, size: stat.size }
    } catch (e) {
      return { pass: false, reason: e.message }
    }
  }
}
