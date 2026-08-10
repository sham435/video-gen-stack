// Text wrap helper shared by chrome layers (footer blocks, brand outro).
// Wraps a string into ≤ maxLines lines that each fit within maxWidth at the
// given font, dropping to thinner lines rather than truncating. Returns the
// lines (never an ellipsized string — callers control font size to fit).
export function wrapText(ctx, text, maxWidth, maxLines = 2) {
  const words = String(text || '').split(/\s+/).filter(Boolean)
  if (!words.length) return []
  const lines = []
  let line = ''
  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word
    if (ctx.measureText(candidate).width <= maxWidth || !line) {
      line = candidate
    } else {
      lines.push(line)
      line = word
    }
  }
  if (line) lines.push(line)
  // Drop to the last maxLines, keeping the most important prefix content.
  return lines.slice(-maxLines)
}