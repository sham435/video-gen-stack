import { createCanvas, GlobalFonts } from '@napi-rs/canvas'
import fs from 'fs'
import path from 'path'

try {
  if (fs.existsSync('assets/fonts/Anton-Regular.ttf'))
    GlobalFonts.registerFromPath('assets/fonts/Anton-Regular.ttf', 'Anton')
  if (fs.existsSync('assets/fonts/Inter-Bold.ttf'))
    GlobalFonts.registerFromPath('assets/fonts/Inter-Bold.ttf', 'InterBold')
  if (fs.existsSync('assets/fonts/Inter-Black.ttf'))
    GlobalFonts.registerFromPath('assets/fonts/Inter-Black.ttf', 'InterBlack')
} catch {}

export class Renderer {
  constructor(width = 1080, height = 1920) {
    this.W = width
    this.H = height
  }

  createCanvas() {
    return createCanvas(this.W, this.H)
  }

  drawStaticFrame(text, outPath, { accentColor = '#FFFFFF', bgColor = '#000000', italic = -0.2, scale = 0.9, fontSize } = {}) {
    const canvas = this.createCanvas()
    const ctx = canvas.getContext('2d')

    ctx.fillStyle = bgColor
    ctx.fillRect(0, 0, this.W, this.H)

    const fs = fontSize || (text.length > 14 ? 110 : 150)
    ctx.font = `900 ${fs}px Anton, Impact, sans-serif`
    ctx.fillStyle = accentColor
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'

    ctx.save()
    ctx.translate(this.W / 2, this.H / 2)
    ctx.transform(1, 0, italic, 1, 0, 0)
    ctx.scale(scale, 1)

    const words = text.split(' ')
    if (words.length > 2) {
      const mid = Math.ceil(words.length / 2)
      ctx.fillText(words.slice(0, mid).join(' ').toUpperCase(), 0, -60)
      ctx.fillText(words.slice(mid).join(' ').toUpperCase(), 0, 60)
    } else {
      ctx.fillText(text.toUpperCase(), 0, 0)
    }

    ctx.restore()

    fs.mkdirSync(path.dirname(outPath), { recursive: true })
    fs.writeFileSync(outPath, canvas.toBuffer('image/png'))
    return outPath
  }

  drawThemedFrame(article, outPath) {
    const canvas = this.createCanvas()
    const ctx = canvas.getContext('2d')

    const theme = this.detectTheme(article.title)

    const grad = ctx.createLinearGradient(0, 0, 0, this.H)
    grad.addColorStop(0, theme.bg[0])
    grad.addColorStop(1, theme.bg[1])
    ctx.fillStyle = grad
    ctx.fillRect(0, 0, this.W, this.H)

    ctx.font = '700 52px Anton, Inter, sans-serif'
    ctx.textAlign = 'center'

    const lines = this.wrapText(ctx, article.title, 1500)
    lines.forEach((line, i) => {
      const y = article.imageUrl ? this.H * 0.7 + i * 70 : this.H / 2 - 30 + i * 70
      const m = ctx.measureText(line).width
      ctx.fillStyle = 'rgba(0,0,0,0.62)'
      ctx.beginPath()
      ctx.roundRect(this.W / 2 - m / 2 - 24, y - 52, m + 48, 68, 8)
      ctx.fill()
      ctx.fillStyle = '#FFFFFF'
      ctx.fillText(line, this.W / 2, y)
    })

    ctx.font = '400 26px Inter, sans-serif'
    ctx.fillStyle = 'rgba(255,255,255,0.7)'
    ctx.fillText(`Source: ${article.source || 'TECH-MONSTER'}`, this.W / 2, this.H - 80)

    fs.mkdirSync(path.dirname(outPath), { recursive: true })
    fs.writeFileSync(outPath, canvas.toBuffer('image/png'))
    return outPath
  }

  drawShortsPhrases(phrases, outDir) {
    const frameDir = `${outDir}/frames`
    fs.mkdirSync(frameDir, { recursive: true })
    return phrases.map((phrase, i) => {
      const p = `${frameDir}/frame_${String(i).padStart(3, '0')}.png`
      return this.drawStaticFrame(phrase, p)
    })
  }

  detectTheme(title) {
    const t = title.toLowerCase()
    if (t.includes('apple') || t.includes('ios') || t.includes('siri')) return { bg: ['#0A0A23', '#2A2A6A'], accent: '#5E5CFF' }
    if (t.includes('samsung') || t.includes('galaxy') || t.includes('snapdragon')) return { bg: ['#0A1A2A', '#104A7A'], accent: '#00A8FF' }
    if (t.includes('ai') || t.includes('chatgpt') || t.includes('openai')) return { bg: ['#0A1A0A', '#104A10'], accent: '#10B981' }
    if (t.includes('gaming') || t.includes('playstation') || t.includes('xbox')) return { bg: ['#230A14', '#6A1A3A'], accent: '#FF2D7B' }
    return { bg: ['#0B1020', '#1A2A5A'], accent: '#E10600' }
  }

  wrapText(ctx, text, maxWidth) {
    const words = text.split(' ')
    const lines = []
    let line = ''
    for (const w of words) {
      if (ctx.measureText(line + w + ' ').width < maxWidth) line += w + ' '
      else { lines.push(line.trim()); line = w + ' ' }
    }
    lines.push(line.trim())
    return lines.slice(0, 3)
  }

  hookify(title) {
    const clean = title.replace(/[^a-zA-Z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim()
    const words = clean.split(' ').filter(x => x.length > 2)
    const hooks = []
    if (words.length >= 2) hooks.push(words.slice(0, 2).join(' '))
    if (words.length >= 4) hooks.push(words.slice(2, 4).join(' '))
    if (words.length >= 6) hooks.push(words.slice(4, 6).join(' ') || 'BREAKING')
    if (hooks.length < 2) hooks.push('BREAKING NEWS')
    return hooks.slice(0, 3)
  }
}
