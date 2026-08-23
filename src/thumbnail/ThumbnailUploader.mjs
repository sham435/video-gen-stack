// ThumbnailUploader — uploads thumbnail to YouTube and verifies state.
//
// Pipeline position:
//   ThumbnailFactory.select() → ThumbnailUploader.upload() → ThumbnailVerifier.verify()
//
// Upload uses the YouTube Data API v3 thumbnails.set endpoint.
// After upload, calls ThumbnailVerifier to confirm the thumbnail was applied.

import { ThumbnailVerifier } from './ThumbnailVerifier.mjs'
import { existsSync, readFileSync } from 'node:fs'

const THUMBNAIL_SET_URL = 'https://www.googleapis.com/upload/youtube/v3/thumbnails/set'

export class ThumbnailUploader {
  constructor(options = {}) {
    this.transport = options.transport || globalThis.fetch
    this.verifier = options.verifier || new ThumbnailVerifier()
    this.timeout = options.timeout || 30000
  }

  async upload({ videoId, thumbnailPath, token }) {
    if (!videoId) throw new Error('videoId required')
    if (!token) throw new Error('token required')
    if (!thumbnailPath || !existsSync(thumbnailPath)) {
      return { success: false, error: `thumbnail not found: ${thumbnailPath}` }
    }

    const buffer = readFileSync(thumbnailPath)
    const boundary = 'thumb_boundary'
    const parts = [
      new TextEncoder().encode(`--${boundary}\r\nContent-Type: image/png\r\n\r\n`),
      buffer,
      new TextEncoder().encode(`\r\n--${boundary}--\r\n`),
    ]
    const body = new Uint8Array(parts.reduce((acc, b) => acc + b.length, 0))
    let offset = 0
    for (const b of parts) { body.set(b, offset); offset += b.length }

    const res = await this.transport(
      `${THUMBNAIL_SET_URL}?videoId=${encodeURIComponent(videoId)}`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': `multipart/related; boundary=${boundary}`,
        },
        body,
        signal: AbortSignal.timeout(this.timeout),
      }
    )

    const data = await res.json().catch(() => ({}))
    if (data.error) {
      return { success: false, error: data.error.message || JSON.stringify(data.error) }
    }

    return {
      success: true,
      items: data.items || [],
      thumbnailId: data.items?.[0]?.id || null,
    }
  }

  async uploadAndVerify({ videoId, thumbnailPath, token }) {
    const uploadResult = await this.upload({ videoId, thumbnailPath, token })

    if (!uploadResult.success) {
      return { ...uploadResult, verified: false }
    }

    // Wait for YouTube to process the thumbnail
    const verifyResult = await this.verifier.waitForProcessing(videoId, token, 5, 2000)

    return {
      ...uploadResult,
      verified: verifyResult.valid,
      verificationError: verifyResult.error,
      thumbnails: verifyResult.thumbnails,
    }
  }
}
