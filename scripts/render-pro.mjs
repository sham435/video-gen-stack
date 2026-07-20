/**
 * Professional animated background renderer for broadcast-quality news scenes.
 * Generates canvas frames with animated mesh gradients, tech grids,
 * floating particles, and glassmorphism overlays.
 */

import { createCanvas, GlobalFonts } from '@napi-rs/canvas'
import fs from 'fs'
import path from 'path'

// Register fonts
try {
  if (fs.existsSync('assets/fonts/Anton-Regular.ttf'))
    GlobalFonts.registerFromPath('assets/fonts/Anton-Regular.ttf', 'Anton')
  if (fs.existsSync('assets/fonts/Inter-Black.ttf'))
    GlobalFonts.registerFromPath('assets/fonts/Inter-Black.ttf', 'InterBlack')
} catch {}

const W = 1920, H = 1080

const PALETTE = {
  bg: ['#07111F', '#0F172A', '#111827'],
  primary: '#3B82F6',
  accent: '#22D3EE',
  success: '#10B981',
  warning: '#F59E0B',
  breaking: '#EF4444',
  text: '#F8FAFC',
  glass: 'rgba(255,255,255,0.08)',
}

/**
 * Theme detection for accent colors
 */
function themeFor(title) {
  const t = title.toLowerCase()
  if (t.includes('apple') || t.includes('ios') || t.includes('siri')) return { primary: '#6366F1', accent: '#818CF8' }
  if (t.includes('samsung') || t.includes('galaxy')) return { primary: '#2563EB', accent: '#60A5FA' }
  if (t.includes('xbox') || t.includes('playstation') || t.includes('game')) return { primary: '#7C3AED', accent: '#A78BFA' }
  if (t.includes('ai') || t.includes('chatgpt') || t.includes('openai')) return { primary: '#059669', accent: '#34D399' }
  return { primary: PALETTE.primary, accent: PALETTE.accent }
}

/**
 * Scene types for varied layouts
 */
const SCENE_LAYOUTS = {
  headline: 'headline',
  keypoint: 'keypoint',
  stat: 'stat',
  quote: 'quote',
  summary: 'summary',
}

/**
 * Draw animated background: mesh gradient + grid + particles
 */
function drawBackground(ctx, seed, progress) {
  // Dark gradient base
  const grad = ctx.createLinearGradient(0, 0, W, H)
  grad.addColorStop(0, '#07111F')
  grad.addColorStop(0.5, '#0F172A')
  grad.addColorStop(1, '#111827')
  ctx.fillStyle = grad
  ctx.fillRect(0, 0, W, H)

  // Tech grid
  ctx.strokeStyle = 'rgba(59, 130, 246, 0.06)'
  ctx.lineWidth = 1
  const gridSize = 60
  for (let x = 0; x < W; x += gridSize) {
    ctx.beginPath()
    ctx.moveTo(x, 0)
    ctx.lineTo(x, H)
    ctx.stroke()
  }
  for (let y = 0; y < H; y += gridSize) {
    ctx.beginPath()
    ctx.moveTo(0, y)
    ctx.lineTo(W, y)
    ctx.stroke()
  }

  // Floating particles
  const particleCount = 40
  for (let i = 0; i < particleCount; i++) {
    const px = ((i * 137.5 + seed * 100) % W)
    const py = ((i * 97.3 + seed * 50 + progress * 200) % H)
    const size = 1.5 + Math.sin(seed + i + progress * 3) * 1.5
    const alpha = 0.1 + Math.sin(seed + i + progress * 2) * 0.08
    ctx.fillStyle = `rgba(59, 130, 246, ${Math.max(0, alpha)})`
    ctx.beginPath()
    ctx.arc(px, py, Math.max(0.5, size), 0, Math.PI * 2)
    ctx.fill()
  }

  // Mesh gradient accent blobs (move slowly)
  const blobCount = 3
  for (let i = 0; i < blobCount; i++) {
    const cx = ((i * 400 + seed * 200 + Math.sin(progress + i) * 300) % W)
    const cy = ((i * 300 + 200 + Math.cos(progress + i) * 200) % H)
    const r = 400 + Math.sin(progress + i) * 100
    const blobGrad = ctx.createRadialGradient(cx, cy, 0, cx, cy, r)
    blobGrad.addColorStop(0, `rgba(59, 130, 246, ${0.03 + Math.sin(progress + i) * 0.02})`)
    blobGrad.addColorStop(1, 'rgba(59, 130, 246, 0)')
    ctx.fillStyle = blobGrad
    ctx.fillRect(0, 0, W, H)
  }
}

