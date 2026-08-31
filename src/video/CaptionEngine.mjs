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

  // Phase 2 — Layout Manifest: the caption is ONE measured text block. When the
  // authoritative layout (TextLayoutEngine) is provided, honor its wrapping,
  // size, line-height, and position verbatim. Renderers never re-wrap or guess
  // independent y coordinates — that is the anti-pattern that caused lines to
  // overlap the headline and each other.
  let rendered = []
  let lineH = fontSize * 1.25
  if (layout && layout.lines && layout.lines.length) {
    // Single authoritative block: lines already wrapped once by TextLayoutEngine.
    rendered = layout.lines.map(l => l.split(' '))
    fontSize = layout.fontSize
    lineH = layout.lineHeight || fontSize * 1.25
  } else {
    // Fallback (headless / no injected layout): still build ONE wrapped block
    // with consistent geometry — never independent line coordinates. Reduced to
    // 78% of the design caption size and capped at 3 lines.
    fontSize = sx(fontSize || 58)
    fontSize = Math.max(30, Math.round(fontSize * 0.78))
    ctx.font = `900 ${fontSize}px 'Montserrat ExtraBold', Inter, sans-serif`
    const maxW = W * 0.72
    const wrapped = []
    let cur = []
    for (const w of words) {
      const probe = cur.length ? [...cur, w].join(' ') : w
      if (ctx.measureText(probe.toUpperCase()).width <= maxW || cur.length === 0) {
        cur.push(w)
        continue
      }
      wrapped.push(cur)
      cur = [w]
    }
    if (cur.length) wrapped.push(cur)
    rendered = wrapped.slice(0, 3) // hard cap: max 3 lines
  }

  const totalH = rendered.length * lineH
  // The caption block's vertical center is its layout y (center-stage for the
  // caption state); the block is horizontally centered on the layout center x.
  const startY = layout ? layout.y - totalH / 2 : H * 0.5 - totalH / 2
  const centerX = layout ? layout.x + layout.width / 2 : W / 2
  let wordCounter = 0

  ctx.save()

  for (const line of rendered) {
    const lineText = line.join(' ')
    ctx.font = `900 ${fontSize}px 'Montserrat ExtraBold', Inter, sans-serif`
    const lineW = ctx.measureText(lineText.toUpperCase()).width
    const startX = centerX - lineW / 2
    const lineY = startY + linesIndexOf(rendered, line) * lineH

    // Background box sized to the line height (not wider glyph estimate) so
    // consecutive line boxes NEVER overlap each other.
    const bgAlpha = (wordCounter <= wordIndex && wordIndex >= 0) ? 0.45 : 0.4
    ctx.fillStyle = `rgba(0, 0, 0, ${bgAlpha})`
    ctx.beginPath()
    ctx.roundRect(startX - 12, lineY - fontSize * 0.35, lineW + 48, lineH + fontSize * 0.2, 12)
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
        ctx.translate(startX + 15 + line.indexOf(w) * (lineW / line.length) + fontSize * 0.25, lineY + fontSize * 0.18)
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

// index of a specific line reference inside the rendered block (identity-safe).
function linesIndexOf(lines, target) {
  for (let i = 0; i < lines.length; i++) if (lines[i] === target) return i
  return 0
}
