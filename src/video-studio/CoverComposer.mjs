import { createCanvas, loadImage } from '@napi-rs/canvas'
import fs from 'fs'
import path from 'path'

const W = 1080, H = 1920

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

    // 2. Brand layer (FIXED — always present)
    // top bar
    ctx.fillStyle = 'rgba(0,0,0,0.6)'
    ctx.fillRect(0, 0, W, 120)
    ctx.fillStyle = accent
    ctx.fillRect(0, 0, W, 8)
    ctx.font = '900 52px Anton, Impact, sans-serif'
    ctx.fillStyle = '#FFFFFF'
    ctx.textAlign = 'left'
    ctx.textBaseline = 'middle'
    ctx.fillText('NEWS-MONSTER', 40, 64)

    // LIVE badge
    const liveW = 110, liveH = 44
    ctx.font = '900 26px Inter, sans-serif'
    ctx.fillStyle = '#E10600'
    ctx.beginPath()
    ctx.roundRect(W - 40 - liveW, 20, liveW, liveH, 6)
    ctx.fill()
    ctx.fillStyle = '#FFFFFF'
    ctx.textAlign = 'center'
    ctx.fillText('LIVE', W - 40 - liveW / 2, 42)

    // 3. Story-specific layer (DYNAMIC)
    ctx.textAlign = 'center'

    // top overlay badge
    const topText = brief.text_overlay?.top || 'BREAKING'
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
    const bottomText = brief.text_overlay?.bottom || 'NEW DETAILS'
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
    ctx.fillStyle = 'rgba(0,0,0,0.6)'
    ctx.fillRect(0, H - 100, W, 100)
    ctx.font = '400 28px Inter, sans-serif'
    ctx.fillStyle = 'rgba(255,255,255,0.7)'
    ctx.textAlign = 'left'
    ctx.fillText(`Source: ${brief.source_label || 'NEWS-MONSTER'}`, 40, H - 50)
    ctx.textAlign = 'right'
    ctx.fillStyle = accent
    ctx.font = '700 28px Inter, sans-serif'
    ctx.fillText((brief.mood || 'BREAKING').toUpperCase(), W - 40, H - 50)

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
}
