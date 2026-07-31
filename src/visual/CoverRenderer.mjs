import { createCanvas, loadImage } from '@napi-rs/canvas'
import fs from 'fs'
import path from 'path'
import { BrandStyleResolver } from './BrandStyleResolver.mjs'

const W = 1080, H = 1920

export class CoverRenderer {
  constructor() {
    this.resolver = new BrandStyleResolver()
  }

  async render(concept, article, outPath) {
    const canvas = createCanvas(W, H)
    const ctx = canvas.getContext('2d')

    const color = concept.brandColor || '#E10600'
    const catStyle = BrandStyleResolver.CATEGORY_STYLES[article.category] || BrandStyleResolver.CATEGORY_STYLES.default

    // 1. Background — hero image if available, else themed gradient
    let heroImage = null
    if (concept.heroImage) {
      try { heroImage = await loadImage(concept.heroImage) } catch {}
    }

    if (heroImage) {
      ctx.fillStyle = '#050505'
      ctx.fillRect(0, 0, W, H)
      const imgH = H * 0.72
      const ratio = imgH / heroImage.height
      const imgW = heroImage.width * ratio
      ctx.drawImage(heroImage, (W - imgW) / 2, H * 0.18, imgW, imgH)
      ctx.fillStyle = 'rgba(5,5,5,0.55)'
      ctx.fillRect(0, H * 0.18, W, imgH)
    } else {
      const grad = ctx.createLinearGradient(0, 0, 0, H)
      grad.addColorStop(0, '#0A0A0A')
      grad.addColorStop(0.5, '#101020')
      grad.addColorStop(1, '#050505')
      ctx.fillStyle = grad
      ctx.fillRect(0, 0, W, H)

      // category-tinted glow blob
      const glow = ctx.createRadialGradient(W / 2, H * 0.45, 0, W / 2, H * 0.45, 700)
      glow.addColorStop(0, `${color}25`)
      glow.addColorStop(1, `${color}00`)
      ctx.fillStyle = glow
      ctx.fillRect(0, 0, W, H)
    }

    // 2. Top brand bar (FIXED position for brand recall)
    ctx.fillStyle = 'rgba(0,0,0,0.6)'
    ctx.fillRect(0, 0, W, 130)
    ctx.fillStyle = color
    ctx.fillRect(0, 0, W, 8)
    ctx.font = '900 56px Inter, sans-serif'
    ctx.fillStyle = '#FFFFFF'
    ctx.textAlign = 'left'
    ctx.textBaseline = 'middle'
    ctx.fillText('NEWS-MONSTER', 40, 72)

    // category chip
    ctx.font = '700 30px Inter, sans-serif'
    ctx.fillStyle = `${color}`
    ctx.textAlign = 'right'
    ctx.fillText((article.category || 'news').toUpperCase(), W - 40, 72)

    // 3. Center hero text (FIXED template position)
    ctx.textAlign = 'center'

    // kicker line — fixed brand tag
    ctx.font = '900 60px Anton, Impact, sans-serif'
    ctx.fillStyle = color
    ctx.shadowColor = color
    ctx.shadowBlur = 30
    ctx.fillText('WHY IT MATTERS', W / 2, H * 0.62)
    ctx.shadowBlur = 0

    // headline (DYNAMIC content)
    const headline = (article.title || 'TECH NEWS').toUpperCase()
    const words = headline.split(' ')
    const mid = Math.ceil(words.length / 2)
    ctx.font = '900 76px Anton, Impact, sans-serif'
    ctx.fillStyle = '#FFFFFF'
    ctx.shadowColor = 'rgba(0,0,0,0.9)'
    ctx.shadowBlur = 12
    ctx.fillText(words.slice(0, mid).join(' '), W / 2, H * 0.70)
    ctx.fillText(words.slice(mid).join(' '), W / 2, H * 0.78)

    // 4. Keyword badge (DYNAMIC accent + DYNAMIC text)
    const badge = concept.overlayText || 'BREAKING'
    ctx.font = '900 44px Anton, Impact, sans-serif'
    const bw = ctx.measureText(badge).width + 60
    ctx.shadowBlur = 0
    ctx.fillStyle = color
    ctx.beginPath()
    ctx.roundRect(W / 2 - bw / 2, H * 0.85, bw, 80, 8)
    ctx.fill()
    ctx.fillStyle = '#FFFFFF'
    ctx.fillText(badge, W / 2, H * 0.85 + 40)

    // 5. Bottom source bar (FIXED)
    ctx.fillStyle = 'rgba(0,0,0,0.6)'
    ctx.fillRect(0, H - 100, W, 100)
    ctx.font = '400 28px Inter, sans-serif'
    ctx.fillStyle = 'rgba(255,255,255,0.7)'
    ctx.textAlign = 'left'
    ctx.fillText(`Source: ${article.source || 'NEWS-MONSTER'}`, 40, H - 50)
    ctx.textAlign = 'right'
    ctx.fillStyle = color
    ctx.font = '700 28px Inter, sans-serif'
    ctx.fillText(concept.mood?.toUpperCase() || catStyle.mood.toUpperCase(), W - 40, H - 50)

    fs.mkdirSync(path.dirname(outPath), { recursive: true })
    fs.writeFileSync(outPath, canvas.toBuffer('image/png'))
    return outPath
  }
}
