import { mulberry32 } from '../style/seeded-random.mjs'

const W = 1080, H = 1920
const COLORS = {
  red: '#E10600',
  cyan: '#00E5FF',
  white: '#FFFFFF',
  bg: '#050505',
}

// Breaking banner — locked to the top 15% of the frame. Subtext is optional:
// pass '' when the headline below already carries that text (no duplicate
// render). Without subtext the bar shrinks to a compact band.
export function drawBreakingBanner(ctx, text, progress, fontSize = 64) {
  const p = Math.min(1, progress * 2)
  const hasSub = Boolean(text && String(text).trim())
  const bannerH = hasSub ? 300 : 170
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
  ctx.font = `900 ${fontSize}px Anton, Impact, sans-serif`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillStyle = COLORS.white
  ctx.shadowColor = COLORS.red
  ctx.shadowBlur = 50
  ctx.fillText('BREAKING', W / 2, bannerY + bannerH * (hasSub ? 0.38 : 0.5))

  if (hasSub) {
    ctx.font = `900 ${Math.max(36, fontSize * 0.68)}px Anton, Impact, sans-serif`
    ctx.fillStyle = COLORS.red
    ctx.shadowColor = COLORS.red
    ctx.shadowBlur = 30
    ctx.fillText(String(text).toUpperCase(), W / 2, bannerY + bannerH * 0.72)
  }
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
  const rand = mulberry32(Math.round(progress * 1e6))
  if (rand() > 0.05) return

  const intensity = 0.3 + rand() * 0.4
  const sliceH = 2 + rand() * 8
  const sliceY = rand() * H
  const offset = (rand() - 0.5) * 20

  ctx.save()
  ctx.globalAlpha = intensity
  ctx.fillStyle = COLORS.red
  ctx.fillRect(offset > 0 ? 0 : W + offset, sliceY, W, sliceH)
  ctx.fillStyle = COLORS.cyan
  ctx.fillRect(offset < 0 ? 0 : offset + W, sliceY + sliceH, W, sliceH)
  ctx.restore()
}