/**
 * Draw lower third glass panel
 */
function drawLowerThird(ctx, category, source, timeStr, progress) {
  const panelH = 80
  const panelY = H - panelH - 20

  // Glass panel
  ctx.fillStyle = 'rgba(15, 23, 42, 0.85)'
  ctx.beginPath()
  ctx.roundRect(20, panelY, W - 40, panelH, 12)
  ctx.fill()

  // Glass shine
  ctx.fillStyle = 'rgba(255,255,255,0.04)'
  ctx.beginPath()
  ctx.roundRect(20, panelY, W - 40, panelH / 2, [12, 12, 0, 0])
  ctx.fill()

  // Category badge
  const catColors = {
    technology: '#3B82F6',
    business: '#10B981',
    science: '#8B5CF6',
    gaming: '#F59E0B',
    breaking: '#EF4444',
  }
  const catColor = catColors[(category || '').toLowerCase()] || '#3B82F6'
  ctx.fillStyle = catColor
  ctx.beginPath()
  ctx.roundRect(40, panelY + 16, 130, panelH - 32, 6)
  ctx.fill()
  ctx.fillStyle = '#FFFFFF'
  ctx.font = '700 18px Inter, sans-serif'
  ctx.textAlign = 'center'
  ctx.fillText((category || 'TECH').toUpperCase(), 105, panelY + 44)

  // Source
  ctx.font = '500 18px Inter, sans-serif'
  ctx.fillStyle = 'rgba(255,255,255,0.9)'
  ctx.textAlign = 'left'
  ctx.fillText(`Source: ${source || 'NewsAPI'}`, 190, panelY + 44)

  // Published time
  ctx.font = '400 16px Inter, sans-serif'
  ctx.fillStyle = 'rgba(255,255,255,0.6)'
  ctx.textAlign = 'right'
  ctx.fillText(timeStr || '', W - 40, panelY + 44)

  // Powered by attribution
  ctx.font = '400 14px Inter, sans-serif'
  ctx.fillStyle = 'rgba(255,255,255,0.35)'
  ctx.textAlign = 'right'
  ctx.fillText('Powered by NewsAPI.org', W - 40, panelY + panelH - 14)
}

/**
 * Draw top-right channel badge
 */
function drawChannelBadge(ctx) {
  ctx.fillStyle = 'rgba(255,255,255,0.08)'
  ctx.beginPath()
  ctx.roundRect(W - 210, 20, 190, 36, 8)
  ctx.fill()
  ctx.font = '700 16px Inter, sans-serif'
  ctx.fillStyle = 'rgba(255,255,255,0.7)'
  ctx.textAlign = 'right'
  ctx.fillText('UNFILTERED', W - 30, 45)
}

/**
 * Render a complete professional news scene
 */
