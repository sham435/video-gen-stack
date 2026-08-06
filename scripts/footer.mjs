/**
 * Footer Taskbar Generator — permanent overlay for all videos.
 *
 * Style: Windows taskbar-like with Apple/Android badges, YouTube,
 *        SUBSCRIBED button, channel name, and website.
 *
 * Usage:  node scripts/footer.mjs          # generates assets/footer.png
 *         node scripts/footer.mjs --watch  # watch mode for dev
 */

import { createCanvas, GlobalFonts, loadImage } from '@napi-rs/canvas'
import fs from 'fs'
import path from 'path'

try {
  if (fs.existsSync('assets/fonts/Inter-Bold.ttf'))
    GlobalFonts.registerFromPath('assets/fonts/Inter-Bold.ttf', 'InterBold')
  if (fs.existsSync('assets/fonts/Inter-Black.ttf'))
    GlobalFonts.registerFromPath('assets/fonts/Inter-Black.ttf', 'InterBlack')
} catch {}

const W = 1080   // matches Shorts 9:16 width
const H = 160    // bottom ~8% of 1920h

/**
 * Generate the footer taskbar PNG overlay.
 * This is a permanent bar at the bottom of every video showing:
 *   [AVAILABLE ON] [Apple] [Android]  |  site URL  |  [YouTube]  SUBSCRIBED 🔔  |  [NM logo]
 */
export async function generateFooter(outPath = 'assets/footer.png') {
  const canvas = createCanvas(W, H)
  const ctx = canvas.getContext('2d')

  // ── Background: clean white taskbar like Windows 11 ──
  ctx.fillStyle = '#F8F9FA'
  ctx.fillRect(0, 0, W, H)

  // Subtle top border
  ctx.strokeStyle = '#E0E0E0'
  ctx.lineWidth = 1.5
  ctx.beginPath()
  ctx.moveTo(0, 0)
  ctx.lineTo(W, 0)
  ctx.stroke()

  // Subtle bottom shadow
  ctx.fillStyle = 'rgba(0,0,0,0.03)'
  ctx.fillRect(0, H - 3, W, 3)

  // ── Section 1: AVAILABLE ON + badges ──
  ctx.font = '800 30px Inter, sans-serif'
  ctx.fillStyle = '#1A1A1A'
  ctx.textAlign = 'left'
  ctx.fillText('AVAILABLE ON', 16, 32)

  // Apple badge
  try {
    const applePath = 'assets/logos/apple.png'
    if (fs.existsSync(applePath)) {
      const apple = await loadImage(applePath)
      ctx.drawImage(apple, 16, 48, 42, 42)
    } else {
      ctx.font = '36px sans-serif'
      ctx.fillText('🍎', 16, 80)
    }
  } catch { ctx.font = '36px sans-serif'; ctx.fillText('🍎', 16, 80) }

  // Android badge
  const androidX = 66
  try {
    const androidPath = 'assets/logos/android.png'
    if (fs.existsSync(androidPath)) {
      const android = await loadImage(androidPath)
      ctx.drawImage(android, androidX, 48, 42, 42)
    } else {
      ctx.font = '36px sans-serif'
      ctx.fillText('🤖', androidX, 80)
    }
  } catch { ctx.font = '36px sans-serif'; ctx.fillText('🤖', androidX, 80) }

  // ── Section 2: Website ──
  const siteUrl = 'https://sham435.github.io/video-gen-stack/'
  // Fit-to-width: the site string is long, shrink so it stays on one line
  const urlAvail = 176 // space before the YouTube pill (x=310)
  ctx.font = '800 20px Inter, sans-serif'
  const urlW = ctx.measureText(siteUrl).width
  ctx.font = `800 ${Math.max(8, 20 * (urlAvail / urlW))}px Inter, sans-serif`
  ctx.fillStyle = '#D32F2F'
  ctx.textAlign = 'left'
  ctx.fillText(siteUrl, 130, 38)

  ctx.font = '500 12px Inter, sans-serif'
  ctx.fillStyle = '#666666'
  ctx.fillText('For more tech news', 130, 56)

  // ── Section 3: YouTube big + SUBSCRIBED ──
  // YouTube pill
  const ytX = 310, ytY = 68, ytW = 120, ytH = 36
  ctx.fillStyle = '#FF0000'
  ctx.beginPath()
  ctx.roundRect(ytX, ytY, ytW, ytH, 8)
  ctx.fill()

  // YouTube text
  ctx.font = '800 18px Inter, sans-serif'
  ctx.fillStyle = '#FFFFFF'
  ctx.textAlign = 'center'
  ctx.fillText('YouTube', ytX + ytW / 2, ytY + 24)

  // SUBSCRIBED + bell
  ctx.font = '700 13px Inter, sans-serif'
  ctx.fillStyle = '#606060'
  ctx.textAlign = 'left'
  ctx.fillText('SUBSCRIBED', 450, 92)
  ctx.font = '20px sans-serif'
  ctx.fillText('🔔', 546, 95)

  // ── Section 4: Channel logo ──
  // Red square
  const logoX = W - 85, logoY = 12, logoSize = 58
  ctx.fillStyle = '#D32F2F'
  ctx.beginPath()
  ctx.roundRect(logoX, logoY, logoSize, logoSize, 10)
  ctx.fill()

  // NM monogram (replaced the old 'T' mark)
  ctx.font = '800 34px Inter, sans-serif'
  ctx.fillStyle = '#FFFFFF'
  ctx.textAlign = 'center'
  ctx.fillText('NM', logoX + logoSize / 2, logoY + 42)

  // Channel name below
  ctx.font = '700 11px Inter, sans-serif'
  ctx.fillStyle = '#333333'
  ctx.textAlign = 'center'
  ctx.fillText('NEWS-MONSTER', logoX + logoSize / 2, logoY + logoSize + 14)

  // ── Save ──
  fs.mkdirSync(path.dirname(outPath), { recursive: true })
  fs.writeFileSync(outPath, canvas.toBuffer('image/png'))
  console.log('✅ Footer taskbar:', outPath, `(${fs.statSync(outPath).size} bytes)`)
  return outPath
}

// CLI
if (import.meta.url.endsWith('footer.mjs')) {
  generateFooter(process.argv[2] || 'assets/footer.png')
    .then(p => console.log(`Ready: ${p}`))
    .catch(e => console.error('Footer error:', e))
}
