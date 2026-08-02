// ResponsiveTextScaler — internal fit helper for TextLayoutEngine.
// Steps fontSize down in 2px increments until measured text fits
// maxWidth/maxHeight. Returns { fontSize, scalePercent, overflow }.
// Measurement is real (FontMetrics character advances + line wrapping),
// not a characters × multiplier heuristic.
import { FontMetrics } from './FontMetrics.mjs'
import { LineWrapper } from './LineWrapper.mjs'

export class ResponsiveTextScaler {
  static SHORTS = { widthRatio: 0.85, heightRatio: 0.25 }
  static SHORTS_CANVAS = { width: 1080, height: 1920 }

  // { text, maxWidth, maxHeight, fontSize, minFontSize = 18, fontFamily, maxLines } ->
  // { fontSize, scalePercent, overflow, wrap: { lines, widths } }
  static fit({ text, maxWidth, maxHeight, fontSize, minFontSize = 18, fontFamily = 'Inter', maxLines = Infinity } = {}) {
    const textStr = String(text || '')
    const startSize = Math.max(1, Math.floor(fontSize || 18))
    const floor = Math.max(1, Math.floor(minFontSize || 18))
    let size = startSize

    const wrapAt = (s) => LineWrapper.wrap({ text: textStr, maxWidth, fontSize: s, fontFamily, maxLines })
    const fits = (wrap) => {
      if (wrap.overflow) return false
      const width = Math.max(...wrap.widths, 0)
      const height = wrap.lines.length * FontMetrics.lineHeight(size)
      return width <= maxWidth && height <= maxHeight
    }

    let wrap = wrapAt(size)
    while (size > floor && !fits(wrap)) {
      size -= 2
      wrap = wrapAt(size)
    }

    const overflow = !fits(wrap)
    const scalePercent = Math.max(0, Math.min(100, Math.round((size / startSize) * 100)))
    return { fontSize: size, scalePercent, overflow, wrap }
  }

  // Shorts-safe preset: ratio-based safe zone of the canvas.
  static fitForCanvas({ text, canvasWidth = 1080, canvasHeight = 1920, fontSize, minFontSize, fontFamily, maxLines, ratios = ResponsiveTextScaler.SHORTS } = {}) {
    return ResponsiveTextScaler.fit({
      text,
      maxWidth: canvasWidth * ratios.widthRatio,
      maxHeight: canvasHeight * ratios.heightRatio,
      fontSize,
      minFontSize,
      fontFamily,
      maxLines,
    })
  }
}
