// RenderProfile — central resolution contract between the LOGICAL design
// space and the PHYSICAL output canvas.
//
// The renderer is authored in a LOGICAL coordinate system (1280x720 for 16:9)
// and resolves to a PHYSICAL output (1920x1080) by applying a scale factor.
// Nothing downstream should hardcode pixel geometry — it receives a profile
// and uses sx()/sy()/sf() (or percent-based positioning) so the same
// composition is safe at any resolution.
//
// The pipeline is 16:9 (standard YouTube) ONLY. A single profile is exported
// directly; no resolution function or branch exists because there is no
// alternate aspect.
//
// Do NOT globally sed 1280→1920. Keep logical design coordinates and scale.

// The single production render profile: 1280x720 logical → 1920x1080 output.
export const VIDEO_HD = Object.freeze({
  type: 'VIDEO',
  logical: { width: 1280, height: 720 },
  output: { width: 1920, height: 1080 },
  scale: 1920 / 1280, // 1.5
  aspectRatio: '16:9',
  fps: 30,
})

// Profile-relative scale helpers — multiply logical design values.
export const DEFAULT_PROFILE = VIDEO_HD
export const sx = (v, profile = DEFAULT_PROFILE) => v * profile.scale
export const sy = (v, profile = DEFAULT_PROFILE) => v * profile.scale
export const sf = (v, profile = DEFAULT_PROFILE) => v * profile.scale
