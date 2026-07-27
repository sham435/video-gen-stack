const W = 1080, H = 1920

export function drawAnchorBadge(ctx, name, progress) {
  const p = Math.min(1, progress * 2)
  if (p <= 0) return

  const badgeW = 300
  const badgeH = 52
  const badgeX = W / 2 - badgeW / 2
  const badgeY = H * 0.65

  ctx.save()
  ctx.globalAlpha = p

  ctx.fillStyle = 'rgba(5, 5, 5, 0.8)'
  ctx.beginPath()
  ctx.roundRect(badgeX, badgeY, badgeW, badgeH, 26)
  ctx.fill()

  ctx.strokeStyle = 'rgba(0, 229, 255, 0.3)'
  ctx.lineWidth = 1
  ctx.beginPath()
  ctx.roundRect(badgeX, badgeY, badgeW, badgeH, 26)
  ctx.stroke()

  const dotPulse = 0.4 + Math.sin(progress * 20) * 0.3
  ctx.fillStyle = `rgba(225, 6, 0, ${dotPulse})`
  ctx.beginPath()
  ctx.arc(badgeX + 28, badgeY + badgeH / 2, 5, 0, Math.PI * 2)
  ctx.fill()

  ctx.font = '700 18px Inter, sans-serif'
  ctx.fillStyle = '#FFFFFF'
  ctx.textAlign = 'left'
  ctx.textBaseline = 'middle'
  ctx.fillText(name, badgeX + 44, badgeY + badgeH / 2)

  ctx.font = '400 12px Inter, sans-serif'
  ctx.fillStyle = 'rgba(255,255,255,0.5)'
  ctx.textAlign = 'right'
  ctx.fillText('ANCHOR', badgeX + badgeW - 14, badgeY + badgeH / 2)

  ctx.restore()
}
