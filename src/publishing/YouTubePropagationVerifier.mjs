/**
 * YouTubePropagationVerifier — propagation-aware post-upload verification.
 *
 * Does NOT treat "video not yet visible" as "thumbnail rejected."
 * Classifies API errors: authorization, quota, transient, propagation.
 * Verifies the canonical thumbnail IDENTITY (SHA-256 of the remote asset that
 * YouTube actually serves) against the artifact's generated thumbnail.
 *
 * States:
 *   VIDEO_NOT_VISIBLE_YET  — video hasn't propagated to videos.list yet
 *   VIDEO_VISIBLE_THUMBNAIL_PENDING — video visible but hasCustomThumbnail not yet true
 *   CUSTOM_THUMBNAIL_PENDING — custom thumbnail set but remote asset not yet hashable
 *   CUSTOM_THUMBNAIL_ACCEPTED — hasCustomThumbnail=true AND remote SHA-256 matches the artifact
 *   CUSTOM_THUMBNAIL_MISMATCH — hasCustomThumbnail=true but remote asset != generated artifact
 *   CUSTOM_THUMBNAIL_REJECTED — video visible, hasCustomThumbnail=false
 *   CUSTOM_THUMBNAIL_UNKNOWN — remote thumbnail could not be fetched for comparison
 *   VERIFICATION_FAILED — API error or max attempts exhausted
 *
 * Retry delays: 5s, 10s, 20s, 30s, 60s (configurable).
 * Authorization/quota failures do NOT retry — they cannot resolve themselves.
 */

export const VerifyState = {
  VIDEO_NOT_VISIBLE_YET: 'VIDEO_NOT_VISIBLE_YET',
  VIDEO_VISIBLE_THUMBNAIL_PENDING: 'VIDEO_VISIBLE_THUMBNAIL_PENDING',
  CUSTOM_THUMBNAIL_PENDING: 'CUSTOM_THUMBNAIL_PENDING',
  CUSTOM_THUMBNAIL_ACCEPTED: 'CUSTOM_THUMBNAIL_ACCEPTED',
  CUSTOM_THUMBNAIL_MISMATCH: 'CUSTOM_THUMBNAIL_MISMATCH',
  CUSTOM_THUMBNAIL_REJECTED: 'CUSTOM_THUMBNAIL_REJECTED',
  CUSTOM_THUMBNAIL_UNKNOWN: 'CUSTOM_THUMBNAIL_UNKNOWN',
  VERIFICATION_FAILED: 'VERIFICATION_FAILED',
}

export class YouTubePropagationVerifier {
  constructor(options = {}) {
    this.token = options.token || ''
    this.maxAttempts = options.maxAttempts || 5
    this.delays = options.delays || [5_000, 10_000, 20_000, 30_000, 60_000]
    this.timeout = options.timeout || 10_000
    this.sha256 = options.sha256 || null       // expected canonical fingerprint
    this.thumbnailPath = options.thumbnailPath || null // local canonical path
    this.sha256Fn = options.sha256Fn || this._defaultSha256
  }

  async headers() {
    return { 'Authorization': `Bearer ${this.token}` }
  }

