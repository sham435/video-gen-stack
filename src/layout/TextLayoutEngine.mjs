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
      // Fit against the SAME line-height the layout will store. Without this
      // the fitter validates height at the 1.25 default and flags a caption as
      // fitting that assertSafe later quarantines. Narration (caption/headline)
      // is spaced at 2.5x: clear air between lines (observed 16:9 overlap was
      // crushed further by HeadlineCard's design-space rescale — fixed there).
      lineHeightFactor: lineHeightFactorFor(role),
      // Narration sentences: 'A. B.' — break after each sentence so a 2-sentence
      // VO renders as exactly 2 LARGE centered lines (font fills the zone)
      // instead of 3-4 small word-wrapped lines.
      preferSentences: role === 'headline' || role === 'caption',
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
    const lineHeight = FontMetrics.lineHeight(fitted.fontSize, lineHeightFactorFor(role))
    const width = Math.max(...fitted.wrap.widths, 0)
    const height = lines.length * lineHeight

    const manifest = {
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
    // TextBlock-compatible fields (spec model): every manifest is also a valid
    // TextBlock descriptor so renderers can hand it straight to renderTextBlock
    // — one measured block, positioned once, drawn with ONE line-height step.
    manifest.fontFamily = fontFamily === 'Inter' && role !== 'source' ? 'Inter' : fontFamily
    manifest.fontWeight = cfg.weight || 900
    manifest.maxWidth = zone.width
    manifest.maxLines = lineCap
    manifest.lineHeightFactor = lineHeightFactorFor(role)
    manifest.letterSpacing = 0
    manifest.textAlign = 'center'
    manifest.anchorX = 'center'
    manifest.anchorY = 'middle'
    manifest.opacity = 1
    return manifest
  }

  static measure(text, fontSize, fontFamily = 'Inter') {
    return FontMetrics.measure(text, fontSize, fontFamily)
  }
}

// Per-role line-height multiplier. Narration (caption/headline) is spaced at
// 2.5x: clear air between lines, and being tighter than 3.0x lets the fitter
// reach a ~50% larger font for the same 2-line zone (the observed overlap bug
// shipped multi-line VO sentences at the cramped 1.25 default — 2.0x still
// collided because drawHeadlineCard re-scaled the layout's already-logical
// lineHeight through the 1920-design sy() divider; that double-scaling is
// fixed there). Lower-priority roles keep the FontMetrics default of 1.25.
function lineHeightFactorFor(role) {
  return role === 'caption' || role === 'headline' ? 2.5 : 1.25
}
