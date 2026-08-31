// ThumbnailProfile + ThumbnailValidationError — canonical thumbnail geometry.
//
// The pipeline has ONE canonical thumbnail: 3840x2160 (16:9) VIDEO — matching
// the 16:9 video frame, and used everywhere: YouTube custom thumbnail (via
// thumbnails.set for the channel shelf), GitHub Pages gallery, LinkedIn. No
// destination generates its own variant unless it has a documented need.
//
// enforceProfile(media, thumbnail) throws when the thumbnail geometry does not
// match the canonical profile — this is the single gate that prevents a stale
// asset from ever becoming the canonical 16:9 thumbnail. The resolution
// machinery is retained (it always resolves to VIDEO) so downstream recovery /
// validation code keeps working and can be repointed if an alternate aspect is
// ever reintroduced.

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

// The single canonical thumbnail profile: 3840x2160 (16:9) matching VIDEO_HD.
export const VIDEO = Object.freeze({
  width: 3840,
  height: 2160,
  aspectRatio: '16:9',
  mediaType: 'video',
})

// Retained as the canonical profile (16:9 only).
export const ThumbnailProfile = { VIDEO }

/**
 * Resolve the canonical thumbnail profile for a media object. The pipeline is
 * 16:9 only, so this always resolves to VIDEO.
 */
export function resolveThumbnailProfile(media = {}) {
  return VIDEO
}

/**
 * Enforce that the thumbnail geometry matches the canonical profile. Throws
 * THUMBNAIL_METADATA_MISSING / THUMBNAIL_PROFILE_MISMATCH when the asset does
 * not fit the frame, and THUMBNAIL_TOO_LARGE when the file exceeds the size
 * ceiling (45 MB). Returns the resolved profile (VIDEO).
 */
export function enforceThumbnailProfile(media = {}, thumbnail = {}) {
  const profile = VIDEO
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
