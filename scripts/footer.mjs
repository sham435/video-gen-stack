/**
 * Footer Generator — permanent overlay for all videos.
 *
 * Style: premium broadcast bar rendered by the shared FooterLayout engine
 * ([NM] NEWS-MONSTER + tagline | AVAILABLE ON badges | [SUBSCRIBE] + URL),
 * identical to the in-canvas footer so overlays and short-form renders match.
 *
 * Usage:  node scripts/footer.mjs               # generates assets/footer.png
 *         node scripts/footer.mjs --watch       # watch mode for dev
 *         node scripts/footer.mjs --width 1920  # responsive width override
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

// CLI
if (process.argv[1] && import.meta.url.endsWith(process.argv[1])) {
  const watch = process.argv.includes('--watch')
  const wIdx = process.argv.indexOf('--width')
  const width = wIdx >= 0 && process.argv[wIdx + 1] ? Number(process.argv[wIdx + 1]) : W

  const run = () => generateFooter(process.argv[2] || 'assets/footer.png', width)
    .then(p => console.log(`Ready: ${p}`))
    .catch(e => console.error('Footer error:', e))

  await run()
  if (watch) {
    console.log('Watching for changes (Ctrl+C to stop).')
    setInterval(run, 2000)
  }
}