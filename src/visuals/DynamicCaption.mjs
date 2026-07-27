const W = 1080, H = 1920

export function drawDynamicCaption(ctx, text, globalProgress, wordIndex) {
  const words = text.split(' ')
  const maxWordsPerLine = 3
  const lines = []
  for (let i = 0; i < words.length; i += maxWordsPerLine) {
    lines.push(words.slice(i, i + maxWordsPerLine))
  }

  const fontSize = 36
  const lineH = fontSize * 1.6
  const totalH = lines.length * lineH
  const startY = H * 0.78 - totalH / 2
  let wordCounter = 0

  ctx.save()

  for (let li = 0; li < lines.length; li++) {
    const line = lines[li]
    const totalW = line.length * fontSize * 1.1
    const startX = W / 2 - totalW / 2

    ctx.fillStyle = 'rgba(0, 0, 0, 0.6)'
    ctx.beginPath()
    ctx.roundRect(startX - 16, startY + li * lineH - fontSize * 0.35, totalW + 32, fontSize * 1.2, 8)
    ctx.fill()

    ctx.strokeStyle = 'rgba(255, 255, 255, 0.08)'
    ctx.lineWidth = 1
    ctx.beginPath()
    ctx.roundRect(startX - 16, startY + li * lineH - fontSize * 0.35, totalW + 32, fontSize * 1.2, 8)
    ctx.stroke()

    for (let wi = 0; wi < line.length; wi++) {
      const w = line[wi]
      const isActive = wordCounter === wordIndex
      const wasActive = wordCounter < wordIndex
      const localP = Math.min(1, Math.max(0, (globalProgress - wordCounter * 0.15) / 0.15))

      const x = startX + wi * fontSize * 1.1
      const scale = isActive ? 0.8 + localP * 0.2 : wasActive ? 1 : 0.8

      ctx.save()
      ctx.translate(x + fontSize * 0.4, startY + li * lineH + fontSize * 0.15)
      ctx.scale(scale, scale)

      if (isActive) {
        ctx.shadowColor = '#00E5FF'
        ctx.shadowBlur = 15 * localP
        ctx.fillStyle = '#FFFFFF'
        ctx.font = `700 ${fontSize}px Inter, sans-serif`
      } else if (wasActive) {
        ctx.fillStyle = 'rgba(255,255,255,0.6)'
        ctx.font = `500 ${fontSize}px Inter, sans-serif`
      } else {
        ctx.fillStyle = 'rgba(255,255,255,0.3)'
        ctx.font = `500 ${fontSize}px Inter, sans-serif`
      }

      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.fillText(w.toUpperCase(), 0, 0)
      ctx.restore()

      wordCounter++
    }
  }

  ctx.restore()
  return wordCounter
}
