const W = 1080, H = 1920

export function drawDataPanel(ctx, data, progress) {
  const p = Math.min(1, progress * 1.5)
  if (!data) return

  const panelW = W * 0.8
  const panelH = 400
  const panelX = W / 2 - panelW / 2
  const panelY = H / 2 - panelH / 2

  ctx.save()
  ctx.globalAlpha = p

  ctx.fillStyle = 'rgba(5, 5, 5, 0.9)'
  ctx.beginPath()
  ctx.roundRect(panelX, panelY, panelW, panelH, 16)
  ctx.fill()

  ctx.strokeStyle = `rgba(0, 229, 255, ${0.15 * p})`
  ctx.lineWidth = 1
  ctx.beginPath()
  ctx.roundRect(panelX, panelY, panelW, panelH, 16)
  ctx.stroke()

  if (data.stat) {
    const counter = Math.floor(data.stat * p)
    ctx.font = '900 100px Anton, Impact, sans-serif'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillStyle = '#00E5FF'
    ctx.shadowColor = '#00E5FF'
    ctx.shadowBlur = 20
    ctx.fillText(String(counter) + (data.suffix || '%'), W / 2, panelY + panelH * 0.35)
    ctx.shadowBlur = 0

    if (data.label) {
      ctx.font = '500 28px Inter, sans-serif'
      ctx.fillStyle = 'rgba(255,255,255,0.8)'
      ctx.fillText(data.label, W / 2, panelY + panelH * 0.6)
    }
  }

  if (data.chart) {
    const bars = data.chart
    const maxVal = Math.max(...bars.map(b => b.value))
    const barW = (panelW - 80) / bars.length

    bars.forEach((bar, i) => {
      const barH = (bar.value / maxVal) * 200 * p
      const bx = panelX + 40 + i * barW
      const by = panelY + panelH - 80 - barH

      ctx.fillStyle = i === bars.length - 1 ? '#E10600' : '#00E5FF'
      ctx.beginPath()
      ctx.roundRect(bx, by, barW - 8, barH, 4)
      ctx.fill()

      ctx.font = '400 14px Inter, sans-serif'
      ctx.fillStyle = 'rgba(255,255,255,0.6)'
      ctx.textAlign = 'center'
      ctx.fillText(bar.label, bx + (barW - 8) / 2, panelY + panelH - 40)

      ctx.fillStyle = '#FFFFFF'
      ctx.font = '700 16px Inter, sans-serif'
      ctx.fillText(bar.value, bx + (barW - 8) / 2, by - 12)
    })
  }

  ctx.restore()
}
