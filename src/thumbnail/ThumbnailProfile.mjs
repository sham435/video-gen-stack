// ThumbnailProfile + ThumbnailValidationError — canonical thumbnail geometry.
//
// The whole pipeline has ONE canonical thumbnail per media profile. A Short
// (the production default) is 2160x3840 (9:16) — YouTube's current documented
// recommendation for Shorts — matching the video frame, and used everywhere:
// YouTube custom thumbnail, GitHub Pages gallery, LinkedIn. No destination
// generates its own variant unless it has a documented need.
//
// enforceProfile(media, thumbnail) throws when the thumbnail geometry does not
// match the media profile — this is the single gate that prevents a stale
// 16:9 asset from ever becoming the canonical Short thumbnail.

export class ThumbnailValidationError extends Error {
  constructor(code, message) {
    super(message)
    this.name = 'ThumbnailValidationError'
    this.code = code
  }
}

// Approximate hard ceiling for the canonical asset, with headroom under
// YouTube's 50 MB desktop upload limit.
export const MAX_THUMBNAIL_BYTES = 45 * 1024 * 1024

export const ThumbnailProfile = {
  SHORT: { width: 2160, height: 3840, aspectRatio: '9:16', mediaType: 'short' },
  VIDEO: { width: 3840, height: 2160, aspectRatio: '16:9', mediaType: 'video' },
}

/** Pick the profile for a media object ({ width, height, type }). */
export function resolveThumbnailProfile(media = {}) {
  const w = Number(media.width)
  const h = Number(media.height)
  const t = String(media.type || media.mediaType || '').toLowerCase()
  if (t === 'short' || (w === 2160 && h === 3840) || (media.aspectRatio === '9:16')) {
    return ThumbnailProfile.SHORT
  }
  if (t === 'video' || (w === 3840 && h === 2160) || (media.aspectRatio === '16:9')) {
    return ThumbnailProfile.VIDEO
  }
  // Aspect-ratio-only match: 9:16 → SHORT, 16:9 → VIDEO.
  if (media.aspectRatio) {
    const ratio = String(media.aspectRatio)
    if (ratio === '9:16') return ThumbnailProfile.SHORT
    if (ratio === '16:9') return ThumbnailProfile.VIDEO
  }
  // Default to SHORT for vertical or unknown media; VIDEO otherwise.
  return h > w ? ThumbnailProfile.SHORT : ThumbnailProfile.VIDEO
}

/**
 * Enforce that the thumbnail geometry matches the media profile. Throws
 * THUMBNAIL_METADATA_MISSING / THUMBNAIL_PROFILE_MISMATCH when the canonical
 * asset does not fit the frame, and THUMBNAIL_TOO_LARGE when the file exceeds
 * the size ceiling (45 MB). Returns the resolved profile.
 */
export function enforceThumbnailProfile(media = {}, thumbnail = {}) {
  const profile = resolveThumbnailProfile(media)
  const wantW = profile.width
  const wantH = profile.height
  const gotW = Number(thumbnail?.width)
  const gotH = Number(thumbnail?.height)
  const gotBytes = Number(thumbnail?.bytes)

  if (!gotW || !gotH) {
    throw new ThumbnailValidationError(
      'THUMBNAIL_METADATA_MISSING',
      `thumbnail width/height unavailable (got ${gotW}x${gotH})`
    )
  }
  if (gotW !== wantW || gotH !== wantH) {
    throw new ThumbnailValidationError(
      'THUMBNAIL_PROFILE_MISMATCH',
      `profile ${profile.mediaType} requires ${wantW}x${wantH} (${profile.aspectRatio}), got ${gotW}x${gotH}`
    )
  }
  if (gotBytes != null && gotBytes > MAX_THUMBNAIL_BYTES) {
    throw new ThumbnailValidationError(
      'THUMBNAIL_TOO_LARGE',
      `thumbnail ${gotBytes} bytes exceeds ${MAX_THUMBNAIL_BYTES} (${(gotBytes / 1024 / 1024).toFixed(1)}MB > 45MB)`
    )
  }
  return profile
}
