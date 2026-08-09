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
    size: 54,
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

    // Broadcast grid: left zone (logo+AVAILABLE/badges), center whitespace,
    // right zone (subscribe pill + URL/tagline). The right zone is widened so
    // the site URL renders at a legible size instead of ellipsizing to a few
    // characters — readability wins over a visually symmetric 25/50/25 split.
    grid: { left: 0.24, center: 0.46, right: 0.30 },

    // Brand + tagline stack (left zone)
    logoSize: 48,
    brand: { size: 38, weight: 900 },
    tagline: { size: 22, weight: 600, gap: 9 },

    // AVAILABLE ON + platform badges (left zone, below the logo)
    available: { size: 24, weight: 800 },
    platformIcon: 34,
    platformGap: 10,

    // URL + URL tagline group (right zone, below the pill). The URL is the
    // primary CTA: 30px is the broadcast legibility floor (enforced by the
    // text-legibility preflight); the tagline under it breathes with 1.30
    // leading, and a long URL degrades to its domain, never to a tiny ellipsis.
    url: { size: 30, weight: 900 },
    urlTagline: { size: 26, weight: 600 },
    urlLeading: 1.30,

    // YouTube subscribe pill — strongest CTA in the footer:
    // 50px hier / 25px radius / 26px icon / 24px bold label.
    pill: { height: 50, radius: 25, icon: 26, labelSize: 24, weight: 800 },

    // Vertical rhythm between stacked lines/groups — 20–30% looser than the
    // old tight stack so AVAILABLE ON / URL / tagline read as separate lines.
    lineGap: 16,

    // Responsive: font scale relative to the 1080px design width.
    baseWidth: 1080,
    minScale: 0.5,
    maxScale: 1.5,

    // Soft floor for the bar: the layout grows with content, this is the
    // minimum chrome height (safe-zone contract — captions never enter).
    minHeight: 180,

    // Back-compat aliases (legacy chrome consumers).
    urlSize: 30,
    iconSize: 34,
    height: 180,
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
  close: {
    // Brand outro stack (brand_close scene): STAY WITH / NEWS-MONSTER /
    // tagline / anchor badge. Everything must sit ABOVE the footer bar top
    // (FooterLayout.barTopInFrame) — the footer owns the bottom safe zone.
    tagline: { size: 40, weight: 900, leading: 1.42, maxWidth: 920 },
    anchor: {
      badgeH: 60,
      fontSize: 40,
      subSize: 28,
      gap: 26, // clearance below the tagline block
      margin: 26, // clearance above the footer bar top
    },
  },
  safeZone: {
    top: 0.15, // 15% reserved for bugs/banners
    bottom: 0.85, // 85% for footer
  },
}
