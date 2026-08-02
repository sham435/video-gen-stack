// FontMetrics — deterministic character-advance measurement for headless
// text layout (no canvas in Node). Approximates 900-weight display fonts via
// a per-character width table; wide glyphs (W/M) measure wider than narrow
// ones (i/l/.), so "WWWW" is provably wider than "iiii".
//
// measure(text, fontSize, fontFamily) -> width in px

const FAMILY_FACTOR = {
  Anton: 1.08,
  Inter: 1.0,
  Impact: 1.06,
  sans: 1.0,
}

const NARROW = new Set(['i', 'l', 'j', 'f', 't', 'r', ' ', '.', ',', '!', "'", '|', 'I', '1', ':', ';'])
const WIDE = new Set(['W', 'M', 'w', 'm', 'O', 'Q', 'o', 'g', 'q', 'G', '@', '#', '&'])

export class FontMetrics {
  // Advance for a single character in em units.
  static advance(ch, fontFamily = 'Inter') {
    if (WIDE.has(ch)) return 0.9
    if (NARROW.has(ch)) return 0.35
    if (/[A-Z0-9]/.test(ch)) return 0.7
    return 0.55
  }

  static familyFactor(fontFamily = 'Inter') {
    return FAMILY_FACTOR[fontFamily] ?? 1.0
  }

  // Measured width of a full string at a given size.
  static measure(text, fontSize, fontFamily = 'Inter') {
    const str = String(text ?? '')
    const factor = FontMetrics.familyFactor(fontFamily)
    let width = 0
    for (const ch of str) width += FontMetrics.advance(ch, fontFamily) * fontSize
    return width * factor
  }

  // Height of one text line at a given size.
  static lineHeight(fontSize, factor = 1.25) {
    return fontSize * factor
  }

  static assertWiderThan(wideText, narrowText, fontSize, fontFamily = 'Anton') {
    const w = FontMetrics.measure(wideText, fontSize, fontFamily)
    const n = FontMetrics.measure(narrowText, fontSize, fontFamily)
    if (w <= n) {
      throw new Error(`FontMetrics: "${wideText}" (${w.toFixed(1)}px) must measure wider than "${narrowText}" (${n.toFixed(1)}px)`)
    }
    return { wide: w, narrow: n }
  }
}
