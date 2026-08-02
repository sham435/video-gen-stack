// Responsive Text Scaler — pre-render text fitting so headlines and captions
// never overflow or clip. Runs in the scene text pipeline (before the
// renderer), so drawing layers receive already-resolved font sizes.
//
// Shorts/TikTok safe zones: 85% of canvas width, 25% of canvas height.
// Text that cannot fit at the requested size shrinks in 2px steps down to
// minFontSize; scale never goes below 0.

export class ResponsiveTextScaler {
  static SHORTS = { widthRatio: 0.85, heightRatio: 0.25 }
  static SHORTS_CANVAS = { width: 1080, height: 1920 }

  // { text, maxWidth, maxHeight, fontSize, minFontSize = 18, measure } ->
  // { fontSize, scalePercent, overflow }
  // measure: optional fn(text, size) -> { width } for canvas-accurate widths;
  // default is a deterministic character-width heuristic.
  static fit({ text, maxWidth, maxHeight, fontSize, minFontSize = 18, measure = null } = {}) {
    const textStr = String(text || '')
    const startSize = Math.max(1, Math.floor(fontSize || 18))
    let size = startSize
    const floor = Math.max(1, Math.floor(minFontSize || 18))

    const estimate = (s) => {
      if (measure) {
        const m = measure(textStr, s)
        return { width: m.width, lines: Math.max(1, Math.ceil(m.width / Math.max(1, maxWidth))) }
      }
      const width = textStr.length * s * 0.55
      return { width, lines: Math.max(1, Math.ceil(width / Math.max(1, maxWidth))) }
    }

    while (size > floor) {
      const est = estimate(size)
      const height = est.lines * size * 1.25
      if (est.width <= maxWidth && height <= maxHeight) break
      size -= 2
    }

    const scalePercent = Math.max(0, Math.min(100, Math.round((size / startSize) * 100)))
    const overflow = estimate(size).width > maxWidth
    return { fontSize: size, scalePercent, overflow }
  }

  // Shorts-safe preset: 85% width x 25% height of the canvas.
  static fitForCanvas({ text, canvasWidth = 1080, canvasHeight = 1920, fontSize, minFontSize, ratios = ResponsiveTextScaler.SHORTS }) {
    return ResponsiveTextScaler.fit({
      text,
      maxWidth: canvasWidth * ratios.widthRatio,
      maxHeight: canvasHeight * ratios.heightRatio,
      fontSize,
      minFontSize,
    })
  }
}