export async function renderScene({
  type = 'headline',
  headline = '',
  subheadline = '',
  body = '',
  stat = '',
  statLabel = '',
  imageUrl = null,
  category = 'technology',
  source = 'NewsAPI',
  publishedAt = '',
  seed = 1,
  progress = 0,
  outPath = '',
}) {
  const canvas = createCanvas(W, H)
  const ctx = canvas.getContext('2d')
  const theme = themeFor(headline)

  // 1. Animated background
  drawBackground(ctx, seed, progress)

  // 2. Source loaded image as crossfading backdrop (if available)
  if (imageUrl) {
    try {
      const res = await fetch(imageUrl)
      const buf = Buffer.from(await res.arrayBuffer())
      const tmpPath = outPath.replace('.png', '_img.jpg')
      fs.writeFileSync(tmpPath, buf)
      const { loadImage } = await import('@napi-rs/canvas')
      const img = await loadImage(tmpPath)
      // Soft overlay
      ctx.globalAlpha = 0.2
      ctx.drawImage(img, 0, 0, W, H)
      ctx.globalAlpha = 1.0
    } catch {}
  }

  // 3. Scene content based on type
  if (type === 'headline' || type === 'summary') {
    // Large headline centered with glass pill background
    const fontSize = headline.length > 30 ? 56 : headline.length > 20 ? 66 : 76
    ctx.font = `800 ${fontSize}px Inter, Manrope, sans-serif`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'

    // Glass pill behind text
    const metrics = ctx.measureText(headline)
    const pillW = Math.min(metrics.width + 80, W - 100)
    const pillH = fontSize + 40
    ctx.fillStyle = 'rgba(15, 23, 42, 0.7)'
    ctx.beginPath()
    ctx.roundRect((W - pillW) / 2, H / 2 - pillH / 2, pillW, pillH, 16)
    ctx.fill()

    // Glass shine
    ctx.fillStyle = 'rgba(255,255,255,0.03)'
    ctx.beginPath()
    ctx.roundRect((W - pillW) / 2, H / 2 - pillH / 2, pillW, pillH / 2, [16, 16, 0, 0])
    ctx.fill()

    // Accent line
    ctx.fillStyle = theme.accent
    ctx.fillRect((W - pillW) / 2 + 20, H / 2 - pillH / 2 + 8, pillW - 40, 3)

    // Text
    ctx.fillStyle = '#F8FAFC'
    ctx.fillText(headline, W / 2, H / 2 + 4)

    // Subheadline
    if (subheadline) {
      ctx.font = '400 28px Inter, sans-serif'
      ctx.fillStyle = 'rgba(255,255,255,0.7)'
      ctx.textAlign = 'center'
      ctx.fillText(subheadline, W / 2, H / 2 + fontSize / 2 + 40)
    }
  } else if (type === 'stat') {
    // Big stat number
    ctx.font = '800 120px Inter, Manrope, sans-serif'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillStyle = theme.accent
    ctx.fillText(stat || '99%', W / 2, H / 2 - 40)

    // Stat label
    ctx.font = '500 40px Inter, sans-serif'
    ctx.fillStyle = '#F8FAFC'
    ctx.textAlign = 'center'
    ctx.fillText(statLabel || '', W / 2, H / 2 + 60)

    // Accent bar below
    ctx.fillStyle = theme.primary
    ctx.fillRect(W / 2 - 60, H / 2 + 100, 120, 4)
  } else if (type === 'keypoint') {
    // Bullet point with icon-style dot
    const dotSize = 20
    ctx.fillStyle = theme.accent
    ctx.beginPath()
    ctx.arc(W / 2 - 120, H / 2 - 30, dotSize, 0, Math.PI * 2)
    ctx.fill()

    ctx.font = '700 44px Inter, Manrope, sans-serif'
    ctx.textAlign = 'left'
    ctx.textBaseline = 'middle'
    ctx.fillStyle = '#F8FAFC'
    ctx.fillText(headline, W / 2 - 80, H / 2 - 30)

    if (body) {
      ctx.font = '400 28px Inter, sans-serif'
      ctx.fillStyle = 'rgba(255,255,255,0.7)'
      ctx.fillText(body, W / 2 - 80, H / 2 + 40)
    }
  } else if (type === 'quote') {
    // Large quotation mark
    ctx.font = '800 160px Inter, Manrope, sans-serif'
    ctx.textAlign = 'left'
    ctx.textBaseline = 'top'
    ctx.fillStyle = `rgba(59, 130, 246, 0.15)`
    ctx.fillText('"', 80, 200)

    ctx.font = '600 48px Inter, Manrope, sans-serif'
    ctx.textAlign = 'left'
    ctx.textBaseline = 'middle'
    ctx.fillStyle = '#F8FAFC'
    const words = headline.split(' ')
    const lines = []
    let line = ''
    for (const w of words) {
      if (ctx.measureText(line + w + ' ').width < W - 200) line += w + ' '
      else { lines.push(line.trim()); line = w + ' ' }
    }
    lines.push(line.trim())
    lines.slice(0, 4).forEach((l, i) => {
      ctx.fillText(l, 120, 360 + i * 60)
    })
  }

  // 4. Lower third glass panel
  drawLowerThird(ctx, category, source, publishedAt, progress)

  // 5. Channel badge
  drawChannelBadge(ctx)

  // 6. Save
  fs.mkdirSync(path.dirname(outPath), { recursive: true })
  fs.writeFileSync(outPath, canvas.toBuffer('image/png'))
  return outPath
}

/**
 * Generate multi-scene storyboard from a single article
 */
export function planScenes(article) {
  const title = article.title || ''
  const desc = article.description || ''
  const source = article.source || 'NewsAPI'

  const scenes = [
    {
      type: 'headline',
      headline: title,
      subheadline: desc.slice(0, 100),
      duration: 4,  // seconds
    },
  ]

  // Try to extract a key point
  if (desc.length > 80) {
    scenes.push({
      type: 'keypoint',
      headline: desc.split('.')[0] || title.slice(0, 60),
      body: source,
      duration: 4,
    })
  }

  // Add a summary scene
  scenes.push({
    type: 'summary',
    headline: title.length > 50 ? title.slice(0, 50) + '...' : title,
    subheadline: `According to ${source}`,
    duration: 3,
  })

  return scenes
}
