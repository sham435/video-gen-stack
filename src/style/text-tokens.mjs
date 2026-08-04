// Broadcast-safe text tokens for 1080x1920 9:16 renders.
// Anything under 24px is invisible after YouTube/TikTok compression, so every
// chrome layer (bug, LIVE, footer) and every reading layer (caption, emphasis)
// must consume these minimums. Renderers import these — no hard-coded sizes.

export const BROADCAST_TEXT = {
  bug: {
    size: 38,
    weight: 700,
    bg: 'rgba(0,0,0,0.88)',
    padding: [8, 16],
    borderRadius: 4,
  },
  live: {
    size: 40,
    weight: 700,
    bg: '#D0021B',
    padding: [8, 16],
    borderRadius: 4,
  },
  footer: {
    size: 46,
    height: 100,
    weight: 800,
    urlSize: 56,
    iconSize: 64,
  },
  caption: {
    minSize: 32,
    maxLines: 2,
    backdrop: 0.4,
    padding: 12,
    maxChars: 80,
  },
  emphasis: {
    minSize: 120,
    maxSize: 180,
    strokeWidth: 4,
  },
  safeZone: {
    top: 0.15, // 15% reserved for bugs/banners
    bottom: 0.85, // 85% for footer
  },
}
