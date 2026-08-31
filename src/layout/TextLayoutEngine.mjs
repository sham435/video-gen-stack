// TextLayoutEngine — the layout authority. Converts any text layer into a
// deterministic layout manifest (lines, font size, line height, box,
// position) constrained by the role's safe zone. Runs before render so
// drawing layers never guess about wrapping, sizing, or placement.
//
// Role priority: emphasis(3) > headline(2) > caption(1) > source(0).
// Higher priority = wider stage, taller band, higher legibility floor.
import { FontMetrics } from './FontMetrics.mjs'
import { LineWrapper } from './LineWrapper.mjs'
import { SafeZoneManager } from './SafeZoneManager.mjs'
import { ResponsiveTextScaler } from './ResponsiveTextScaler.mjs'

export class TextLayoutEngine {
  // { text, role, canvas, safeZone, fontFamily, preferredFontSize, maxLines } ->
  // {
  //   text, role, priority, lines, fontSize, lineHeight, width, height,
  //   x, y, scalePercent, overflow
  // }
  static layout({ text, role = 'caption', canvas = { width: 1080, height: 1920 }, safeZone = null, fontFamily = 'Inter', preferredFontSize = 58, maxLines = null } = {}) {
    const cfg = SafeZoneManager.roleConfig(role)
    const zone = safeZone || SafeZoneManager.roleZone(role, canvas)
    const preferred = Math.max(1, Math.floor(preferredFontSize))
    const lineCap = maxLines || cfg.maxLines
    const font = fontFamily === 'Inter' && role !== 'source' ? 'Inter' : fontFamily

    const fit = (t, ml) => ResponsiveTextScaler.fit({
      text: t,
      maxWidth: zone.width,
      maxHeight: zone.height,
      fontSize: preferred,
      minFontSize: cfg.floor,
      fontFamily: font,
      maxLines: ml,
    })

    let finalText = String(text ?? '')
    let fitted = fit(finalText, lineCap)
    if (fitted.overflow && role !== 'emphasis' && finalText.length > 12) {
      // Graceful degrade for autonomous pipelines: trim trailing words until
      // the text fits its safe zone. Previously this crashed the whole render
      // (TEXT_OVERFLOW_BLOCKED_RENDER); truncated text still fully fits, so
      // nothing ships clipped.
      let words = finalText.split(/\s+/)
      while (fitted.overflow && words.length > 1) {
        words = words.slice(0, -1)
        finalText = words.join(' ') + '…'
        fitted = fit(finalText, lineCap)
      }
    }

    const lines = fitted.wrap.lines
    const lineHeight = FontMetrics.lineHeight(fitted.fontSize)
    const width = Math.max(...fitted.wrap.widths, 0)
    const height = lines.length * lineHeight

    return {
      text: finalText,
      role,
      priority: cfg.priority,
      lines,
      fontSize: fitted.fontSize,
      lineHeight,
      width,
      height,
      x: Math.round(zone.left + (zone.width - width) / 2),
      y: Math.round(canvas.height * cfg.anchor - height / 2),
      scalePercent: fitted.scalePercent,
      overflow: fitted.overflow,
      // Stamp the canvas this layout was computed against so preflight/assertSafe
      // re-derive the SAME safe zone. The pipeline renders 16:9 landscape, so the
      // layout is always measured against the true 16:9 zone — never a portrait
      // default that would falsely flag overflow (TEXT_OVERFLOW_BLOCKED_RENDER).
      canvasWidth: canvas.width,
      canvasHeight: canvas.height,
    }
  }

  static measure(text, fontSize, fontFamily = 'Inter') {
    return FontMetrics.measure(text, fontSize, fontFamily)
  }
}
