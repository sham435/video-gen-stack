import { withTransientRetry } from './retry.mjs'
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

// LinkedInPublisher — platform wrapper around the existing LinkedIn auth +
// posting infrastructure (apps/api/publishers/linkedin.js). Publishes a
// colourful image/text promotional post for the video.
//
// Returns { platform, status, postId, url }

const PERMANENT_STATUS = new Set([400, 401, 403, 404, 422])

function pickThumbnail(thumbnailPath) {
  const candidates = [
    thumbnailPath,
    'output/cover.png',
    resolve(process.cwd(), 'output', 'cover_breaking.png'),
    resolve(process.cwd(), 'output', 'cover_cinematic.png'),
  ].filter(Boolean)
  for (const p of candidates) if (existsSync(p)) return p
  return null
}

export class LinkedInPublisher {
  constructor({ accessToken = null, memberUrn = null, shareImage = null, getCredentials = null } = {}) {
    // Dependency injection for tests; defaults load lazily from the publisher.
    this._accessToken = accessToken
    this._memberUrn = memberUrn
    this._shareImage = shareImage
    this._getCredentials = getCredentials
  }

  isConfigured() {
    try {
      const token = this._accessToken || process.env.LINKEDIN_ACCESS_TOKEN
      const urn = this._memberUrn || process.env.LINKEDIN_MEMBER_URN
      return !!(token && urn)
    } catch { return false }
  }

  async _load() {
    if (this._shareImage) return this
    const { shareImage, accessToken, memberUrn } = await import('../../apps/api/publishers/linkedin.js')
    this._shareImage = this._shareImage || shareImage
    this._accessToken = this._accessToken || accessToken()
    this._memberUrn = this._memberUrn || memberUrn()
    return this
  }

  /**
   * Publish the promotional post. post = generated payload from
   * SocialPostGenerator with { commentary, media }.
   * Returns { platform, status, postId, url }.
   */
  async publish({ videoId, post }) {
    await this._load()
    if (!this.isConfigured()) {
      return {
        platform: 'linkedin',
        status: 'skipped',
        reason: 'LINKEDIN_ACCESS_TOKEN or LINKEDIN_MEMBER_URN missing — promotional post skipped',
      }
    }

    const thumbnail = pickThumbnail(post.thumbnailPath)
    let result
    try {
      result = await withTransientRetry(async () => {
        if (thumbnail) {
          const { readFileSync } = await import('node:fs')
          const b64 = readFileSync(thumbnail).toString('base64')
          try {
            return await this._shareImage(
              this._accessToken,
              this._memberUrn,
              `data:image/png;base64,${b64}`,
              post.commentary,
              post.media?.url
            )
          } catch (imageErr) {
            // Image upload failed (e.g. scope/format) — fall back to a plain
            // text/URL share rather than dropping the post entirely.
            console.warn(`[LINKEDIN] image post failed (${imageErr.message}) — falling back to text share`)
            const { sharePost } = await import('../../apps/api/publishers/linkedin.js')
            return await sharePost(this._accessToken, this._memberUrn, post.commentary, post.media?.url)
          }
        }
        const { sharePost } = await import('../../apps/api/publishers/linkedin.js')
        return await sharePost(this._accessToken, this._memberUrn, post.commentary, post.media?.url)
      }, { attempts: 3 })
    } catch (err) {
      const status = Number(err?.status) || 0
      return {
        platform: 'linkedin',
        status: PERMANENT_STATUS.has(status) ? 'failed' : 'failed',
        error: err.message,
        retryable: !PERMANENT_STATUS.has(status),
      }
    }

    const postId = result?.id || result?.urn || null
    const url = postId
      ? `https://www.linkedin.com/feed/update/${postId.replace('urn:li:share:', '').replace('urn:li:ugcPost:', '')}`
      : null
    return {
      platform: 'linkedin',
      status: postId ? 'published' : 'failed',
      postId,
      url,
      thumbnail: thumbnail ? true : false,
    }
  }
}