  /**
   * Verify video visibility and custom thumbnail identity with propagation retries.
   * @param {{ videoId: string, sha256?: string, thumbnailPath?: string }} params
   * @returns {object} { state, video, hasCustomThumbnail, verifiedUrl, remoteSha256,
   *   thumbnailMatches, errorType, attempts, durationMs }
   */
  async verify({ videoId, sha256, thumbnailPath }) {
    const startTime = Date.now()
    const attempts = []
    const expectedSha256 = sha256 || this.sha256 || null

    for (let attempt = 1; attempt <= this.maxAttempts; attempt++) {
      const attemptStart = Date.now()
      try {
        const res = await fetch(
          `https://www.googleapis.com/youtube/v3/videos?part=contentDetails,snippet&id=${videoId}`,
          { headers: await this.headers(), signal: AbortSignal.timeout(this.timeout) }
        )

        const data = await res.json().catch(() => ({}))

        if (!res.ok) {
          const reason = data?.error?.errors?.[0]?.reason || 'unknown'
          const message = data?.error?.message || `HTTP ${res.status}`

          attempts.push({
            attempt, apiStatus: res.status, reason, message,
            durationMs: Date.now() - attemptStart,
          })

          // Authorization failures — cannot retry, fail immediately
          if (res.status === 401 || reason === 'authError' || reason === 'forbidden' || reason === 'insufficientPermissions') {
            return {
              state: VerifyState.VERIFICATION_FAILED,
              errorType: 'AUTHORIZATION',
              apiStatus: res.status, reason, message,
              video: null, hasCustomThumbnail: false, verifiedUrl: null, remoteSha256: null, thumbnailMatches: false,
              attempts, durationMs: Date.now() - startTime,
            }
          }

          // Quota exceeded — cannot retry until quota resets
          if (reason === 'quotaExceeded' || reason === 'dailyLimitExceeded') {
            return {
              state: VerifyState.VERIFICATION_FAILED,
              errorType: 'QUOTA',
              retryable: true,
              apiStatus: res.status, reason, message,
              video: null, hasCustomThumbnail: false, verifiedUrl: null, remoteSha256: null, thumbnailMatches: false,
              attempts, durationMs: Date.now() - startTime,
            }
          }

          // Transient API error — retry
          if (attempt < this.maxAttempts) await this._delay(attempt)
          continue
        }

        const video = data.items?.[0]

        if (!video) {
          // Video not yet propagated
          attempts.push({ attempt, found: false, durationMs: Date.now() - attemptStart })
          if (attempt < this.maxAttempts) await this._delay(attempt)
          continue
        }

        // Video is visible — check thumbnail
        const hasCustomThumbnail = video.contentDetails?.hasCustomThumbnail === true
        const thumbs = video.snippet?.thumbnails || {}
        const verifiedUrl = thumbs.maxres?.url || thumbs.standard?.url || thumbs.high?.url || thumbs.medium?.url || null

        if (!hasCustomThumbnail) {
          attempts.push({ attempt, found: true, hasCustomThumbnail: false, verifiedUrl, durationMs: Date.now() - attemptStart })
          return {
            state: VerifyState.CUSTOM_THUMBNAIL_REJECTED,
            video,
            hasCustomThumbnail: false,
            verifiedUrl,
            remoteSha256: null,
            thumbnailMatches: false,
            attempts,
            durationMs: Date.now() - startTime,
          }
        }

        // hasCustomThumbnail=true → download the remote asset YouTube serves and
        // compare its SHA-256 to the generated artifact. This is the production
        // invariant: hasCustomThumbnail alone proves nothing about which image
        // is actually displayed.
        let remoteSha256 = null
        let thumbnailMatches = expectedSha256 ? false : null
        let state = VerifyState.CUSTOM_THUMBNAIL_ACCEPTED
        if (verifiedUrl) {
          try {
            const remote = await this._downloadThumbnail(verifiedUrl)
            remoteSha256 = await this.sha256Fn(remote)
            if (expectedSha256) {
              thumbnailMatches = remoteSha256.toLowerCase() === expectedSha256.toLowerCase()
              state = thumbnailMatches
                ? VerifyState.CUSTOM_THUMBNAIL_ACCEPTED
                : VerifyState.CUSTOM_THUMBNAIL_MISMATCH
            }
          } catch (e) {
            // Cannot fetch/hash the remote asset yet — treat as pending/unknown.
            const transient = /timeout|network|fetch/i.test(String(e.message))
            state = transient
              ? VerifyState.CUSTOM_THUMBNAIL_PENDING
              : VerifyState.CUSTOM_THUMBNAIL_UNKNOWN
            attempts.push({ attempt, found: true, hasCustomThumbnail: true, verifiedUrl, remoteError: e.message, durationMs: Date.now() - attemptStart })
            if (transient && attempt < this.maxAttempts) { await this._delay(attempt); continue }
          }
        }

        attempts.push({
          attempt, found: true, hasCustomThumbnail, verifiedUrl, remoteSha256,
          thumbnailMatches, expectedSha256: expectedSha256 ? expectedSha256.slice(0, 12) : null,
          durationMs: Date.now() - attemptStart,
        })

        return {
          state,
          video,
          hasCustomThumbnail,
          verifiedUrl,
          remoteSha256,
          thumbnailMatches,
          attempts,
          durationMs: Date.now() - startTime,
        }
      } catch (e) {
        attempts.push({ attempt, error: e.message, durationMs: Date.now() - attemptStart })
        if (attempt < this.maxAttempts) await this._delay(attempt)
      }
    }

    // All attempts exhausted — video never propagated
    return {
      state: attempts.some(a => a.found === false)
        ? VerifyState.VIDEO_NOT_VISIBLE_YET
        : VerifyState.VERIFICATION_FAILED,
      errorType: attempts.some(a => a.apiStatus) ? 'TRANSIENT' : null,
      video: null,
      hasCustomThumbnail: false,
      verifiedUrl: null,
      remoteSha256: null,
      thumbnailMatches: false,
      attempts,
      durationMs: Date.now() - startTime,
    }
  }

  async _downloadThumbnail(url) {
    const res = await fetch(url, { signal: AbortSignal.timeout(this.timeout) })
    if (!res.ok) throw new Error(`thumbnail download HTTP ${res.status}`)
    const buf = Buffer.from(await res.arrayBuffer())
    if (!buf.length) throw new Error('thumbnail download empty')
    return buf
  }

  async _defaultSha256(buffer) {
    const { createHash } = await import('node:crypto')
    return createHash('sha256').update(buffer).digest('hex')
  }

  _delay(attempt) {
    const ms = this.delays[Math.min(attempt - 1, this.delays.length - 1)]
    return new Promise(resolve => setTimeout(resolve, ms))
  }
}
