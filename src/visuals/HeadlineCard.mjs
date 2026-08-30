import { DesignSystem } from './DesignSystem.mjs'

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
  const baseSize = layout ? (layout.fontSize || 0) : (fontSize > 0 ? fontSize : text.length > 15 ? 96 : text.length > 8 ? 116 : 136)
  const size = layout ? sx(layout.fontSize || baseSize) : sx(baseSize)
  const lineH = layout ? (layout.lineHeight ? sy(layout.lineHeight) : size * 1.2) : size * 1.2
  const totalH = lines.length * lineH
  // Rule of thirds: headline sits in the upper-middle band, keeping the
  // bottom third clear for caption overlays (caption safe area at 0.78H)
  const startY = layout ? (layout.y !== undefined ? (layout.y === 0 ? 0 : sy(layout.y)) : H * 0.30 - totalH / 2) : H * 0.30 - totalH / 2

  ctx.save()

  const scale = 0.7 + p * 0.3
  ctx.translate(W / 2, H * 0.30)
  ctx.scale(scale, scale)
  ctx.translate(-W / 2, -H * 0.30)

  const depthOffset = (1 - p) * sx(40)
  ctx.shadowColor = 'rgba(0,0,0,0.5)'
  ctx.shadowBlur = 20 * p
  ctx.shadowOffsetX = depthOffset * 0.5
  ctx.shadowOffsetY = depthOffset

  lines.forEach((line, i) => {
    const charP = Math.max(0, Math.min(1, (p * 1.5) - i * 0.1))
    const y = startY + i * lineH + (1 - charP) * 30
    const xOffset = (1 - charP) * 60

    ctx.save()
    ctx.globalAlpha = charP
    ctx.font = `900 ${size}px Anton, Impact, sans-serif`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillStyle = color
    ctx.shadowColor = color === '#E10600' ? '#E10600' : 'rgba(0,229,255,0.3)'
    ctx.shadowBlur = 30 * (1 - charP * 0.7)
    ctx.fillText(line, W / 2 + xOffset * (i % 2 === 0 ? 1 : -1), y)
    ctx.restore()
  })

  ctx.restore()
}
