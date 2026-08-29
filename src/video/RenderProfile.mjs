// RenderProfile — central resolution contract between the LOGICAL design
// space and the PHYSICAL output canvas.
//
// The renderer is authored in a LOGICAL coordinate system (1080x1920 for
// Shorts) and resolves to a PHYSICAL output (2160x3840) by applying a scale
// factor. Nothing downstream should hardcode pixel geometry — it receives a
// profile and uses sx()/sy()/sf() (or percent-based positioning) so the same
// composition is safe at any resolution.
//
// Do NOT globally sed 1080→2160. Keep logical design coordinates and scale.

export const RenderProfiles = {
  SHORT_4K: Object.freeze({
    type: 'SHORT',
    logical: { width: 1080, height: 1920 },
    output: { width: 2160, height: 3840 },
    scale: 2160 / 1080, // 2
    aspectRatio: '9:16',
    fps: 30,
  }),

  VIDEO_HD: Object.freeze({
    type: 'VIDEO',
    logical: { width: 1280, height: 720 },
    output: { width: 1920, height: 1080 },
    scale: 1920 / 1280, // 1.5
    aspectRatio: '16:9',
    fps: 30,
  }),
}

export const DEFAULT_PROFILE = RenderProfiles.SHORT_4K

/** Resolve a profile from a media descriptor ({ width, height, type }). */
export function resolveRenderProfile(media = {}) {
  const t = String(media.type || '').toLowerCase()
  if (t === 'short' || (media.aspectRatio && String(media.aspectRatio) === '9:16')) {
    return RenderProfiles.SHORT_4K
  }
  if (t === 'video' || (media.aspectRatio && String(media.aspectRatio) === '16:9')) {
    return RenderProfiles.VIDEO_HD
  }
  const w = Number(media.width)
  const h = Number(media.height)
  if (w && h) return h > w ? RenderProfiles.SHORT_4K : RenderProfiles.VIDEO_HD
  return DEFAULT_PROFILE
}

/** Profile-relative scale helpers — multiply logical design values. */
export const sx = (v, profile = DEFAULT_PROFILE) => v * profile.scale
export const sy = (v, profile = DEFAULT_PROFILE) => v * profile.scale
export const sf = (v, profile = DEFAULT_PROFILE) => v * profile.scale
