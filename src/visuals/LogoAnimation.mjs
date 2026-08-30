export function drawLogoAnimation(ctx, progress, brand = 'NEWS-MONSTER') {
  // Canvas-relative — derives W/H from the live canvas so it works at any
  // aspect (9:16 portrait or 16:9 landscape) instead of a hardcoded 1080x1920.
  const W = ctx.canvas?.width || 1080
  const H = ctx.canvas?.height || 1920
  const U = Math.min(W, H) / 1080
  const p = Math.min(1, progress * 2)
  if (p <= 0) return

  const logoSize = 80 * U
  const logoX = W / 2 - logoSize / 2
  const logoY = H * 0.12

  ctx.save()

  const scale = 0.5 + p * 0.5
  ctx.translate(W / 2, logoY + logoSize / 2)
  ctx.scale(scale, scale)
  ctx.translate(-W / 2, -(logoY + logoSize / 2))

  ctx.fillStyle = '#E10600'
  ctx.shadowColor = '#E10600'
  ctx.shadowBlur = 30 * U * (1 - p * 0.5)
  ctx.beginPath()
  ctx.roundRect(logoX, logoY, logoSize, logoSize, 12 * U)
  ctx.fill()
  ctx.shadowBlur = 0

  ctx.font = `900 ${Math.round(42 * U)}px Anton, Impact, sans-serif`
  ctx.fillStyle = '#FFFFFF'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText('NM', W / 2, logoY + logoSize / 2 + 4 * U)

  ctx.restore()

  const nameP = Math.min(1, (p - 0.15) / 0.4)
  if (nameP > 0) {
    ctx.save()
    ctx.globalAlpha = nameP
    ctx.font = `900 ${Math.round(32 * U)}px Anton, Impact, sans-serif`
    ctx.fillStyle = '#FFFFFF'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText(brand, W / 2, logoY + logoSize + 30 * U)

    ctx.font = `400 ${Math.round(28 * U)}px Inter, sans-serif`
    ctx.fillStyle = 'rgba(0, 229, 255, 0.7)'
    ctx.fillText('UNFILTERED BREAKING NEWS FROM THE FUTURE', W / 2, logoY + logoSize + 54 * U)
    ctx.restore()
  }
}
