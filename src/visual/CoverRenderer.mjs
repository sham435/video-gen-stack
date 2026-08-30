import { createCanvas, loadImage } from '@napi-rs/canvas'
import fs from 'fs'
import path from 'path'
import { BrandStyleResolver, ANCHOR_CONFIG } from './BrandStyleResolver.mjs'

const ACT_EMOJI = { 1: '😭', 2: '💪', 3: '✨' }

export class CoverRenderer {
  constructor() {
    this.resolver = new BrandStyleResolver()
  }

  // Aspect/dimension-agnostic: W/H come from options (or default to the legacy
  // 9:16 portrait 1080x1920) and all px scale by the unit factor U, so the
  // render works at 16:9 landscape too.
  async render(concept, article, outPath, options = {}) {
    const W = options.width || 1080
    const H = options.height || 1920
    const U = Math.min(W, H) / 1080
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
      const glow = ctx.createRadialGradient(W / 2, H * 0.45, 0, W / 2, H * 0.45, 700 * U)
      glow.addColorStop(0, `${color}25`)
      glow.addColorStop(1, `${color}00`)
      ctx.fillStyle = glow
      ctx.fillRect(0, 0, W, H)
    }

    // 2. Top brand bar (FIXED position for brand recall)
    ctx.fillStyle = 'rgba(0,0,0,0.6)'
    ctx.fillRect(0, 0, W, 130 * U)
    ctx.fillStyle = color
    ctx.fillRect(0, 0, W, 8 * U)
    ctx.font = `900 ${Math.round(42 * U)}px Inter, sans-serif`
    ctx.fillStyle = '#FFFFFF'
    ctx.textAlign = 'left'
    ctx.textBaseline = 'middle'
    ctx.fillText(ANCHOR_CONFIG.label, 40 * U, 66 * U)

    // LIVE pill
    const pillW = 150 * U
    const pillH = 60 * U
    const pillX = W - (190 * U)
    const pillY = 36 * U
    ctx.fillStyle = '#FF0000'
    ctx.beginPath()
    ctx.roundRect(pillX, pillY, pillW, pillH, 30 * U)
    ctx.fill()
    ctx.fillStyle = '#FFFFFF'
    ctx.font = `900 ${Math.round(26 * U)}px Inter, sans-serif`
    ctx.textAlign = 'center'
    ctx.fillText('● LIVE', W - 115 * U, 66 * U)

    // algorithm badge — 1-48, unique combo, so covers are never identical
    const algo = concept.algorithm
    if (algo) {
      ctx.textAlign = 'left'
      ctx.font = `700 ${Math.round(18 * U)}px Inter, sans-serif`
      ctx.fillStyle = 'rgba(255,255,255,0.55)'
      ctx.fillText(`ALGO #${algo.number}/48 • ${algo.visual.id} • ${algo.tone.id}`, 40 * U, 100 * U)
    }

    // category chip
    ctx.font = `700 ${Math.round(30 * U)}px Inter, sans-serif`
    ctx.fillStyle = `${color}`
    ctx.textAlign = 'right'
    ctx.fillText((article.category || 'news').toUpperCase(), W - 40 * U, 100 * U)

    // 3. Center hero text (FIXED template position)
    ctx.textAlign = 'center'

    // kicker line — act emoji + anchor hook instead of generic "WHY IT MATTERS"
    const kicker = (concept.overlayText || catStyle.anchorHook || 'NOBODY EXPECTED THIS MOVE').toUpperCase()
    const act = concept.algorithm?.structure?.order?.includes('tragedy') ? 1 : concept.algorithm?.structure?.order?.includes('win') ? 3 : 2
    const kickerSize = (kicker.length > 22 ? 44 : 54) * U
    ctx.font = `900 ${Math.round(kickerSize)}px Anton, Impact, sans-serif`
    ctx.fillStyle = color
    ctx.shadowColor = color
    ctx.shadowBlur = 18 * U
    ctx.fillText(`${kicker} ${ACT_EMOJI[act] || ''}`, W / 2, H * 0.60)
    ctx.shadowBlur = 0

    // headline (DYNAMIC content)
    const headline = (article.title || 'TECH NEWS').toUpperCase()
    const words = headline.split(' ')
    const mid = Math.ceil(words.length / 2)
    ctx.font = `900 ${Math.round(76 * U)}px Anton, Impact, sans-serif`
    ctx.fillStyle = '#FFFFFF'
    ctx.shadowColor = 'rgba(0,0,0,0.9)'
    ctx.shadowBlur = 12 * U
    ctx.fillText(words.slice(0, mid).join(' '), W / 2, H * 0.70)
    ctx.fillText(words.slice(mid).join(' '), W / 2, H * 0.78)

    // 4. Keyword badge (DYNAMIC accent + DYNAMIC text)
    const badge = concept.overlayText || 'BREAKING'
    ctx.font = `900 ${Math.round(44 * U)}px Anton, Impact, sans-serif`
    const bw = ctx.measureText(badge).width + 60 * U
    const badgeH = 80 * U
    ctx.shadowBlur = 0
    ctx.fillStyle = color
    ctx.beginPath()
    ctx.roundRect(W / 2 - bw / 2, H * 0.85, bw, badgeH, 8 * U)
    ctx.fill()
    ctx.fillStyle = '#FFFFFF'
    ctx.fillText(badge, W / 2, H * 0.85 + badgeH / 2)

    // 5. Bottom source bar (FIXED)
    const barH = 100 * U
    ctx.fillStyle = 'rgba(0,0,0,0.6)'
    ctx.fillRect(0, H - barH, W, barH)
    ctx.font = `400 ${Math.round(28 * U)}px Inter, sans-serif`
    ctx.fillStyle = 'rgba(255,255,255,0.7)'
    ctx.textAlign = 'left'
    ctx.fillText(`Source: ${article.source || 'NEWS-MONSTER'}`, 40 * U, H - 50 * U)
    ctx.textAlign = 'right'
    ctx.fillStyle = color
    ctx.font = `700 ${Math.round(28 * U)}px Inter, sans-serif`
    ctx.fillText(`${concept.mood?.toUpperCase() || catStyle.mood.toUpperCase()} • ALGO ${algo?.number || 1}/48`, W - 40 * U, H - 50 * U)

    fs.mkdirSync(path.dirname(outPath), { recursive: true })
    fs.writeFileSync(outPath, canvas.toBuffer('image/png'))
    return outPath
  }
}
