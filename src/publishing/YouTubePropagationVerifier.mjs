/**
 * YouTubePropagationVerifier — propagation-aware post-upload verification.
 *
 * Does NOT treat "video not yet visible" as "thumbnail rejected."
 * Classifies API errors: authorization, quota, transient, propagation.
 *
 * Three distinct contracts are kept separate:
 *   A. SOURCE COMPLIANCE — the LOCAL canonical artifact is 2160x3840 (9:16),
 *      < 45MB, PNG/JPEG, SHA-256. This proves what WE generated.
 *   B. YOUTUBE ACCEPTANCE — hasCustomThumbnail === true (from videos.list).
 *   C. REMOTE REPRESENTATION — the authoritative URL + dimensions returned by
 *      video.snippet.thumbnails.* (YouTube's own endpoint — never construct
 *      the URL or assume exact dimensions; YouTube resizes uploads).
 *
 * Identity (D): EXACT when remote SHA-256 equals the artifact, REENCODED when
 * the remote is retrievable and aspect-compatible but the SHA differs (YouTube
 * re-encoded/resized it). A SHA difference is expected and is NOT a failure.
 *
 * Acceptance is based primarily on hasCustomThumbnail === true + remote
 * retrievable + aspect-compatible. It does NOT require remote width === 2160
 * and height === 3840 — YouTube may downscale the representation.
 *
 * States:
 *   CUSTOM_THUMBNAIL_PENDING  — custom thumbnail set but remote asset not yet fetchable
 *   CUSTOM_THUMBNAIL_ACCEPTED — hasCustomThumbnail=true AND remote retrievable AND aspect-compatible
 *   CUSTOM_THUMBNAIL_REJECTED — video visible, hasCustomThumbnail=false (or remote aspect incompatible)
 *   CUSTOM_THUMBNAIL_UNKNOWN  — remote thumbnail could not be fetched for comparison
 *   VIDEO_NOT_VISIBLE_YET / VIDEO_VISIBLE_THUMBNAIL_PENDING / VERIFICATION_FAILED
 *
 * Retry delays: 5s, 10s, 20s, 30s, 60s (configurable).
 * Authorization/quota failures do NOT retry — they cannot resolve themselves.
 */

export const VerifyState = {
  VIDEO_NOT_VISIBLE_YET: 'VIDEO_NOT_VISIBLE_YET',
  VIDEO_VISIBLE_THUMBNAIL_PENDING: 'VIDEO_VISIBLE_THUMBNAIL_PENDING',
  CUSTOM_THUMBNAIL_PENDING: 'CUSTOM_THUMBNAIL_PENDING',
  CUSTOM_THUMBNAIL_ACCEPTED: 'CUSTOM_THUMBNAIL_ACCEPTED',
  CUSTOM_THUMBNAIL_REJECTED: 'CUSTOM_THUMBNAIL_REJECTED',
  CUSTOM_THUMBNAIL_UNKNOWN: 'CUSTOM_THUMBNAIL_UNKNOWN',
  VERIFICATION_FAILED: 'VERIFICATION_FAILED',
}

export const ThumbnailIdentity = {
  EXACT: 'EXACT',         // remote SHA-256 matches the generated artifact
  REENCODED: 'REENCODED', // remote retrievable + aspect-compatible but SHA differs
  UNKNOWN: 'UNKNOWN',     // remote could not be fetched
}

