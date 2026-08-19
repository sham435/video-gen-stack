/**
 * Footer Generator — permanent overlay for all videos.
 *
 * Style: premium broadcast bar rendered by the shared FooterLayout engine
 * ([NM] NEWS-MONSTER + tagline | AVAILABLE ON badges | [SUBSCRIBE] + URL),
 * identical to the in-canvas footer so overlays and short-form renders match.
 *
 * Usage:  node scripts/footer.mjs                     # generates assets/footer.png
 *         node scripts/footer.mjs --asset 1920x300    # generates assets/footer_asset_1920x300.png
 *         node scripts/footer.mjs --watch             # watch mode for dev
 *         node scripts/footer.mjs --width 1920        # responsive width override
 */

import { createCanvas, GlobalFonts, loadImage } from '@napi-rs/canvas'
import fs from 'fs'
import path from 'path'
import { FooterLayout, loadPlatformIcons } from '../src/video/footer/FooterLayout.mjs'

try {
  if (fs.existsSync('assets/fonts/Montserrat-ExtraBold.ttf'))
    GlobalFonts.registerFromPath('assets/fonts/Montserrat-ExtraBold.ttf', 'Montserrat ExtraBold')
} catch {}

const W = 1080   // matches Shorts 9:16 width

/**
 * Generate the footer bar PNG overlay via the shared layout engine.
 */
export async function generateFooter(outPath = 'assets/footer.png', width = W) {
  const layout = FooterLayout.compute(createCanvas(width, 1).getContext('2d'), width)
  const H = layout.barHeight
  const canvas = createCanvas(width, H)
  const ctx = canvas.getContext('2d')

  const icons = await loadPlatformIcons()
  FooterLayout.renderStandalone(ctx, width, {}, icons)

  fs.mkdirSync(path.dirname(outPath), { recursive: true })
  fs.writeFileSync(outPath, canvas.toBuffer('image/png'))
  console.log('✅ Footer bar:', outPath, `(${width}x${H}, ${fs.statSync(outPath).size} bytes)`)
  return outPath
}

/**
 * Generate the fixed-size footer band for thumbnail overlays (e.g. 1920x300).
 * The layout engine is the single source of truth; if the natural bar at the
 * requested width is taller than maxH, the content scale shrinks to fit so
 * the band never clips. Content stays right-aligned at the 40px safe margin.
 */
export async function generateFooterAsset(outPath = 'assets/footer_asset_1920x300.png', width = 1920, maxH = 300) {
  const icons = await loadPlatformIcons()
  const ctx0 = createCanvas(width, 1).getContext('2d')
  // barHeight scales linearly with the design scale below the maxScale clamp
  // (at 1920 the natural scale is clamped 1.5, so derive the fit scale from
  // the unclamped design surface instead of the target width).
  const design = FooterLayout.compute(ctx0, 1080)
  const sFit = Math.min(1.5, maxH / design.barHeight)
  const fitW = Math.round(1080 * sFit)
  const layout = FooterLayout.compute(ctx0, fitW)
  const canvas = createCanvas(width, maxH)
  const ctx = canvas.getContext('2d')
  const dx = width - fitW
  const dy = Math.round((maxH - layout.barHeight) / 2)

  ctx.fillStyle = '#000000'
  ctx.fillRect(0, 0, width, maxH)
  ctx.fillStyle = '#E10600'
  ctx.fillRect(0, maxH - 3, width * 0.3, 3)

  ctx.save()
  ctx.translate(dx, dy)
  for (const col of [...layout.left, ...layout.right]) {
    col.block.draw(ctx, col, layout.scale, layout.data, icons)
  }
  ctx.restore()

  fs.mkdirSync(path.dirname(outPath), { recursive: true })
  fs.writeFileSync(outPath, canvas.toBuffer('image/png'))
  console.log('✅ Footer asset:', outPath, `(${width}x${maxH}, ${fs.statSync(outPath).size} bytes)`)
  return outPath
}

// CLI
if (process.argv[1] && import.meta.url.endsWith(process.argv[1])) {
  const watch = process.argv.includes('--watch')
  const wIdx = process.argv.indexOf('--width')
  const width = wIdx >= 0 && process.argv[wIdx + 1] ? Number(process.argv[wIdx + 1]) : W

  const aIdx = process.argv.indexOf('--asset')
  const run = () => {
    if (aIdx >= 0) {
      const spec = (process.argv[aIdx + 1] || '1920x300').split('x').map(Number)
      const outPath = process.argv[2] && !process.argv[2].startsWith('--') ? process.argv[2] : 'assets/footer_asset_1920x300.png'
      return generateFooterAsset(outPath, spec[0], spec[1])
    }
    return generateFooter(process.argv[2] || 'assets/footer.png', width)
      .then(p => console.log(`Ready: ${p}`))
  }

  run().catch(e => console.error('Footer error:', e))
  if (watch) {
    console.log('Watching for changes (Ctrl+C to stop).')
    setInterval(run, 2000)
  }
}