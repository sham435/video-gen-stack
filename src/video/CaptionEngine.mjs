const W = 1080, H = 1920

export function buildWordTimings(script, duration) {
  const words = script.split(' ')
  const perWord = duration / words.length
  return words.map((word, i) => ({
    word,
    start: i * perWord,
    end: (i + 1) * perWord + 0.05,
  }))
}

export function getActiveWordIndex(wordTimings, time) {
  for (let i = 0; i < wordTimings.length; i++) {
    if (time >= wordTimings[i].start && time <= wordTimings[i].end) return i
  }
  return -1
}

export function renderCaptions(ctx, text, wordIndex, progress) {
  const words = text.split(' ')
  const maxWordsPerLine = 3
  const lines = []
  for (let i = 0; i < words.length; i += maxWordsPerLine) {
    lines.push(words.slice(i, i + maxWordsPerLine))
  }

  const fontSize = 34
  const lineH = fontSize * 1.5
  const totalH = lines.length * lineH
  const startY = H * 0.78 - totalH / 2
  let wordCounter = 0

  ctx.save()

  for (const line of lines) {
    const lineText = line.join(' ')
    ctx.font = `600 ${fontSize}px Inter, sans-serif`
    const lineW = ctx.measureText(lineText.toUpperCase()).width
    const startX = W / 2 - lineW / 2 - 20

    const bgAlpha = (wordCounter <= wordIndex && wordIndex >= 0) ? 0.7 : 0.4
    ctx.fillStyle = `rgba(0, 0, 0, ${bgAlpha})`
    ctx.beginPath()
    ctx.roundRect(startX, startY + lines.indexOf(line) * lineH - fontSize * 0.3, lineW + 40, fontSize * 1.15, 8)
    ctx.fill()

    for (const w of line) {
      const isActive = wordCounter === wordIndex
      const isPast = wordCounter < wordIndex
      const lp = Math.min(1, Math.max(0, (progress - wordCounter * 0.12) / 0.12))

      ctx.save()

      if (isActive) {
        const scale = 0.85 + lp * 0.15
        ctx.translate(startX + 20 + line.indexOf(w) * (lineW / line.length) + fontSize * 0.2, startY + lines.indexOf(line) * lineH + fontSize * 0.15)
        ctx.scale(scale, scale)
        ctx.shadowColor = '#00E5FF'
        ctx.shadowBlur = 12 * lp
        ctx.fillStyle = '#FFFFFF'
        ctx.font = `700 ${fontSize}px Inter, sans-serif`
      } else if (isPast) {
        ctx.fillStyle = 'rgba(255,255,255,0.5)'
        ctx.font = `500 ${fontSize}px Inter, sans-serif`
      } else {
        ctx.fillStyle = 'rgba(255,255,255,0.2)'
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
}
