const W = 1080, H = 1920

export function drawAnchorBadge(ctx, name, progress, offsetY = 0) {
  const p = Math.min(1, progress * 2)
  if (p <= 0) return

  const badgeW = 420
  const badgeH = 60
  const badgeX = W / 2 - badgeW / 2
  const badgeY = H * 0.65 + offsetY

  ctx.save()
  ctx.globalAlpha = p

  ctx.fillStyle = 'rgba(5, 5, 5, 0.8)'
  ctx.beginPath()
  ctx.roundRect(badgeX, badgeY, badgeW, badgeH, 30)
  ctx.fill()

  ctx.strokeStyle = 'rgba(0, 229, 255, 0.3)'
  ctx.lineWidth = 1
  ctx.beginPath()
  ctx.roundRect(badgeX, badgeY, badgeW, badgeH, 30)
  ctx.stroke()

  const dotPulse = 0.4 + Math.sin(progress * 20) * 0.3
  ctx.fillStyle = `rgba(225, 6, 0, ${dotPulse})`
  ctx.beginPath()
  ctx.arc(badgeX + 34, badgeY + badgeH / 2, 7, 0, Math.PI * 2)
  ctx.fill()

  ctx.font = '800 42px Inter, sans-serif'
  ctx.fillStyle = '#FFFFFF'
  ctx.textAlign = 'left'
  ctx.textBaseline = 'middle'
  ctx.fillText(name, badgeX + 56, badgeY + badgeH / 2)

  ctx.font = '600 28px Inter, sans-serif'
  ctx.fillStyle = 'rgba(0, 229, 255, 0.7)'
  ctx.textAlign = 'right'
  ctx.fillText('ANCHOR', badgeX + badgeW - 16, badgeY + badgeH / 2)

  ctx.restore()
}
