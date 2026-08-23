// ThumbnailVerifier — verifies YouTube thumbnail state after upload.
//
// After thumbnails.set(), queries the YouTube API to confirm the
// thumbnail was actually applied. Prevents silent failures where the
// video publishes with a default/auto-generated frame.

const BASE = 'https://www.googleapis.com/youtube/v3'

export class ThumbnailVerifier {
  constructor(options = {}) {
    this.transport = options.transport || globalThis.fetch
    this.timeout = options.timeout || 10000
  }

  async verify(videoId, token) {
    if (!videoId || !token) {
      return { valid: false, error: 'videoId and token required', thumbnails: [] }
    }

    try {
      const res = await this.transport(
        `${BASE}/videos?part=snippet&id=${videoId}`,
        {
          headers: { Authorization: `Bearer ${token}` },
          signal: AbortSignal.timeout(this.timeout),
        }
      )

      if (!res.ok) {
        return { valid: false, error: `API returned ${res.status}`, thumbnails: [] }
      }

      const data = await res.json()
      const video = data.items?.[0]
      if (!video) {
        return { valid: false, error: 'video not found', thumbnails: [] }
      }

      const thumbs = video.snippet?.thumbnails || {}
      const hasCustom = Boolean(thumbs.maxres || thumbs.standard || thumbs.high)
      const isDefault = Boolean(thumbs.default && !thumbs.maxres && !thumbs.standard && !thumbs.high)

      return {
        valid: hasCustom,
        isDefault,
        thumbnails: Object.entries(thumbs).map(([key, val]) => ({
          key,
          url: val.url,
          width: val.width,
          height: val.height,
        })),
        error: isDefault ? 'only default thumbnail present — custom not applied' : null,
      }
    } catch (e) {
      return { valid: false, error: e.message, thumbnails: [] }
    }
  }

  async waitForProcessing(videoId, token, maxAttempts = 10, delayMs = 3000) {
    for (let i = 0; i < maxAttempts; i++) {
      const result = await this.verify(videoId, token)
      if (result.valid) return result
      if (i < maxAttempts - 1) {
        await new Promise(r => setTimeout(r, delayMs))
      }
    }
    return this.verify(videoId, token)
  }
}
