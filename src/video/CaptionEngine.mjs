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

  const fontSize = 52
  const lineH = fontSize * 1.6
  const totalH = lines.length * lineH
  const startY = H * 0.78 - totalH / 2
  let wordCounter = 0

  ctx.save()

  for (const line of lines) {
    const lineText = line.join(' ')
    ctx.font = `800 ${fontSize}px Inter, sans-serif`
    const lineW = ctx.measureText(lineText.toUpperCase()).width
    const startX = W / 2 - lineW / 2 - 30

    const bgAlpha = (wordCounter <= wordIndex && wordIndex >= 0) ? 0.75 : 0.45
    ctx.fillStyle = `rgba(0, 0, 0, ${bgAlpha})`
    ctx.beginPath()
    ctx.roundRect(startX - 10, startY + lines.indexOf(line) * lineH - fontSize * 0.35, lineW + 60, fontSize * 1.3, 12)
    ctx.fill()

    ctx.shadowColor = 'rgba(0,0,0,0.5)'
    ctx.shadowBlur = 10

    for (const w of line) {
      const isActive = wordCounter === wordIndex
      const isPast = wordCounter < wordIndex
      const lp = Math.min(1, Math.max(0, (progress - wordCounter * 0.12) / 0.12))

      ctx.save()

      if (isActive) {
        const scale = 0.8 + lp * 0.2
        ctx.translate(startX + 15 + line.indexOf(w) * (lineW / line.length) + fontSize * 0.25, startY + lines.indexOf(line) * lineH + fontSize * 0.18)
        ctx.scale(scale, scale)
        ctx.shadowColor = '#00E5FF'
        ctx.shadowBlur = 20 * lp
        ctx.fillStyle = '#FFFFFF'
        ctx.font = `800 ${fontSize}px Inter, sans-serif`
      } else if (isPast) {
        ctx.fillStyle = 'rgba(255,255,255,0.55)'
        ctx.font = `600 ${fontSize}px Inter, sans-serif`
      } else {
        ctx.fillStyle = 'rgba(255,255,255,0.2)'
        ctx.font = `600 ${fontSize}px Inter, sans-serif`
      }

      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.fillText(w.toUpperCase(), 0, 0)
      ctx.restore()

      wordCounter++
    }
  }

  ctx.shadowBlur = 0
  ctx.restore()
}
