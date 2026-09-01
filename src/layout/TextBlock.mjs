// TextBlock — the single authoritative model for ANY multi-line text on the
// NEWS-MONSTER frame. Solves the "measured at one scale, positioned at another"
// bug class by forcing every narrative text path through ONE measured block:
//
//   1. Determine the canonical 16:9 logical layout (1280x720 logical,
//      1920x1080 output; ratio-identical).
//   2. Measure the text at canonical scale (fontSize, wrap, lineHeight).
//   3. Compute the complete block (lines, lineHeight, width, height).
//   4. Position the whole block once (x/y + anchorX/anchorY).
//   5. Draw every line at line[i].y = blockTop + lineHeight * (i + 0.5)
//      (middle baseline) — the invariant distance(line[i], line[i+1]) ===
//      lineHeight is guaranteed by construction, never by independent guess.
//   6. Final render/output scaling happens ONCE, uniformly, downstream
//      (1280x720 -> 1920x1080 upscale is a ratio-preserving 1.5x; nothing here
//      applies a second vertical scale).
//
// The spec's TextBlock fields are all present:
//   text, fontFamily, fontSize, fontWeight, maxWidth, maxLines, lineHeight,
//   letterSpacing, textAlign, anchorX, anchorY, x, y, opacity
//
// `opacity` is a per-block render hint (0..1); callers may still modulate
// ctx.globalAlpha for fades, but the block itself carries its base opacity.

export class TextBlock {
  constructor({
    text = '',
    fontFamily = 'Inter',
    fontSize = 42,
    fontWeight = 900,
    maxWidth = 0,
    maxLines = Infinity,
    lineHeight = 0,
    letterSpacing = 0,
    textAlign = 'center',
    anchorX = 'center',
    anchorY = 'middle',
    x = 0,
    y = 0,
    opacity = 1,
    // Derived/measurement fields carried alongside the spec model so validators
    // and diagnostics can consume the block without re-measuring.
    lines = [],
    width = 0,
    height = 0,
    lineHeightFactor = 1.25,
    // Canvas the layout was measured against (stamp for preflight re-derivation).
    canvasWidth = 0,
    canvasHeight = 0,
  } = {}) {
    this.text = text
    this.fontFamily = fontFamily
    this.fontSize = fontSize
    this.fontWeight = fontWeight
    this.maxWidth = maxWidth
    this.maxLines = maxLines
    this.lineHeight = lineHeight || Math.round(fontSize * lineHeightFactor)
    this.letterSpacing = letterSpacing
    this.textAlign = textAlign
    this.anchorX = anchorX
    this.anchorY = anchorY
    this.x = x
    this.y = y
    this.opacity = opacity
    this.lines = lines
    this.width = width
    this.height = height
    this.lineHeightFactor = lineHeightFactor
    this.canvasWidth = canvasWidth
    this.canvasHeight = canvasHeight
  }

  /** Build a TextBlock from a TextLayoutEngine manifest (line-height-compatible). */
  static fromManifest(m = {}) {
    if (!m) return null
    return new TextBlock({
      text: m.text,
      fontFamily: m.fontFamily || 'Inter',
      fontSize: m.fontSize,
      fontWeight: m.fontWeight || 900,
      maxWidth: m.maxWidth || 0,
      maxLines: m.maxLines || Infinity,
      lineHeight: m.lineHeight,
      letterSpacing: m.letterSpacing || 0,
      textAlign: m.textAlign || 'center',
      anchorX: m.anchorX || 'center',
      anchorY: m.anchorY || 'middle',
      x: m.x,
      y: m.y,
      opacity: m.opacity != null ? m.opacity : 1,
      lines: m.lines || [],
      width: m.width,
      height: m.height,
      lineHeightFactor: m.lineHeightFactor,
      canvasWidth: m.canvasWidth,
      canvasHeight: m.canvasHeight,
    })
  }

  /** AABB bounding box of this block (top/left = block box, y = vertical center). */
  box() {
    const w = Math.max(0, this.width || 0)
    const h = Math.max(0, this.height || 0)
    const left = this.anchorX === 'center' ? this.x - w / 2 : this.x
    const right = left + w
    const top = this.anchorY === 'middle' ? this.y - h / 2 : this.y
    const bottom = top + h
    return { left, top, right, bottom, width: w, height: h, x: left, y: top }
  }
}

/**
 * The ONLY sanctioned way to draw a measured multi-line text block.
 *
 * Guarantees:
 *   - lines are positioned by the block's measured lineHeight (middle baseline
 *     stepping), so adjacent-line distance === lineHeight by construction.
 *   - the full block is positioned once from (x, y) via anchorX/anchorY — no
 *     per-line y guesses by callers.
 *   - no ctx.scale/transform is applied here; output scaling is a single,
 *     uniform downstream step (1280x720 logical -> 1920x1080 physical).
 *
 * Pass the block's `anchorY='middle'` convention: block.y is the vertical
 * center. For a top-anchored block, line i sits at blockTop + lineHeight*i +
 * fontSize/2 (middle baseline of the line box).
 */
export function renderTextBlock(ctx, block, overrides = {}) {
  if (!block || !block.lines || !block.lines.length) return
  const b = { ...block, ...overrides }
  const lines = b.lines || []
  const lineHeight = b.lineHeight || Math.round(b.fontSize * (b.lineHeightFactor || 1.25))
  const blockH = lines.length * lineHeight

  const startY =
    b.anchorY === 'middle'
      ? b.y - blockH / 2
      : b.anchorY === 'bottom'
        ? b.y - blockH
        : b.y

  ctx.save()
  ctx.globalAlpha = (ctx.globalAlpha || 1) * (b.opacity != null ? b.opacity : 1)
  try {
    ctx.font = `${b.fontWeight || 900} ${Math.round(b.fontSize)}px ${b.fontFamily}, sans-serif`
    ctx.textAlign = b.textAlign || 'center'
    ctx.textBaseline = 'middle'
    if (b.letterSpacing) ctx.letterSpacing = `${b.letterSpacing}px`
    if (b.fillStyle) ctx.fillStyle = b.fillStyle
    if (b.strokeStyle) ctx.strokeStyle = b.strokeStyle

    // Centered block: draw every line at the block's horizontal center.
    const cx = b.anchorX === 'center' ? b.x : b.anchorX === 'right' ? b.x : b.x
    lines.forEach((line, i) => {
      // Middle-baseline step: line box i occupies [startY + i*lh, startY+(i+1)*lh).
      const y = startY + lineHeight * (i + 0.5)
      // Horizontal alignment mirrors textAlign; x is the reference point.
      ctx.fillText(String(line), cx, y)
    })
  } finally {
    if (b.letterSpacing) ctx.letterSpacing = '0px'
    ctx.restore()
  }
  return block
}