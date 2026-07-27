const W = 1080, H = 1920
const COLORS = {
  red: '#E10600',
  cyan: '#00E5FF',
  white: '#FFFFFF',
  bg: '#050505',
}

export function drawBreakingBanner(ctx, text, progress) {
  const p = Math.min(1, progress * 2)
  const bannerH = 300
  const bannerY = H * 0.15

  ctx.save()

  const glow = ctx.createRadialGradient(W / 2, bannerY + bannerH / 2, 0, W / 2, bannerY + bannerH / 2, 400)
  glow.addColorStop(0, `rgba(225, 6, 0, ${0.3 * (1 - p * 0.5)})`)
  glow.addColorStop(1, 'rgba(225, 6, 0, 0)')
  ctx.fillStyle = glow
  ctx.fillRect(0, 0, W, H)

  ctx.fillStyle = `rgba(225, 6, 0, ${0.85 * p})`
  ctx.shadowColor = COLORS.red
  ctx.shadowBlur = 60 * (1 - p * 0.5)
  ctx.beginPath()
  ctx.roundRect(W * 0.05, bannerY, W * 0.9, bannerH, 8)
  ctx.fill()
  ctx.shadowBlur = 0

  ctx.strokeStyle = `rgba(0, 229, 255, ${0.2 * p})`
  ctx.lineWidth = 1
  ctx.beginPath()
  ctx.roundRect(W * 0.05, bannerY, W * 0.9, bannerH, 8)
  ctx.stroke()

  ctx.fillStyle = `rgba(255, 255, 255, ${0.03 * p})`
  ctx.beginPath()
  ctx.roundRect(W * 0.05, bannerY, W * 0.9, bannerH / 2, [8, 8, 0, 0])
  ctx.fill()

  ctx.globalAlpha = p
  ctx.font = '900 90px Anton, Impact, sans-serif'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillStyle = COLORS.white
  ctx.shadowColor = COLORS.red
  ctx.shadowBlur = 30
  ctx.fillText('BREAKING', W / 2, bannerY + bannerH * 0.38)

  ctx.font = '900 56px Anton, Impact, sans-serif'
  ctx.fillStyle = COLORS.red
  ctx.shadowColor = COLORS.red
  ctx.shadowBlur = 20
  ctx.fillText(text.toUpperCase(), W / 2, bannerY + bannerH * 0.72)
  ctx.shadowBlur = 0

  for (let i = 0; i < 8; i++) {
    const x = (i * 140 + p * 200) % W
    const alpha = 0.1 + Math.sin(i + p * 10) * 0.08
    ctx.fillStyle = `rgba(255, 255, 255, ${Math.max(0, alpha)})`
    ctx.fillRect(x, bannerY, 2, bannerH)
  }

  ctx.restore()
}

export function drawGlitchOverlay(ctx, progress) {
  if (Math.random() > 0.05) return

  const intensity = 0.3 + Math.random() * 0.4
  const sliceH = 2 + Math.random() * 8
  const sliceY = Math.random() * H
  const offset = (Math.random() - 0.5) * 20

  ctx.save()
  ctx.globalAlpha = intensity
  ctx.fillStyle = COLORS.red
  ctx.fillRect(offset > 0 ? 0 : W + offset, sliceY, W, sliceH)
  ctx.fillStyle = COLORS.cyan
  ctx.fillRect(offset < 0 ? 0 : offset + W, sliceY + sliceH, W, sliceH)
  ctx.restore()
}
