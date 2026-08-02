// LineWrapper — greedy word wrap driven by measured text widths, not
// character counts or fixed word buckets. Enforces maxLines: text that
// cannot fit is reported via overflow instead of silently clipping.
import { FontMetrics } from './FontMetrics.mjs'

export class LineWrapper {
  // { text, maxWidth, fontSize, fontFamily, maxLines } ->
  // { lines: [String], widths: [Number], overflow: Boolean, dropped: String }
  static wrap({ text, maxWidth, fontSize, fontFamily = 'Inter', maxLines = Infinity }) {
    const str = String(text ?? '').trim()
    const words = str.split(/\s+/).filter(Boolean)
    if (!words.length) return { lines: [], widths: [], overflow: false, dropped: '' }

    const lines = []
    const widths = []
    let line = ''
    let lineWidth = 0
    const dropped = []

    for (const word of words) {
      const wordW = FontMetrics.measure(word, fontSize, fontFamily)
      const separator = line ? FontMetrics.measure(' ', fontSize, fontFamily) : 0
      const candidate = line ? line + ' ' + word : word

      if (line && lineWidth + separator + wordW > maxWidth) {
        if (lines.length + 1 >= maxLines) {
          // This word starts a new line but there is no budget left.
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

    // A single word wider than the box can never wrap — report it.
    const singleWordOverflow = lines.length > 0 && widths[0] > maxWidth
    return {
      lines,
      widths,
      overflow: singleWordOverflow || dropped.length > 0,
      dropped: dropped.join(' '),
    }
  }
}
