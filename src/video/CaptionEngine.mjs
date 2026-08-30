import { DesignSystem } from '../visuals/DesignSystem.mjs'

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

export function renderCaptions(ctx, text, wordIndex, progress, focusWord, accentColor = '#E10600', fontSize = 58, layout = null) {
  const { W, H, sx } = DesignSystem
  // Phase 1 — Duplicate Word Filter: the emphasis word is already rendered large
  // by InformationLayer. Remove it from the caption sentence so it's never repeated.
  const focusKey = (focusWord || '').toUpperCase()
  const words = text.split(' ').filter(w => {
    if (!focusKey) return true
    const clean = w.replace(/[^a-zA-Z0-9]/g, '').toUpperCase()
    const cleanFocus = focusKey.replace(/[^a-zA-Z0-9]/g, '')
    if (cleanFocus && clean === cleanFocus) return false
    return true
  })

  // Phase 2 — Layout Manifest: when the pipeline provides a pre-computed
  // layout, honor its wrapping, size, and position instead of guessing.
  let lines
  if (layout && layout.lines && layout.lines.length) {
    lines = layout.lines.map(l => l.split(' '))
    fontSize = layout.fontSize
  } else {
    // Non-layout path: scale the design-space caption size (58 default) into
    // the active canvas so reading text stays proportionally correct on 16:9.
    fontSize = sx(fontSize || 58)
    const maxWordsPerLine = 3
    lines = []
    for (let i = 0; i < words.length; i += maxWordsPerLine) {
      lines.push(words.slice(i, i + maxWordsPerLine))
    }
  }

  const lineH = layout ? layout.lineHeight : fontSize * 1.45
  const totalH = lines.length * lineH
  const startY = layout ? layout.y : H * 0.78 - totalH / 2
  const centerX = layout ? layout.x + layout.width / 2 : W / 2
  let wordCounter = 0

  ctx.save()

  for (const line of lines) {
    const lineText = line.join(' ')
    ctx.font = `900 ${fontSize}px 'Montserrat ExtraBold', Inter, sans-serif`
    const lineW = ctx.measureText(lineText.toUpperCase()).width
    const startX = layout ? centerX - lineW / 2 : W / 2 - lineW / 2 - 30

    const bgAlpha = (wordCounter <= wordIndex && wordIndex >= 0) ? 0.45 : 0.4
    ctx.fillStyle = `rgba(0, 0, 0, ${bgAlpha})`
    ctx.beginPath()
    ctx.roundRect(startX - 12, startY + lines.indexOf(line) * lineH - fontSize * 0.35, lineW + 48, fontSize * 1.35, 12)
    ctx.fill()

    ctx.shadowColor = 'rgba(0,0,0,0.85)'
    ctx.shadowBlur = 12

    for (const w of line) {
      const isActive = wordCounter === wordIndex
      const isPast = wordCounter < wordIndex
      const isFocus = focusKey && w.toUpperCase().includes(focusKey)
      const lp = Math.min(1, Math.max(0, (progress - wordCounter * 0.12) / 0.12))

      ctx.save()

      if (isActive) {
        const scale = 0.8 + lp * 0.2
        ctx.translate(startX + 15 + line.indexOf(w) * (lineW / line.length) + fontSize * 0.25, startY + lines.indexOf(line) * lineH + fontSize * 0.18)
        ctx.scale(scale, scale)
        ctx.shadowColor = isFocus ? accentColor : '#00E5FF'
        ctx.shadowBlur = 20 * lp
        ctx.fillStyle = isFocus ? accentColor : '#FFFFFF'
        ctx.font = `900 ${fontSize}px 'Montserrat ExtraBold', Inter, sans-serif`
      } else if (isPast) {
        ctx.fillStyle = isFocus ? accentColor : 'rgba(255,255,255,0.65)'
        ctx.font = `800 ${fontSize}px 'Montserrat ExtraBold', Inter, sans-serif`
      } else {
        ctx.fillStyle = isFocus ? accentColor : 'rgba(255,255,255,0.25)'
        ctx.font = `800 ${fontSize}px 'Montserrat ExtraBold', Inter, sans-serif`
      }

      // NEWS-MONSTER caption standard: white/700 weight face + 3-5px black
      // stroke + soft shadow so reading text survives YouTube compression.
      ctx.lineWidth = Math.max(3, fontSize * 0.07)
      ctx.strokeStyle = 'rgba(0,0,0,0.9)'
      ctx.lineJoin = 'round'
      ctx.miterLimit = 2
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.strokeText(w.toUpperCase(), 0, 0)
      ctx.fillText(w.toUpperCase(), 0, 0)
      ctx.restore()

      wordCounter++
    }
  }

  ctx.shadowBlur = 0
  ctx.restore()
}
