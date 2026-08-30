import { FooterLayout } from '../video/footer/FooterLayout.mjs'
import { DesignSystem } from './DesignSystem.mjs'

export function drawNewsTicker(ctx, items, progress) {
  const { W, H, sx, sy } = DesignSystem
  const tickerH = sy(50)
  // The footer owns the bottom safe zone. Dock just above its ACTUAL bar top
  // (computed, not the static token) so the ticker never rides up onto the
  // footer bar / pill / URL group. That contract lives in FooterLayout.
  const margin = 14
  const footerTop = FooterLayout.barTopInFrame(ctx, W, H)
  const tickerY = footerTop - tickerH - margin
  const itemW = W / 4

  ctx.fillStyle = 'rgba(0,0,0,0.8)'
  ctx.beginPath()
  ctx.roundRect(sx(20), tickerY, W - sx(40), tickerH, 8)
  ctx.fill()

  ctx.strokeStyle = 'rgba(0, 229, 255, 0.15)'
  ctx.lineWidth = 1
  ctx.beginPath()
  ctx.roundRect(sx(20), tickerY, W - sx(40), tickerH, 8)
  ctx.stroke()

  const scrollP = (progress * 60) % items.length
  const startIdx = Math.floor(scrollP)

  ctx.font = '600 28px Inter, sans-serif'
  ctx.textBaseline = 'middle'

  for (let i = 0; i < 4; i++) {
    const idx = (startIdx + i) % items.length
    const x = sx(40) + i * itemW
    const itemP = scrollP % 1
    const alpha = i === 0 ? 1 - itemP : 0.6
    const xOff = i === 0 ? -itemP * 40 : 0

    ctx.fillStyle = `rgba(255, 255, 255, ${alpha})`
    ctx.textAlign = 'left'
    ctx.fillText(items[idx], x + xOff, tickerY + tickerH / 2 + 1)
  }

  ctx.fillStyle = COLORS?.red || '#E10600'
  ctx.beginPath()
  ctx.arc(sx(32), tickerY + tickerH / 2, 3, 0, Math.PI * 2)
  ctx.fill()
}

const COLORS = { red: '#E10600' }
