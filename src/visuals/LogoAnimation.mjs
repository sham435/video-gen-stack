const W = 1080, H = 1920

export function drawLogoAnimation(ctx, progress, brand = 'NEWS-MONSTER') {
  const p = Math.min(1, progress * 2)
  if (p <= 0) return

  const logoSize = 80
  const logoX = W / 2 - logoSize / 2
  const logoY = H * 0.12

  ctx.save()

  const scale = 0.5 + p * 0.5
  ctx.translate(W / 2, logoY + logoSize / 2)
  ctx.scale(scale, scale)
  ctx.translate(-W / 2, -(logoY + logoSize / 2))

  ctx.fillStyle = '#E10600'
  ctx.shadowColor = '#E10600'
  ctx.shadowBlur = 30 * (1 - p * 0.5)
  ctx.beginPath()
  ctx.roundRect(logoX, logoY, logoSize, logoSize, 12)
  ctx.fill()
  ctx.shadowBlur = 0

  ctx.font = '900 50px Anton, Impact, sans-serif'
  ctx.fillStyle = '#FFFFFF'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText('T', W / 2, logoY + logoSize / 2 + 4)

  ctx.restore()

  const nameP = Math.min(1, (p - 0.15) / 0.4)
  if (nameP > 0) {
    ctx.save()
    ctx.globalAlpha = nameP
    ctx.font = '900 28px Anton, Impact, sans-serif'
    ctx.fillStyle = '#FFFFFF'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText(brand, W / 2, logoY + logoSize + 30)

    ctx.font = '400 12px Inter, sans-serif'
    ctx.fillStyle = 'rgba(0, 229, 255, 0.7)'
    ctx.fillText('TECH NEWS NETWORK', W / 2, logoY + logoSize + 54)
    ctx.restore()
  }
}
