import { createCanvas, loadImage } from '@napi-rs/canvas'
import { writeFileSync } from 'fs'

const W = 1920, H = 1080

function wrapText(ctx, text, maxWidth) {
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

function themeFor(title) {
  const t = title.toLowerCase()
  if (t.includes('apple') || t.includes('ios') || t.includes('siri') || t.includes('iphone')) return { bg: ['#0A0A23', '#2A2A6A'], accent: '#5E5CFF' }
  if (t.includes('samsung') || t.includes('galaxy') || t.includes('fold')) return { bg: ['#0A1A2A', '#104A7A'], accent: '#00A8FF' }
  if (t.includes('ai') || t.includes('chatgpt') || t.includes('openai')) return { bg: ['#0A0A1A', '#2A0A4A'], accent: '#8B5CF6' }
  if (t.includes('ps') || t.includes('xbox') || t.includes('game') || t.includes('nintendo')) return { bg: ['#230A14', '#6A1A3A'], accent: '#FF2D7B' }
  if (t.includes('cyber') || t.includes('hack') || t.includes('breach')) return { bg: ['#1A0505', '#3A0A0A'], accent: '#EF4444' }
  return { bg: ['#0B1020', '#1A2A5A'], accent: '#3B82F6' }
}

export async function renderVideo(article, outPath) {
  const canvas = createCanvas(W, H)
  const ctx = canvas.getContext('2d')
  const theme = themeFor(article.title || '')

  // Gradient background
  const grad = ctx.createLinearGradient(0, 0, 0, H)
  grad.addColorStop(0, theme.bg[0])
  grad.addColorStop(1, theme.bg[1])
  ctx.fillStyle = grad
  ctx.fillRect(0, 0, W, H)

  // Article image as blurred background + sharp card
  if (article.imageUrl) {
    try {
      const img = await loadImage(article.imageUrl)
      ctx.save()
      ctx.globalAlpha = 0.35
      ctx.filter = 'blur(40px)'
      ctx.drawImage(img, 0, 0, W, H)
      ctx.restore()

      // Foreground image card 16:9
      ctx.drawImage(img, 160, 80, 1600, 620)
      ctx.strokeStyle = theme.accent
      ctx.lineWidth = 4
      ctx.strokeRect(160, 80, 1600, 620)
    } catch (e) {
      console.log('Image load failed:', e.message)
    }
  }

  // Headline - 52px with pill background
  ctx.font = '700 52px Inter, Helvetica, Sans-Serif'
  ctx.textAlign = 'center'
  const lines = wrapText(ctx, article.title || '', 1500)
  lines.forEach((line, i) => {
    const y = article.imageUrl ? 780 + i * 68 : 480 + i * 68
    const m = ctx.measureText(line).width
    ctx.fillStyle = 'rgba(0,0,0,0.6)'
    ctx.fillRect(W / 2 - m / 2 - 22, y - 52, m + 44, 66)
    ctx.fillStyle = '#FFFFFF'
    ctx.fillText(line, W / 2, y)
  })

  // Source
  ctx.font = '400 26px Inter, Helvetica, Sans-Serif'
  ctx.fillStyle = 'rgba(255,255,255,0.65)'
  ctx.fillText(`Source: ${article.source || 'Tech News'}`, W / 2, 1000)

  writeFileSync(outPath, canvas.toBuffer('image/png'))
  console.log('✅ Frame rendered:', outPath)
}
