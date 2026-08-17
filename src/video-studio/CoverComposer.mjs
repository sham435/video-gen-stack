import { createCanvas, loadImage } from '@napi-rs/canvas'
import fs from 'fs'
import path from 'path'
import { ANCHOR_CONFIG } from '../visual/BrandStyleResolver.mjs'

const W = 1080, H = 1920

const BAD_OVERLAYS = new Set([
  'ACTUALLY SEE', 'ACTUALLY', 'SEE HOW', 'SEE WHY', 'SEE WHAT',
  'THIS IS', 'HERE IS', 'LOOK AT', 'CHECK OUT',
])

function safeOverlay(text, fallback = 'BREAKING') {
  const up = (text || '').toUpperCase().trim()
  if (!up || BAD_OVERLAYS.has(up)) return fallback
  return up
}

export class CoverComposer {
  async compose(brief, heroImage, outPath) {
    const canvas = createCanvas(W, H)
    const ctx = canvas.getContext('2d')
    const accent = brief.accent_color || '#E10600'

    // 1. Hero background
    if (heroImage) {
      try {
        const img = await loadImage(heroImage)
        ctx.fillStyle = '#000'
        ctx.fillRect(0, 0, W, H)
        const ratio = Math.max(W / img.width, H / img.height)
        const w = img.width * ratio, h = img.height * ratio
        ctx.drawImage(img, (W - w) / 2, (H - h) / 2, w, h)
        // darken for readability
        const dim = ctx.createLinearGradient(0, 0, 0, H)
        dim.addColorStop(0, 'rgba(0,0,0,0.72)')
        dim.addColorStop(0.4, 'rgba(0,0,0,0.35)')
        dim.addColorStop(1, 'rgba(0,0,0,0.82)')
        ctx.fillStyle = dim
        ctx.fillRect(0, 0, W, H)
      } catch { this._gradientBg(ctx, accent) }
    } else {
      this._gradientBg(ctx, accent)
    }

    // 2. Brand layer (FIXED — always present unless hideBranding for Shorts)
    if (!brief.hideBranding) {
      // top bar
      ctx.fillStyle = 'rgba(0,0,0,0.6)'
      ctx.fillRect(0, 0, W, 120)
      ctx.fillStyle = accent
      ctx.fillRect(0, 0, W, 8)
      ctx.font = '900 40px Anton, Impact, sans-serif'
      ctx.fillStyle = '#FFFFFF'
      ctx.textAlign = 'left'
      ctx.textBaseline = 'middle'
      ctx.fillText(ANCHOR_CONFIG.label, 40, 58)

      // LIVE badge
      const liveW = 110, liveH = 44
      ctx.font = '900 26px Inter, sans-serif'
      ctx.fillStyle = '#E10600'
      ctx.beginPath()
      ctx.roundRect(W - 40 - liveW, 16, liveW, liveH, 6)
      ctx.fill()
      ctx.fillStyle = '#FFFFFF'
      ctx.textAlign = 'center'
      ctx.fillText('LIVE', W - 40 - liveW / 2, 38)

    // algorithm badge — 1-48, unique combo, covers are never identical
    const algo = brief.algorithm
    if (!brief.hideBranding && algo) {
      ctx.font = '600 20px Inter, sans-serif'
      ctx.fillStyle = 'rgba(255,255,255,0.6)'
      ctx.textAlign = 'left'
      ctx.fillText(`ALGO #${algo.number}/48 • ${algo.visual?.id || ''} • ${algo.tone?.id || ''}`, 40, 96)
      ctx.textAlign = 'center'
    }
    }

    // 3. Story-specific layer (DYNAMIC)
    ctx.textAlign = 'center'

    // top overlay badge — anchor hook when algorithm present
    const topText = algo?.hook && algo.hook !== 'SHOCKING_NUMBER'
      ? 'NOBODY EXPECTED THIS MOVE'
      : safeOverlay(brief.text_overlay?.top)
    ctx.font = '900 92px Anton, Impact, sans-serif'
    ctx.fillStyle = accent
    ctx.shadowColor = accent
    ctx.shadowBlur = 40
    ctx.fillText(topText, W / 2, H * 0.40)
    ctx.shadowBlur = 0

    // headline — smart wrap + auto-scale to fit 1080px width, max 4 lines
    const headline = (brief.headline || 'TECH NEWS').toUpperCase()
    const maxW = W * 0.9
    let hFontSize = headline.length > 60 ? 46 : headline.length > 40 ? 56 : headline.length > 25 ? 64 : 72
    const lines = []
    const wrap = () => {
      lines.length = 0
      ctx.font = `900 ${hFontSize}px Anton, Impact, sans-serif`
      const words = headline.split(' ')
      let line = ''
      for (const w of words) {
        if (ctx.measureText(line + w + ' ').width <= maxW) line += w + ' '
        else { if (line.trim()) lines.push(line.trim()); line = w + ' ' }
      }
      if (line.trim()) lines.push(line.trim())
    }
    wrap()
    // shrink if still overflowing (long titles)
    let guard = 0
    while (lines.length > 4 && hFontSize > 30 && guard < 20) {
      hFontSize -= 4
      wrap()
      guard++
    }
    ctx.font = `900 ${hFontSize}px Anton, Impact, sans-serif`
    ctx.fillStyle = '#FFFFFF'
    ctx.shadowColor = 'rgba(0,0,0,0.9)'
    ctx.shadowBlur = 12
    const lineH = hFontSize * 1.15
    const blockH = lines.length * lineH
    const startY = H * 0.52 - blockH / 2
    lines.forEach((l, i) => ctx.fillText(l, W / 2, startY + i * lineH + hFontSize * 0.8))
    ctx.shadowBlur = 0

    // bottom overlay badge
    const bottomText = safeOverlay(brief.text_overlay?.bottom, 'NEW DETAILS')
    ctx.shadowBlur = 0
    ctx.font = '900 44px Anton, Impact, sans-serif'
    const bw = ctx.measureText(bottomText).width + 60
    ctx.fillStyle = accent
    ctx.beginPath()
    ctx.roundRect(W / 2 - bw / 2, H * 0.68, bw, 72, 8)
    ctx.fill()
    ctx.fillStyle = '#FFFFFF'
    ctx.fillText(bottomText, W / 2, H * 0.68 + 36)

    // 4. Bottom brand strip (FIXED)
    if (!brief.hideBranding) {
      ctx.fillStyle = 'rgba(0,0,0,0.6)'
      ctx.fillRect(0, H - 100, W, 100)
      ctx.font = '400 36px Inter, sans-serif'
      ctx.fillStyle = 'rgba(255,255,255,0.7)'
      ctx.textAlign = 'left'
      ctx.textBaseline = 'middle'
      ctx.fillText(`Source: ${brief.source_label || 'NEWS-MONSTER'}`, 40, H - 50)
      ctx.textAlign = 'right'
      ctx.fillStyle = accent
      ctx.font = '700 36px Inter, sans-serif'
      ctx.fillText(`${(brief.mood || 'BREAKING').toUpperCase()} • ALGO ${algo?.number || 1}/48`, W - 40, H - 50)
    }

    fs.mkdirSync(path.dirname(outPath), { recursive: true })
    fs.writeFileSync(outPath, canvas.toBuffer('image/png'))
    return outPath
  }

