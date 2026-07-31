const W = 1080, H = 1920

export function drawHeadlineCard(ctx, text, progress, color = '#FFFFFF') {
  const p = Math.min(1, progress * 1.5)
  const words = text.split(' ')
  const lines = []
  let line = ''
  const maxChars = 10

  for (const w of words) {
    if ((line + ' ' + w).length <= maxChars) line += (line ? ' ' : '') + w
    else { lines.push(line); line = w }
  }
  if (line) lines.push(line)

  const fontSize = text.length > 15 ? 96 : text.length > 8 ? 116 : 136
  const lineH = fontSize * 1.2
  const totalH = lines.length * lineH
  // Rule of thirds: headline sits in the upper-middle band, keeping the
  // bottom third clear for caption overlays (caption safe area at 0.78H)
  const startY = H * 0.30 - totalH / 2

  ctx.save()

  const scale = 0.7 + p * 0.3
  ctx.translate(W / 2, H * 0.30)
  ctx.scale(scale, scale)
  ctx.translate(-W / 2, -H * 0.30)

  const depthOffset = (1 - p) * 40
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
    ctx.font = `900 ${fontSize}px Anton, Impact, sans-serif`
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
