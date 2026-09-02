// HeadlineCard — broadcast narration headline.
//
// NEW STYLE (2026-09): bright white bold 3D text with yellow outline:
//   - 3D extrusion: the line is filled several times below itself in
//     progressively darker slate gray, giving a beveled depth without shadows
//   - white bright gradient fill: clean broadcast white face (crisp top edge
//     -> light body -> soft slate bottom), readable over any scrim
//   - yellow outline: broadcast-style contrast stroke around each glyph.
// Layout values (fontSize/lineHeight/y) come in logical canvas units from
// TextLayoutEngine — never re-scale them (the old sx()/sy() rescale crushed
// the line gap and caused the shipped overlap).
import { DesignSystem } from './DesignSystem.mjs'

const BRIGHT_WHITE_STOPS = [
  [0.00, '#FFFFFF'], // top crisp white
  [0.35, '#FFFFFF'], // bright face
  [0.62, '#F2F4F8'], // light body
  [0.85, '#D7DBE3'], // soft gray lower face
  [1.00, '#B9BEC9'], // bottom bevel
]

const EXTRUSION_DEPTHS = [12, 9, 6, 3] // px, drawn bottom-up (darkest last)
const EXTRUSION_COLORS = ['#4A4F5A', '#5B606B', '#6C717C', '#7D828D'] // slate depth
const YELLOW_OUTLINE = '#FFE600'
const OUTLINE_WIDTH_SCALE = 0.16 // relative to font size

function brightWhiteGradient(ctx, y, fontSize) {
  const half = fontSize * 0.62
  const grad = ctx.createLinearGradient(0, y - half, 0, y + half)
  for (const [stop, color] of BRIGHT_WHITE_STOPS) grad.addColorStop(stop, color)
  return grad
}

export function drawHeadlineCard(ctx, text, progress, color = '#FFFFFF', fontSize = 0, layout = null) {
  const { W, H, sx, sy } = DesignSystem
  const p = Math.min(1, progress * 1.2)
  const words = text.split(' ')
  const lines = []
  const maxChars = 10

  if (layout && layout.lines && layout.lines.length) {
    lines.push(...layout.lines)
  } else {
    let line = ''
    for (const w of words) {
      if ((line + ' ' + w).length <= maxChars) line += (line ? ' ' : '') + w
      else { lines.push(line); line = w }
    }
    if (line) lines.push(line)
  }

  // Sizes are authored on the 1080x1920 design space; scale into the active
  // canvas so a 16:9 headline stays proportionally correct, not oversized.
  // IMPORTANT unit rule: when a TextLayoutEngine layout is provided, its
  // fontSize / lineHeight / y are ALREADY in the active logical canvas units
  // (the engine is called with { width: DesignSystem.W, height: DesignSystem.H }
  // = 1280x720). Applying sx()/sy() again would inflate the font (x1.185) and
  // crush the line gap (x0.375) — the exact overlap bug seen in published 16:9
  // videos. Only the no-layout fallback values are design-space and need
  // scaling.
  const baseSize = layout ? (layout.fontSize || 0) : (fontSize > 0 ? fontSize : text.length > 15 ? 96 : text.length > 8 ? 116 : 136)
  const size = layout?.fontSize ? layout.fontSize : sx(baseSize)
  const lineH = layout?.lineHeight ? layout.lineHeight : size * 1.2
  const totalH = lines.length * lineH
  // Rule of thirds: headline sits in the upper-middle band, keeping the
  // bottom third clear for caption overlays (caption safe area at 0.78H).
  // Layout.y is already logical canvas units — no sy() rescale. It is the
  // block's vertical CENTER (engine: canvas.height*anchor - height/2), so the
  // block top = y - totalH/2 (same convention TextBlock.renderTextBlock uses);
  // the no-layout fallback below is already a block top.
  const blockTop = layout?.y !== undefined
    ? (layout.y === 0 ? 0 : layout.y - totalH / 2)
    : H * 0.30 - totalH / 2

  ctx.save()

  const scale = 0.7 + p * 0.3
  ctx.translate(W / 2, H * 0.30)
  ctx.scale(scale, scale)
  ctx.translate(-W / 2, -H * 0.30)

  const depthOffset = (1 - p) * sx(40)
  // Soft ground shadow behind the 3D block for separation from the backdrop.
  ctx.shadowColor = 'rgba(0,0,0,0.55)'
  ctx.shadowBlur = 24 * p
  ctx.shadowOffsetX = depthOffset * 0.5
  ctx.shadowOffsetY = depthOffset

  lines.forEach((line, i) => {
    const charP = Math.max(0, Math.min(1, (p * 1.2) - i * 0.08))
    // Middle-baseline step within the block box: line i occupies
    // [blockTop + i*lh, blockTop + (i+1)*lh), glyph centered on the box middle.
    // Both sentences are always centered on W/2 — a small vertical drop for the
    // reveal, NO alternating horizontal sway.
    const y = blockTop + lineH * (i + 0.5) + (1 - charP) * 24
    const x = W / 2

    ctx.save()
    ctx.globalAlpha = charP
    ctx.font = `900 ${size}px Montserrat ExtraBold, sans-serif`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.lineJoin = 'round'

    // 1) 3D extrusion — repeated fills pulled down, darkest slate = furthest
    //    depth, slightly transparent so the bevel reads as depth.
    for (let d = 0; d < EXTRUSION_DEPTHS.length; d++) {
      const depth = EXTRUSION_DEPTHS[d]
      ctx.globalAlpha = charP * (0.9 - d / 24)
      ctx.fillStyle = EXTRUSION_COLORS[d]
      ctx.fillText(line, x, y + depth)
    }

    // 2) Black narrow outline — thin dark halo OUTSIDE the yellow ring so
    //    white text stays visible over ANY background (the fix for "not visible"
    //    feedback: white-on-white/bright scrim disappears without a dark edge).
    ctx.globalAlpha = charP
    ctx.strokeStyle = 'rgba(0,0,0,0.95)'
    ctx.lineWidth = Math.max(3, size * 0.20)
    ctx.lineJoin = 'round'
    ctx.strokeText(line, x, y)

    // 3) Yellow broadcast outline — sits inside the black halo.
    ctx.globalAlpha = charP
    ctx.strokeStyle = YELLOW_OUTLINE
    ctx.lineWidth = Math.max(4, size * OUTLINE_WIDTH_SCALE)
    ctx.lineJoin = 'round'
    ctx.strokeText(line, x, y)

    // 4) Bright white fill — clean broadcast white face on top of the outlines.
    ctx.fillStyle = brightWhiteGradient(ctx, y, size)
    ctx.fillText(line, x, y)

    ctx.restore()
  })

  ctx.restore()
}