const W = 1080, H = 1920

export function drawNewsTicker(ctx, items, progress) {
  const tickerH = 50
  const tickerY = H - tickerH - 20
  const itemW = W / 4

  ctx.fillStyle = 'rgba(0,0,0,0.8)'
  ctx.beginPath()
  ctx.roundRect(20, tickerY, W - 40, tickerH, 8)
  ctx.fill()

  ctx.strokeStyle = 'rgba(0, 229, 255, 0.15)'
  ctx.lineWidth = 1
  ctx.beginPath()
  ctx.roundRect(20, tickerY, W - 40, tickerH, 8)
  ctx.stroke()

  const scrollP = (progress * 60) % items.length
  const startIdx = Math.floor(scrollP)

  ctx.font = '600 28px Inter, sans-serif'
  ctx.textBaseline = 'middle'

  for (let i = 0; i < 4; i++) {
    const idx = (startIdx + i) % items.length
    const x = 40 + i * itemW
    const itemP = scrollP % 1
    const alpha = i === 0 ? 1 - itemP : 0.6
    const xOff = i === 0 ? -itemP * 40 : 0

    ctx.fillStyle = `rgba(255, 255, 255, ${alpha})`
    ctx.textAlign = 'left'
    ctx.fillText(items[idx], x + xOff, tickerY + tickerH / 2 + 1)
  }

  ctx.fillStyle = COLORS?.red || '#E10600'
  ctx.beginPath()
  ctx.arc(32, tickerY + tickerH / 2, 3, 0, Math.PI * 2)
  ctx.fill()
}

const COLORS = { red: '#E10600' }