  _gradientBg(ctx, accent) {
    const grad = ctx.createLinearGradient(0, 0, 0, H)
    grad.addColorStop(0, '#0A0A0A')
    grad.addColorStop(0.5, '#101020')
    grad.addColorStop(1, '#050505')
    ctx.fillStyle = grad
    ctx.fillRect(0, 0, W, H)
    const glow = ctx.createRadialGradient(W / 2, H * 0.45, 0, W / 2, H * 0.45, 700)
    glow.addColorStop(0, `${accent}25`)
    glow.addColorStop(1, `${accent}00`)
    ctx.fillStyle = glow
    ctx.fillRect(0, 0, W, H)
  }

  // ------------------------------------------------------------------
  // 16:9 YouTube thumbnail (1280x720) — the image actually shown in
  // feed/suggestions. Same brand system as the portrait Shorts cover but
  // laid out landscape. Deterministic for identical input.
  // ------------------------------------------------------------------

  async composeThumbnail(brief, heroImage, outPath) {
    const TW = 1280, TH = 720
    const canvas = createCanvas(TW, TH)
    const ctx = canvas.getContext('2d')
    const accent = brief.accent_color || '#E10600'

    // 1. Hero background (cover full frame)
    if (heroImage) {
      try {
        const img = await loadImage(heroImage)
        ctx.fillStyle = '#000'
        ctx.fillRect(0, 0, TW, TH)
        const ratio = Math.max(TW / img.width, TH / img.height)
        const w = img.width * ratio, h = img.height * ratio
        ctx.drawImage(img, (TW - w) / 2, (TH - h) / 2, w, h)
        // dim for readability (heavier at the text zone)
        const dim = ctx.createLinearGradient(0, 0, 0, TH)
        dim.addColorStop(0, 'rgba(0,0,0,0.62)')
        dim.addColorStop(0.5, 'rgba(0,0,0,0.30)')
        dim.addColorStop(1, 'rgba(0,0,0,0.86)')
        ctx.fillStyle = dim
        ctx.fillRect(0, 0, TW, TH)
      } catch { this._thumbnailGradient(ctx, accent) }
    } else {
      this._thumbnailGradient(ctx, accent)
    }

    // 2. Brand bar (FIXED top)
    if (!brief.hideBranding) {
      ctx.fillStyle = 'rgba(0,0,0,0.6)'
      ctx.fillRect(0, 0, TW, 84)
      ctx.fillStyle = accent
      ctx.fillRect(0, 0, TW, 6)
      ctx.font = '900 30px Anton, Impact, sans-serif'
      ctx.fillStyle = '#FFFFFF'
      ctx.textAlign = 'left'
      ctx.textBaseline = 'middle'
      ctx.fillText(ANCHOR_CONFIG.label, 40, 42)
      // LIVE badge
      const liveW = 92, liveH = 38
      ctx.font = '900 22px Inter, sans-serif'
      ctx.fillStyle = '#E10600'
      ctx.beginPath()
      ctx.roundRect(TW - 40 - liveW, 23, liveW, liveH, 6)
      ctx.fill()
      ctx.fillStyle = '#FFFFFF'
      ctx.textAlign = 'center'
      ctx.fillText('LIVE', TW - 40 - liveW / 2, 42)
    }

    // algorithm badge (16:9 keeps it small — visible in desktop feed)
    const algo = brief.algorithm
    if (!brief.hideBranding && algo) {
      ctx.font = '600 16px Inter, sans-serif'
      ctx.fillStyle = 'rgba(255,255,255,0.6)'
      ctx.textAlign = 'left'
      ctx.fillText(`ALGO #${algo.number}/48 • ${algo.visual?.id || ''}`, 40, 72)
      ctx.textAlign = 'center'
    }

    // 3. Top overlay badge (accent, glow)
    const topText = algo?.hook && algo.hook !== 'SHOCKING_NUMBER'
      ? 'NOBODY EXPECTED THIS MOVE'
      : safeOverlay(brief.text_overlay?.top)
    ctx.textAlign = 'center'
    ctx.font = '900 64px Anton, Impact, sans-serif'
    ctx.fillStyle = accent
    ctx.shadowColor = accent
    ctx.shadowBlur = 30
    ctx.fillText(topText, TW / 2, TH * 0.46)
    ctx.shadowBlur = 0

    // 4. Headline — wrap to max 1280*0.92 width, max 3 lines, auto-scale
    const headline = (brief.headline || 'TECH NEWS').toUpperCase()
    ctx.font = '900 84px Anton, Impact, sans-serif'
    const maxW = TW * 0.92
    let hFontSize = headline.length > 70 ? 52 : headline.length > 45 ? 60 : headline.length > 28 ? 72 : 84
    const lines = []
    const wrap = () => {
      lines.length = 0
      ctx.font = `900 ${hFontSize}px Anton, Impact, sans-serif`
      const words = headline.split(' ')
      let line = ''
      for (const w of words) {
        if (ctx.measureText(line + w + ' ').width <= maxW) line += w + ' '
        else { if (line.trim()) lines.push(line.trim()); line = w + ' ' }
      }
      if (line.trim()) lines.push(line.trim())
    }
    wrap()
    let guard = 0
    while (lines.length > 3 && hFontSize > 32 && guard < 20) {
      hFontSize -= 4
      wrap()
      guard++
    }
    ctx.font = `900 ${hFontSize}px Anton, Impact, sans-serif`
    ctx.fillStyle = '#FFFFFF'
    ctx.shadowColor = 'rgba(0,0,0,0.95)'
    ctx.shadowBlur = 14
    const lineH = hFontSize * 1.12
    const blockH = lines.length * lineH
    const startY = TH * 0.60 - blockH / 2
    lines.forEach((l, i) => ctx.fillText(l, TW / 2, startY + i * lineH + hFontSize * 0.8))
    ctx.shadowBlur = 0

    // 5. Bottom accent badge
    const bottomText = safeOverlay(brief.text_overlay?.bottom, 'NEW DETAILS')
    ctx.font = '900 34px Anton, Impact, sans-serif'
    const bw = ctx.measureText(bottomText).width + 50
    ctx.fillStyle = accent
    ctx.beginPath()
    ctx.roundRect(TW / 2 - bw / 2, TH * 0.80, bw, 56, 8)
    ctx.fill()
    ctx.fillStyle = '#FFFFFF'
    ctx.fillText(bottomText, TW / 2, TH * 0.80 + 28)

    // 6. Bottom brand strip
    if (!brief.hideBranding) {
      ctx.fillStyle = 'rgba(0,0,0,0.6)'
      ctx.fillRect(0, TH - 54, TW, 54)
      ctx.font = '500 26px Inter, sans-serif'
      ctx.fillStyle = 'rgba(255,255,255,0.75)'
      ctx.textAlign = 'left'
      ctx.textBaseline = 'middle'
      ctx.fillText(`Source: ${brief.source_label || 'NEWS-MONSTER'}`, 28, TH - 27)
      ctx.textAlign = 'right'
      ctx.fillStyle = accent
      ctx.font = '700 26px Inter, sans-serif'
      ctx.fillText((brief.mood || 'BREAKING').toUpperCase(), TW - 28, TH - 27)
    }

    fs.mkdirSync(path.dirname(outPath), { recursive: true })
    fs.writeFileSync(outPath, canvas.toBuffer('image/png'))
    return outPath
  }

  _thumbnailGradient(ctx, accent) {
    const W = 1280, H = 720
    const grad = ctx.createLinearGradient(0, 0, 0, H)
    grad.addColorStop(0, '#0A0A0A')
    grad.addColorStop(0.5, '#101020')
    grad.addColorStop(1, '#050505')
    ctx.fillStyle = grad
    ctx.fillRect(0, 0, W, H)
    const glow = ctx.createRadialGradient(W / 2, H * 0.5, 0, W / 2, H * 0.5, 520)
    glow.addColorStop(0, `${accent}30`)
    glow.addColorStop(1, `${accent}00`)
    ctx.fillStyle = glow
    ctx.fillRect(0, 0, W, H)
  }
}
