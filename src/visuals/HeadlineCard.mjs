// HeadlineCard — broadcast narration headline.
//
// NEW STYLE (2026-09): metallic 3D red text with yellow outline:
//   - 3D extrusion: the line is filled several times below itself in
//     progressively darker red, giving a beveled depth without needing shadows
//   - metallic gradient fill: brushed-metal red sheen (light top edge -> deep
//     red body -> darker bottom), so highlights follow the glyph surface
//   - yellow outline: broadcast-style contrast stroke (readable over any
//     scrim/background, matches the 16:9 news chrome).
// Layout values (fontSize/lineHeight/y) come in logical canvas units from
// TextLayoutEngine — never re-scale them (the old sx()/sy() rescale crushed
// the line gap and caused the shipped overlap).
import { DesignSystem } from './DesignSystem.mjs'

const METALLIC_RED_STOPS = [
  [0.00, '#FFF3DE'], // top specular highlight
  [0.22, '#FFD24A'], // warm metal edge
  [0.38, '#FF2A1F'], // hot red
  [0.55, '#D40000'], // broadcast red
  [0.78, '#8F0A00'], // deep shadow red
  [1.00, '#4A0500'], // bottom dark bevel
]

const EXTRUSION_DEPTHS = [12, 9, 6, 3] // px, drawn bottom-up (darkest last)
const YELLOW_OUTLINE = '#FFE600'
const OUTLINE_WIDTH_SCALE = 0.16 // relative to font size

function metallicGradient(ctx, y, fontSize) {
  const half = fontSize * 0.62
  const grad = ctx.createLinearGradient(0, y - half, 0, y + half)
  for (const [stop, color] of METALLIC_RED_STOPS) grad.addColorStop(stop, color)
  return grad
}

export function drawHeadlineCard(ctx, text, progress, color = '#FFFFFF', fontSize = 0, layout = null) {
  const { W, H, sx, sy } = DesignSystem
  const p = Math.min(1, progress * 1.5)
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
    const charP = Math.max(0, Math.min(1, (p * 1.5) - i * 0.1))
    // Middle-baseline step within the block box: line i occupies
    // [blockTop + i*lh, blockTop + (i+1)*lh), glyph centered on the box middle.
    const y = blockTop + lineH * (i + 0.5) + (1 - charP) * 30
    const x = W / 2 + (1 - charP) * 60 * (i % 2 === 0 ? 1 : -1)

    ctx.save()
    ctx.globalAlpha = charP
    ctx.font = `900 ${size}px Anton, Impact, sans-serif`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.lineJoin = 'round'

    // 1) 3D extrusion — repeated fills pulled down (darkest = furthest depth,
    //    slightly transparent so the bevel reads as metal shading).
    ctx.fillStyle = '#5A0500'
    for (const d of EXTRUSION_DEPTHS) {
      ctx.globalAlpha = charP * (0.85 - d / 32)
      ctx.fillText(line, x, y + d)
    }

    // 2) Yellow broadcast outline — high-contrast rim on top of the depth.
    ctx.globalAlpha = charP
    ctx.strokeStyle = YELLOW_OUTLINE
    ctx.lineWidth = Math.max(4, size * OUTLINE_WIDTH_SCALE)
    ctx.strokeText(line, x, y)

    // 3) Metallic red fill — brushed-metal gradient over the same path.
    ctx.fillStyle = metallicGradient(ctx, y, size)
    ctx.fillText(line, x, y)

    ctx.restore()
  })

  ctx.restore()
}