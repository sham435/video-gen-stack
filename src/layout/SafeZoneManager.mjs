// Safe Zone Manager — reserves screen regions and detects text collisions.
// Never places text randomly; each layer maps to a designated band.
// Zones match the actual 1080x1920 renderer layout (InformationLayer +
// CaptionEngine): hook headline ~y1144-1236, word captions ~y1405-1630,
// visuals occupy the band above the headline.
export const SAFE_ZONES = {
  headline: { x: 0, y: 1080, width: 1080, height: 240 },        // hook headline band
  subject: { x: 200, y: 320, width: 680, height: 700 },         // face/object band — no text
  caption: { x: 0, y: 1340, width: 1080, height: 300 },         // word-caption band
  logo: { x: 850, y: 850, width: 180, height: 100 },            // lower-right logo
}

export class SafeZoneManager {
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

    // Caption/headline must not overlap the subject (face/object) band
    if (layer.type !== 'source') {
      const overlapsSubject = this.intersects(textRect, subjectRect)
      if (overlapsSubject) return { ok: false, reason: `text overlaps subject band (${layer.type})` }
    }

    return { ok: true }
  }
}
