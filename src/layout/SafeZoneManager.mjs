// SafeZoneManager — reserves screen regions, detects text collisions, and
// validates layouts. Two surfaces:
//
// A) Legacy collision API (used by quality analyzers): SAFE_ZONES rects,
//    intersects(a, b), zoneFor(position), validate(layer, zoneRect).
//
// B) Layout engine API: role zones computed from canvas ratios + per-role
//    configuration (priority, legibility floor, max lines). The safe zone is
//    an input constraint for TextLayoutEngine, not a post-render check, and
//    assertSafe() is the hard gate before FFmpeg.
//
// Role priority: emphasis > headline > caption > source. Higher priority
// roles get a wider stage, a taller band, and a higher minimum-legibility
// floor, so when space is contested the emphasis keyword stays big while
// captions shrink.

// --- A) Legacy collision zones (match the actual renderer layout) ---
export const SAFE_ZONES = {
  headline: { x: 0, y: 1080, width: 1080, height: 240 },        // hook headline band
  subject: { x: 200, y: 320, width: 680, height: 700 },         // face/object band — no text
  caption: { x: 0, y: 1340, width: 1080, height: 300 },         // word-caption band
  logo: { x: 850, y: 850, width: 180, height: 100 },            // lower-right logo
}

// --- B) Layout roles ---
export const ROLE_CONFIG = {
  emphasis: { priority: 3, widthRatio: 0.90, heightRatio: 0.35, anchor: 0.40, floor: 30, maxLines: 2 },
  headline: { priority: 2, widthRatio: 0.85, heightRatio: 0.25, anchor: 0.30, floor: 20, maxLines: 3 },
  caption:  { priority: 1, widthRatio: 0.85, heightRatio: 0.25, anchor: 0.78, floor: 14, maxLines: 2 },
  source:   { priority: 0, widthRatio: 0.85, heightRatio: 0.20, anchor: 0.90, floor: 14, maxLines: 1 },
}

export class SafeZoneManager {
  // ---- Legacy collision API ----

  static intersects(a, b) {
    return !(
      a.x + a.width < b.x ||
      b.x + b.width < a.x ||
      a.y + a.height < b.y ||
      b.y + b.height < a.y
    )
  }

  // Map a layer position to its zone rect (normalized 0..1 → pixels)
  static zoneFor(position) {
    const map = {
      top: 'headline', top_center: 'headline', bottom: 'caption',
      bottom_right: 'logo', center: 'subject',
    }
    return SAFE_ZONES[map[position] || 'caption']
  }

  // Check a text layer stays within its safe zone + doesn't collide with subject
  static validate(layer, zoneRect, subjectRect = SAFE_ZONES.subject) {
    const rect = zoneRect || this.zoneFor(layer.position)
    if (!rect) return { ok: false, reason: 'no zone for position' }

    // Text rect approximation: width proportional to text length
    const textWidth = Math.min(900, Math.max(120, String(layer.text || '').length * 24))
    const textRect = { x: rect.x, y: rect.y, width: textWidth, height: rect.height * 0.5 }

    if (textRect.x + textRect.width > rect.x + rect.width) {
      return { ok: false, reason: `text exceeds safe zone width (${layer.type})` }
    }

    // Caption/headline must not overlap the subject (face/object) band
    if (layer.type !== 'source') {
      const overlapsSubject = this.intersects(textRect, subjectRect)
      if (overlapsSubject) return { ok: false, reason: `text overlaps subject band (${layer.type})` }
    }

    return { ok: true }
  }

  // ---- Layout engine API ----

  static roleConfig(role) {
    return ROLE_CONFIG[role] ?? ROLE_CONFIG.caption
  }

  // { left, right, top, bottom, width, height } for a role on a canvas.
  static roleZone(role, canvas = { width: 1080, height: 1920 }) {
    const cfg = SafeZoneManager.roleConfig(role)
    const zoneWidth = canvas.width * cfg.widthRatio
    const zoneHeight = canvas.height * cfg.heightRatio
    return {
      left: (canvas.width - zoneWidth) / 2,
      right: (canvas.width + zoneWidth) / 2,
      top: (canvas.height - zoneHeight) / 2,
      bottom: (canvas.height + zoneHeight) / 2,
      width: zoneWidth,
      height: zoneHeight,
    }
  }

  static contains(layout, zone) {
    if (!layout || !zone) return false
    return (
      layout.x >= zone.left - 1 &&
      layout.x + layout.width <= zone.right + 1 &&
      layout.height <= zone.height + 1
    )
  }

  // Hard gate: throws TEXT_OVERFLOW_BLOCKED_RENDER when a layout escapes
  // its safe zone or reports overflow.
  static assertSafe(layout, label = 'text') {
    if (!layout) return true
    const zone = SafeZoneManager.roleZone(layout.role || 'caption')
    if (layout.overflow || !SafeZoneManager.contains(layout, zone)) {
      throw new Error(
        `TEXT_OVERFLOW_BLOCKED_RENDER: ${label} escapes safe zone ` +
        `(role=${layout.role}, fontSize=${layout.fontSize}px, overflow=${layout.overflow}, ` +
        `x=${layout.x}, width=${layout.width}, zone=[${zone.left}..${zone.right}])`
      )
    }
    return true
  }
}
