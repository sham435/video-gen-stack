// LineWrapper — greedy word wrap driven by measured text widths, not
// character counts or fixed word buckets. Script-aware: Latin/space-delimited
// text wraps by word; CJK/Arabic (no spaces) wrap by grapheme cluster.
// Enforces maxLines: text that cannot fit is reported via overflow instead
// of silently clipping.
import { FontMetrics } from './FontMetrics.mjs'

export class LineWrapper {
  // { text, maxWidth, fontSize, fontFamily, maxLines } ->
  // { lines: [String], widths: [Number], overflow: Boolean, dropped: String }
  static wrap({ text, maxWidth, fontSize, fontFamily = 'Inter', maxLines = Infinity }) {
    const str = String(text ?? '').trim()
    if (!str) return { lines: [], widths: [], overflow: false, dropped: '' }

    const script = FontMetrics.scriptOf(str)
    const spaceDelimited = script === 'latin' || script === 'tamil' || script === 'sinhala'
    if (spaceDelimited) return LineWrapper._wrapWords(str, maxWidth, fontSize, fontFamily, maxLines)
    return LineWrapper._wrapGraphemes(str, maxWidth, fontSize, fontFamily, maxLines)
  }

  static _wrapWords(str, maxWidth, fontSize, fontFamily, maxLines) {
    const words = str.split(/\s+/).filter(Boolean)
    if (!words.length) return { lines: [], widths: [], overflow: false, dropped: '' }

    const lines = []
    const widths = []
    let line = ''
    let lineWidth = 0
    const dropped = []
    const spaceW = FontMetrics.measure(' ', fontSize, fontFamily)

    for (const word of words) {
      const wordW = FontMetrics.measure(word, fontSize, fontFamily)
      const separator = line ? spaceW : 0
      const candidate = line ? line + ' ' + word : word

      if (line && lineWidth + separator + wordW > maxWidth) {
        if (lines.length + 1 >= maxLines) {
          dropped.push(word)
          continue
        }
        lines.push(line)
        widths.push(lineWidth)
        line = word
        lineWidth = wordW
      } else {
        line = candidate
        lineWidth += separator + wordW
      }
    }
    if (line) {
      lines.push(line)
      widths.push(lineWidth)
    }

    const singleWordOverflow = lines.length > 0 && widths[0] > maxWidth
    return { lines, widths, overflow: singleWordOverflow || dropped.length > 0, dropped: dropped.join(' ') }
  }

  static _wrapGraphemes(str, maxWidth, fontSize, fontFamily, maxLines) {
    const graphemes = FontMetrics._graphemes(str)
    const lines = []
    const widths = []
    const dropped = []
    let line = ''
    let lineWidth = 0

    for (const g of graphemes) {
      const gw = FontMetrics.measure(g, fontSize, fontFamily)
      if (line && lineWidth + gw > maxWidth) {
        if (lines.length + 1 >= maxLines) {
          dropped.push(g)
          continue
        }
        lines.push(line)
        widths.push(lineWidth)
        line = g
        lineWidth = gw
      } else {
        line += g
        lineWidth += gw
      }
    }
    if (line) {
      lines.push(line)
      widths.push(lineWidth)
    }

    const singleGraphemeOverflow = lines.length > 0 && widths[0] > maxWidth
    return { lines, widths, overflow: singleGraphemeOverflow || dropped.length > 0, dropped: dropped.join('') }
  }
}
