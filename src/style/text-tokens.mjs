// Broadcast-safe text tokens for 1080x1920 9:16 renders.
// Anything under 24px is invisible after YouTube/TikTok compression, so every
// chrome layer (bug, LIVE, footer) and every reading layer (caption, emphasis)
// must consume these minimums. Renderers import these — no hard-coded sizes.

export const BROADCAST_TEXT = {
  bug: {
    size: 54,
    weight: 900,
    bg: 'rgba(5,5,5,0.96)',
    padding: [10, 20],
    borderRadius: 8,
  },
  live: {
    size: 40,
    weight: 700,
    bg: '#D0021B',
    padding: [8, 16],
    borderRadius: 4,
  },
  footer: {
    // Layout chrome (bar): 180px bottom safe zone owned exclusively by the
    // footer — captions never render inside it.
    height: 180,
    padding: { x: 18, y: 12 },
    bg: 'rgba(5,5,5,0.96)',
    border: 'rgba(255,255,255,0.22)',
    accent: '#E10600',
    text: '#FFFFFF',
    muted: 'rgba(255,255,255,0.72)',

    // Broadcast grid: 25% | 50% | 25% — left logo+AVAILABLE, empty center,
    // right subscribe + URL/tagline group. Logo keeps its exact current size.
    grid: { left: 0.25, center: 0.5, right: 0.25 },

    // Brand + tagline stack (left zone)
    logoSize: 48,
    brand: { size: 38, weight: 900 },
    tagline: { size: 18, weight: 600, gap: 6 },

    // AVAILABLE ON + platform badges (left zone, below the logo)
    available: { size: 20, weight: 800 },
    platformIcon: 34,
    platformGap: 10,

    // URL + URL tagline group (right zone, below the pill)
    url: { size: 30, weight: 900 },
    urlTagline: { size: 25, weight: 600 },

    // YouTube subscribe pill — strongest CTA in the footer:
    // 50px hier / 25px radius / 26px icon / 24px bold label.
    pill: { height: 50, radius: 25, icon: 26, labelSize: 24, weight: 800 },

    // Responsive: font scale relative to the 1080px design width.
    baseWidth: 1080,
    minScale: 0.5,
    maxScale: 1.5,

    // Back-compat aliases (legacy chrome consumers).
    urlSize: 30,
    iconSize: 34,
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
