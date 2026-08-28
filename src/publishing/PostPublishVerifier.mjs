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
   * @param {string} params.expectedThumbnailSha256 - Canonical SHA-256 of the generated artifact
   * @param {string} params.jobId - Production job ID
   * @returns {object} Verification result
   */
  async verify({ videoId, expectedTitle, expectedVisibility = 'public', thumbnailPath, expectedThumbnailSha256, jobId }) {
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

    // 6. Remote thumbnail SHA-256 identity match (THE production invariant).
    //   hasCustomThumbnail=true is not proof — the remote asset must actually
    //   equal the generated artifact.
    if (expectedThumbnailSha256) {
      checks.thumbnailIdentity = await this._checkThumbnailIdentity(videoId, thumbnailPath, expectedThumbnailSha256)
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
      // Fetch the snippet to get the actual thumbnail URL YouTube served.
      const res = await fetch(
        `${YOUTUBE_API}/videos?part=snippet&id=${videoId}`,
        { headers: await this.headers(), signal: AbortSignal.timeout(this.timeout) }
      )
      if (!res.ok) return { pass: false, reason: `API ${res.status}` }
      const data = await res.json()
      const thumbs = data.items?.[0]?.snippet?.thumbnails || {}
      const url = thumbs.maxres?.url || thumbs.standard?.url || thumbs.high?.url || thumbs.medium?.url || null
      if (!url) {
        return { pass: false, reason: 'no thumbnail URL present' }
      }
      const dims = thumbs.maxres || thumbs.standard || thumbs.high || thumbs.medium || {}
      return {
        pass: true,
        reason: `thumbnail available ${dims.width || '?'}x${dims.height || '?'}`,
        url,
        width: dims.width,
        height: dims.height,
      }
    } catch (e) {
      return { pass: false, reason: e.message }
    }
  }

  /**
   * Prove the remote thumbnail YouTube serves equals the generated artifact.
   * Downloads the remote image and compares its SHA-256 to the expected hash.
   */
  async _checkThumbnailIdentity(videoId, localPath, expectedSha256) {
    try {
      // 1. Local canonical hash (the artifact identity).
      const localSha = await this._sha256File(localPath)
      if (!localSha) return { pass: false, reason: 'local thumbnail unavailable' }
      const localOk = localSha.toLowerCase() === expectedSha256.toLowerCase()
      if (!localOk) return { pass: false, reason: 'local sha256 != expected' }

      // 2. Remote thumbnail URL from the API.
      const res = await fetch(
        `${YOUTUBE_API}/videos?part=snippet&id=${videoId}`,
        { headers: await this.headers(), signal: AbortSignal.timeout(this.timeout) }
      )
      if (!res.ok) return { pass: false, reason: `API ${res.status}` }
      const data = await res.json()
      const thumbs = data.items?.[0]?.snippet?.thumbnails || {}
      const url = thumbs.maxres?.url || thumbs.standard?.url || thumbs.high?.url || thumbs.medium?.url || null
      if (!url) return { pass: false, reason: 'no remote thumbnail URL' }

      // 3. Download + hash the remote asset.
      const remote = await fetch(url, { signal: AbortSignal.timeout(10000) })
      if (!remote.ok) return { pass: false, reason: `remote download HTTP ${remote.status}` }
      const remoteBuf = Buffer.from(await remote.arrayBuffer())
      const remoteSha = await this._sha256Buffer(remoteBuf)

      if (remoteSha.toLowerCase() !== expectedSha256.toLowerCase()) {
        return {
          pass: false,
          reason: `remote sha256 mismatch (${remoteSha.slice(0, 12)}… != ${expectedSha256.slice(0, 12)}…)`,
          remoteSha256: remoteSha,
          localSha256: localSha,
          url,
        }
      }
      return { pass: true, reason: 'remote sha256 matches artifact', remoteSha256: remoteSha, localSha256: localSha, url, bytes: remoteBuf.length }
    } catch (e) {
      return { pass: false, reason: e.message }
    }
  }

  async _sha256File(path) {
    try {
      const { readFileSync, existsSync } = await import('node:fs')
      if (!existsSync(path)) return null
      return this._sha256Buffer(readFileSync(path))
    } catch { return null }
  }

  async _sha256Buffer(buffer) {
    const { createHash } = await import('node:crypto')
    return createHash('sha256').update(buffer).digest('hex')
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
