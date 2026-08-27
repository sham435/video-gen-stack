/**
 * YouTubePropagationVerifier — propagation-aware post-upload verification.
 *
 * Does NOT treat "video not yet visible" as "thumbnail rejected."
 * Classifies API errors: authorization, quota, transient, propagation.
 *
 * States:
 *   VIDEO_NOT_VISIBLE_YET  — video hasn't propagated to videos.list yet
 *   VIDEO_VISIBLE_THUMBNAIL_PENDING — video visible but hasCustomThumbnail not yet true
 *   CUSTOM_THUMBNAIL_ACCEPTED — hasCustomThumbnail=true, verified URL captured
 *   CUSTOM_THUMBNAIL_REJECTED — video visible, hasCustomThumbnail=false
 *   VERIFICATION_FAILED — API error or max attempts exhausted
 *
 * Retry delays: 5s, 10s, 20s, 30s, 60s (configurable).
 * Authorization/quota failures do NOT retry — they cannot resolve themselves.
 */

export const VerifyState = {
  VIDEO_NOT_VISIBLE_YET: 'VIDEO_NOT_VISIBLE_YET',
  VIDEO_VISIBLE_THUMBNAIL_PENDING: 'VIDEO_VISIBLE_THUMBNAIL_PENDING',
  CUSTOM_THUMBNAIL_ACCEPTED: 'CUSTOM_THUMBNAIL_ACCEPTED',
  CUSTOM_THUMBNAIL_REJECTED: 'CUSTOM_THUMBNAIL_REJECTED',
  VERIFICATION_FAILED: 'VERIFICATION_FAILED',
}

export class YouTubePropagationVerifier {
  constructor(options = {}) {
    this.token = options.token || ''
    this.maxAttempts = options.maxAttempts || 5
    this.delays = options.delays || [5_000, 10_000, 20_000, 30_000, 60_000]
    this.timeout = options.timeout || 10_000
  }

  async headers() {
    return { 'Authorization': `Bearer ${this.token}` }
  }

  /**
   * Verify video visibility and custom thumbnail acceptance with propagation retries.
   * @param {{ videoId: string }} params
   * @returns {object} { state, video, hasCustomThumbnail, verifiedUrl, errorType, attempts, durationMs }
   */
  async verify({ videoId }) {
    const startTime = Date.now()
    const attempts = []

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
              video: null, hasCustomThumbnail: false, verifiedUrl: null,
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
              video: null, hasCustomThumbnail: false, verifiedUrl: null,
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

        const state = hasCustomThumbnail
          ? VerifyState.CUSTOM_THUMBNAIL_ACCEPTED
          : VerifyState.CUSTOM_THUMBNAIL_REJECTED

        attempts.push({
          attempt, found: true, hasCustomThumbnail, verifiedUrl,
          durationMs: Date.now() - attemptStart,
        })

        return {
          state,
          video,
          hasCustomThumbnail,
          verifiedUrl,
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
      attempts,
      durationMs: Date.now() - startTime,
    }
  }

  _delay(attempt) {
    const ms = this.delays[Math.min(attempt - 1, this.delays.length - 1)]
    return new Promise(resolve => setTimeout(resolve, ms))
  }
}
