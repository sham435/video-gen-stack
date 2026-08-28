// ThumbnailProfile + ThumbnailValidationError — canonical thumbnail geometry.
//
// The whole pipeline has ONE canonical thumbnail per media profile. A Short
// (the production default) is 1080x1920 (9:16), matching the video frame, and
// used everywhere: YouTube custom thumbnail, GitHub Pages gallery, LinkedIn.
// No destination generates its own variant unless it has a documented need.
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

export const ThumbnailProfile = {
  SHORT: { width: 1080, height: 1920, aspectRatio: '9:16', mediaType: 'short' },
  VIDEO: { width: 1280, height: 720, aspectRatio: '16:9', mediaType: 'video' },
}

/** Pick the profile for a media object ({ width, height, type }). */
export function resolveThumbnailProfile(media = {}) {
  const w = Number(media.width)
  const h = Number(media.height)
  const t = String(media.type || '').toLowerCase()
  if (t === 'short' || (w === 1080 && h === 1920) || (media.aspectRatio === '9:16')) {
    return ThumbnailProfile.SHORT
  }
  if (t === 'video' || (w === 1280 && h === 720) || (media.aspectRatio === '16:9')) {
    return ThumbnailProfile.VIDEO
  }
  // Default to SHORT for vertical or unknown media; VIDEO otherwise.
  return h > w ? ThumbnailProfile.SHORT : ThumbnailProfile.VIDEO
}

/**
 * Enforce that the thumbnail geometry matches the media profile. Throws
 * THUMBNAIL_PROFILE_MISMATCH when the canonical asset does not fit the frame.
 */
export function enforceThumbnailProfile(media = {}, thumbnail = {}) {
  const profile = resolveThumbnailProfile(media)
  const wantW = profile.width
  const wantH = profile.height
  const gotW = Number(thumbnail?.width)
  const gotH = Number(thumbnail?.height)

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
  return profile
}
