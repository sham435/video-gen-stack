// FontMetrics — deterministic character-advance measurement for headless
// text layout (no canvas in Node). Approximates 900-weight display fonts via
// a per-character width table; wide glyphs (W/M) measure wider than narrow
// ones (i/l/.), so "WWWW" is provably wider than "iiii".
//
// Multilingual: CJK ideographs/kana/Hangul, Arabic, Sinhala, Tamil, and
// emoji all have defined advances. Text is measured per grapheme cluster
// (Intl.Segmenter), so emoji surrogate pairs count as one glyph.
//
// Caching: measurement results are memoized per (text, size, family) with a
// bounded cache for large batch renders.

const FAMILY_FACTOR = {
  Anton: 1.08,
  Inter: 1.0,
  Impact: 1.06,
  sans: 1.0,
}

const NARROW = new Set(['i', 'l', 'j', 'f', 't', 'r', ' ', '.', ',', '!', "'", '|', 'I', '1', ':', ';'])
const WIDE = new Set(['W', 'M', 'w', 'm', 'O', 'Q', 'o', 'g', 'q', 'G', '@', '#', '&'])

const CJK_RE = /[\u3040-\u30FF\u4E00-\u9FFF\uAC00-\uD7AF\u3400-\u4DBF]/u
const ARABIC_RE = /[\u0600-\u06FF\u0750-\u077F]/u
const SINHALA_RE = /[\u0D80-\u0DFF]/u
const TAMIL_RE = /[\u0B80-\u0BFF]/u
const EMOJI_RE = /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{1F1E6}-\u{1F1FF}\u{2190}-\u{21FF}]/u

const CACHE_LIMIT = 2000

export class FontMetrics {
  static _cache = new Map()
  static _stats = { hits: 0, misses: 0 }
  static _segmenter = typeof Intl.Segmenter !== 'undefined' ? new Intl.Segmenter('en', { granularity: 'grapheme' }) : null

  // Dominant non-Latin script of a string: 'cjk' | 'arabic' | 'sinhala' | 'tamil' | 'latin'
  static scriptOf(text) {
    const str = String(text ?? '')
    if (EMOJI_RE.test(str)) return 'latin' // emoji mixes with any script; measured per-glyph
    for (const [re, name] of [[CJK_RE, 'cjk'], [ARABIC_RE, 'arabic'], [SINHALA_RE, 'sinhala'], [TAMIL_RE, 'tamil']]) {
      if (re.test(str)) return name
    }
    return 'latin'
  }

  // Advance for a single grapheme in em units.
  static advance(ch, fontFamily = 'Inter') {
    if (EMOJI_RE.test(ch)) return 1.15
    if (CJK_RE.test(ch)) return 1.0
    if (ARABIC_RE.test(ch)) return 0.55
    if (SINHALA_RE.test(ch) || TAMIL_RE.test(ch)) return 0.6
    if (WIDE.has(ch)) return 0.9
    if (NARROW.has(ch)) return 0.35
    if (/[A-Z0-9]/.test(ch)) return 0.7
    return 0.55
  }

  static familyFactor(fontFamily = 'Inter') {
    return FAMILY_FACTOR[fontFamily] ?? 1.0
  }

  static _graphemes(text) {
    if (FontMetrics._segmenter) {
      const out = []
      for (const seg of FontMetrics._segmenter.segment(text)) out.push(seg.segment)
      return out
    }
    return Array.from(text) // surrogate-pair aware fallback
  }

  // Measured width of a full string at a given size (cached).
  static measure(text, fontSize, fontFamily = 'Inter') {
    const str = String(text ?? '')
    if (!str) return 0
    const key = `${fontFamily}|${fontSize}|${str}`
    const hit = FontMetrics._cache.get(key)
    if (hit !== undefined) {
      FontMetrics._stats.hits++
      return hit
    }
    FontMetrics._stats.misses++
    const factor = FontMetrics.familyFactor(fontFamily)
    let width = 0
    for (const g of FontMetrics._graphemes(str)) width += FontMetrics.advance(g, fontFamily) * fontSize
    width *= factor
    if (FontMetrics._cache.size >= CACHE_LIMIT) {
      const oldest = FontMetrics._cache.keys().next().value
      FontMetrics._cache.delete(oldest)
    }
    FontMetrics._cache.set(key, width)
    return width
  }

  static clearCache() {
    FontMetrics._cache.clear()
    FontMetrics._stats = { hits: 0, misses: 0 }
  }

  static cacheStats() {
    return { ...FontMetrics._stats, size: FontMetrics._cache.size }
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
