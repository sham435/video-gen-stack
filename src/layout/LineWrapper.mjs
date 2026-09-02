// LineWrapper — greedy word wrap driven by measured text widths, not
// character counts or fixed word buckets. Script-aware: Latin/space-delimited
// text wraps by word; CJK/Arabic (no spaces) wrap by grapheme cluster.
// Enforces maxLines: text that cannot fit is reported via overflow instead
// of silently clipping.
import { FontMetrics } from './FontMetrics.mjs'

export class LineWrapper {
  // { text, maxWidth, fontSize, fontFamily, maxLines, preferSentences } ->
  // { lines: [String], widths: [Number], overflow: Boolean, dropped: String }
  // preferSentences: break narration at sentence boundaries ('.', '!', '?')
  // when the sentence count fits within maxLines — each sentence becomes one
  // line. This is what lets a 2-sentence VO render as exactly 2 LARGE lines
  // instead of 3-4 word-wrapped small ones (font grows to fill the zone).
  static wrap({ text, maxWidth, fontSize, fontFamily = 'Inter', maxLines = Infinity, preferSentences = false }) {
    const str = String(text ?? '').trim()
    if (!str) return { lines: [], widths: [], overflow: false, dropped: '' }

    const script = FontMetrics.scriptOf(str)
    const spaceDelimited = script === 'latin' || script === 'tamil' || script === 'sinhala'
    if (spaceDelimited) {
      const sentenceLines = preferSentences ? LineWrapper._sentenceLines(str, maxWidth, fontSize, fontFamily, maxLines) : null
      if (sentenceLines) return sentenceLines
      return LineWrapper._wrapWords(str, maxWidth, fontSize, fontFamily, maxLines)
    }
    return LineWrapper._wrapGraphemes(str, maxWidth, fontSize, fontFamily, maxLines)
  }

  static _sentenceLines(str, maxWidth, fontSize, fontFamily, maxLines) {
    const sentences = (str.match(/[^.!?]+[.!?]+(?:\s+)?|[^.!?]+$/g) || []).map(s => s.trim()).filter(Boolean)
    if (sentences.length < 2) return null

    // Hard breaks at sentence boundaries: each sentence starts a new line when
    // it does not fit on the current one. A sentence that is still too wide is
    // word-wrapped internally (so a long sentence can occupy multiple lines —
    // maxLines/overflow then clip the tail instead of collapsing the layout).
    const spaceW = FontMetrics.measure(' ', fontSize, fontFamily)
    const lines = []
    const widths = []
    const dropped = []
    let line = ''
    let lineWidth = 0

    for (const sentence of sentences) {
      const sW = FontMetrics.measure(sentence, fontSize, fontFamily)
      if (line && lineWidth + spaceW + sW <= maxWidth) {
        line += ' ' + sentence
        lineWidth += spaceW + sW
      } else if (line) {
        lines.push(line); widths.push(lineWidth)
        line = sentence; lineWidth = sW
      } else {
        line = sentence; lineWidth = sW
      }
    }
    if (line) { lines.push(line); widths.push(lineWidth) }

    // Any line wider than maxWidth: re-wrap its words, but preserve the hard
    // sentence breaks already placed (each wide sentence line may split into
    // multiple lines, honoring maxLines).
    const final = []
    const finalWidths = []
    let overflowDropped = false
    for (let i = 0; i < lines.length; i++) {
      if (widths[i] <= maxWidth) {
        final.push(lines[i]); finalWidths.push(widths[i])
        continue
      }
      const sub = LineWrapper._wrapWords(lines[i], maxWidth, fontSize, fontFamily, Infinity)
      for (let j = 0; j < sub.lines.length; j++) {
        if (final.length >= maxLines) { overflowDropped = true; break }
        final.push(sub.lines[j]); finalWidths.push(sub.widths[j])
      }
      if (overflowDropped) break
    }

    return {
      lines: final,
      widths: finalWidths,
      overflow: overflowDropped || final.length > maxLines,
      dropped: dropped.join(' '),
    }
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
