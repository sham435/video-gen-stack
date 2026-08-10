import { BROADCAST_TEXT } from '../style/text-tokens.mjs'

const W = 1080, H = 1920

// Anchor badge — the "sham435 · ANCHOR" pill under the outro tagline.
//
// The caller positions it: y is the badge TOP in frame coordinates. The badge
// is intentionally placed by the close-scene layout so it can guarantee the
// pill clears both the tagline above and the footer bar below (that ownership
// contract lives in FooterLayout.barTopInFrame — never hard-code H*0.65 here).
export function drawAnchorBadge(ctx, name, progress, options = {}) {
  const p = Math.min(1, progress * 2)
  if (p <= 0) return

  const anchor = BROADCAST_TEXT.close.anchor
  const badgeW = 420
  const badgeH = options.badgeH ?? anchor.badgeH
  const badgeX = W / 2 - badgeW / 2
  const badgeY = typeof options.y === 'number' ? options.y : H * 0.65

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

  ctx.font = `800 ${anchor.fontSize}px Inter, sans-serif`
  ctx.fillStyle = '#FFFFFF'
  ctx.textAlign = 'left'
  ctx.textBaseline = 'middle'
  ctx.fillText(name, badgeX + 56, badgeY + badgeH / 2)

  ctx.font = `600 ${anchor.subSize}px Inter, sans-serif`
  ctx.fillStyle = 'rgba(0, 229, 255, 0.7)'
  ctx.textAlign = 'right'
  ctx.fillText('ANCHOR', badgeX + badgeW - 16, badgeY + badgeH / 2)

  ctx.restore()
  return { x: badgeX, y: badgeY, w: badgeW, h: badgeH }
}