/** Resolve the authoritative remote thumbnail object from YouTube's response. */
export function resolveRemoteThumbnail(video) {
  const thumbnails = video?.snippet?.thumbnails ?? {}
  return (
    thumbnails.maxres ??
    thumbnails.standard ??
    thumbnails.high ??
    thumbnails.medium ??
    thumbnails.default ??
    null
  )
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
    // SOURCE contract (LOCAL canonical): used for reporting, NOT to require the
    // remote representation to equal these exact dimensions.
    this.expectedWidth = options.expectedWidth || null
    this.expectedHeight = options.expectedHeight || null
    this.expectedAspectRatio = options.expectedAspectRatio || null
  }

  async headers() {
    return { 'Authorization': `Bearer ${this.token}` }
  }

  /**
   * Verify video visibility and custom thumbnail acceptance with propagation retries.
   * @param {{ videoId: string, sha256?: string, thumbnailPath?: string }} params
   * @returns {object} state + source (local canonical) + remote + identity
   */
  async verify({ videoId, sha256, thumbnailPath }) {
    const startTime = Date.now()
    const attempts = []
    const expectedSha256 = sha256 || this.sha256 || null
    const wantAR = this.expectedAspectRatio

    const source = {
      width: this.expectedWidth,
      height: this.expectedHeight,
      aspectRatio: wantAR,
      sha256: expectedSha256,
    }

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
              video: null, hasCustomThumbnail: false, source, remote: null, identity: null,
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
              video: null, hasCustomThumbnail: false, source, remote: null, identity: null,
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

        // B. YouTube acceptance — the primary signal.
        const hasCustomThumbnail = video.contentDetails?.hasCustomThumbnail === true

        if (!hasCustomThumbnail) {
          attempts.push({ attempt, found: true, hasCustomThumbnail: false, durationMs: Date.now() - attemptStart })
          return {
            state: VerifyState.CUSTOM_THUMBNAIL_REJECTED,
            video,
            hasCustomThumbnail: false,
            source,
            remote: null,
            identity: null,
            attempts,
            durationMs: Date.now() - startTime,
          }
        }

        // C. Remote representation — authoritative URL + dimensions from the API.
        const remoteThumb = resolveRemoteThumbnail(video)
        if (!remoteThumb?.url) {
          attempts.push({ attempt, found: true, hasCustomThumbnail: true, reason: 'no remote url', durationMs: Date.now() - attemptStart })
          return {
            state: VerifyState.CUSTOM_THUMBNAIL_PENDING,
            video,
            hasCustomThumbnail: true,
            source,
            remote: null,
            identity: null,
            attempts,
            durationMs: Date.now() - startTime,
          }
        }
        const remote = {
          url: remoteThumb.url,
          width: remoteThumb.width != null ? Number(remoteThumb.width) : null,
          height: remoteThumb.height != null ? Number(remoteThumb.height) : null,
          aspectRatio: (remoteThumb.width && remoteThumb.height)
            ? this._ratioString(Number(remoteThumb.width), Number(remoteThumb.height))
            : null,
          sha256: null,
        }

        try {
          const buf = await this._downloadThumbnail(remote.url)
          remote.sha256 = await this.sha256Fn(buf)
          remote.bytes = buf.length
        } catch (e) {
          // Cannot fetch/hash the remote asset yet.
          const transient = /timeout|network|fetch/i.test(String(e.message))
          attempts.push({ attempt, found: true, hasCustomThumbnail: true, remote: { url: remote.url }, remoteError: e.message, durationMs: Date.now() - attemptStart })
          if (transient && attempt < this.maxAttempts) { await this._delay(attempt); continue }
          return {
            state: VerifyState.CUSTOM_THUMBNAIL_UNKNOWN,
            video,
            hasCustomThumbnail: true,
            source,
            remote: { ...remote, sha256: null },
            identity: ThumbnailIdentity.UNKNOWN,
            attempts,
            durationMs: Date.now() - startTime,
          }
        }

        // D. Identity — accept on hasCustomThumbnail + retrievable + aspect-compatible.
        const aspectCompatible = this._aspectCompatible(remote.width, remote.height, wantAR)
        if (aspectCompatible === false) {
          return {
            state: VerifyState.CUSTOM_THUMBNAIL_REJECTED,
            video,
            hasCustomThumbnail: true,
            source,
            remote,
            identity: null,
            reason: `remote aspect incompatible with ${wantAR} (${remote.width || '?'}x${remote.height || '?'})`,
            attempts,
            durationMs: Date.now() - startTime,
          }
        }

        const matches = expectedSha256
          ? remote.sha256.toLowerCase() === expectedSha256.toLowerCase()
          : null
        const identity = expectedSha256 ? (matches ? ThumbnailIdentity.EXACT : ThumbnailIdentity.REENCODED) : ThumbnailIdentity.REENCODED

        attempts.push({
          attempt, found: true, hasCustomThumbnail, remote: { url: remote.url, width: remote.width, height: remote.height }, identity,
          expectedSha256: expectedSha256 ? expectedSha256.slice(0, 12) : null,
          durationMs: Date.now() - attemptStart,
        })

        return {
          state: VerifyState.CUSTOM_THUMBNAIL_ACCEPTED,
          video,
          hasCustomThumbnail: true,
          source,
          remote,
          identity,
          thumbnailMatches: matches,
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
      source,
      remote: null,
      identity: null,
      attempts,
      durationMs: Date.now() - startTime,
    }
  }

  // Remote is aspect-compatible with the canonical profile. It does NOT require
  // exact width/height equality — YouTube may downscale the representation. A
  // null result means "unknown geometry" → treated as compatible (don't reject).
  _aspectCompatible(width, height, wantAR) {
    if (!width || !height || !wantAR) return null
    const actual = width / height
    const want = this._ratioToFloat(wantAR)
    if (!want) return null
    return Math.abs(actual - want) < 0.05
  }

  _ratioString(w, h) {
    const gcd = (a, b) => (b ? gcd(b, a % b) : a)
    const g = gcd(w, h)
    return `${w / g}:${h / g}`
  }

  _ratioToFloat(s) {
    const m = /^(\d+)\s*[:/]\s*(\d+)$/.exec(String(s || '').trim())
    return m ? Number(m[1]) / Number(m[2]) : null
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
