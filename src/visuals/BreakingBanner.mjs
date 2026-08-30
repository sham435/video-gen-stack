import { mulberry32 } from '../style/seeded-random.mjs'
import { DesignSystem } from './DesignSystem.mjs'

const COLORS = {
  red: '#E10600',
  cyan: '#00E5FF',
  white: '#FFFFFF',
  bg: '#050505',
}

// Breaking banner — locked to the very top of the frame (top band).
// Subtext is optional: pass '' when the headline below already carries that
// text (no duplicate render). The BREAKING word is clamped so the banner
// stays chrome, and the red wash never spills past the banner band.
//
// W/H/sx/sy are read INSIDE the function from DesignSystem (live getters) so
// the composition follows the active render profile (1080x1920 for 9:16,
// 1280x720 for 16:9). sx/sy scale 1080x1920-design values into that canvas.
export function drawBreakingBanner(ctx, text, progress, fontSize = 64) {
  const { W, H, sx, sy } = DesignSystem
  const p = Math.min(1, progress * 2)
  const hasSub = Boolean(text && String(text).trim())
  const bannerH = hasSub ? sy(150) : sy(100)
  const bannerY = 0
  const bandFont = Math.max(sx(48), Math.min(sx(64), sx(fontSize)))

  ctx.save()

  // Red glow confined to the banner band (max 0.15 alpha) — never a
  // full-frame tint that washes out the headline below.
  const glow = ctx.createRadialGradient(W / 2, bannerY + bannerH / 2, 0, W / 2, bannerY + bannerH / 2, sx(360))
  glow.addColorStop(0, `rgba(225, 6, 0, ${0.15 * (1 - p * 0.5)})`)
  glow.addColorStop(1, 'rgba(225, 6, 0, 0)')
  ctx.fillStyle = glow
  ctx.fillRect(0, Math.max(0, bannerY - sy(60)), W, bannerH + sy(140))

  ctx.fillStyle = `rgba(225, 6, 0, ${0.9 * p})`
  ctx.shadowColor = COLORS.red
  ctx.shadowBlur = sx(60) * (1 - p * 0.5)
  ctx.beginPath()
  ctx.roundRect(0, bannerY, W, bannerH, [0, 0, 8, 8])
  ctx.fill()
  ctx.shadowBlur = 0

  ctx.strokeStyle = `rgba(0, 229, 255, ${0.2 * p})`
  ctx.lineWidth = 1
  ctx.beginPath()
  ctx.roundRect(0, bannerY, W, bannerH, [0, 0, 8, 8])
  ctx.stroke()

  ctx.fillStyle = `rgba(255, 255, 255, ${0.03 * p})`
  ctx.beginPath()
  ctx.roundRect(0, bannerY, W, bannerH / 2, [0, 0, 0, 0])
  ctx.fill()

  ctx.globalAlpha = p
  ctx.font = `900 ${bandFont}px Anton, Impact, sans-serif`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillStyle = COLORS.white
  ctx.shadowColor = COLORS.red
  ctx.shadowBlur = sx(40)
  ctx.fillText('BREAKING', W / 2, bannerY + bannerH * (hasSub ? 0.38 : 0.5))

  if (hasSub) {
    ctx.font = `900 ${Math.max(sx(32), Math.min(sx(44), bandFont * 0.68))}px Anton, Impact, sans-serif`
    ctx.fillStyle = COLORS.red
    ctx.shadowColor = COLORS.red
    ctx.shadowBlur = sx(24)
    ctx.fillText(String(text).toUpperCase(), W / 2, bannerY + bannerH * 0.72)
  }
  ctx.shadowBlur = 0

  for (let i = 0; i < 8; i++) {
    const x = (i * sx(140) + p * sx(200)) % W
    const alpha = 0.1 + Math.sin(i + p * 10) * 0.08
    ctx.fillStyle = `rgba(255, 255, 255, ${Math.max(0, alpha)})`
    ctx.fillRect(x, bannerY, 2, bannerH)
  }

  ctx.restore()
}

export function drawGlitchOverlay(ctx, progress) {
  const { W, H } = DesignSystem
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
