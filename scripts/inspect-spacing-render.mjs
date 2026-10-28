#!/usr/bin/env node
/**
 * inspect-spacing-render.mjs — Task-135 render inspector.
 * 1) RUNTIME truth of opentype.js glyph-scale behavior (default fontSize vs
 *    explicit size) for the vendored Tamil/Sinhala fonts.
 * 2) RENDER PNGs (white bg, black text, faint 100px advance gridlines) of real
 *    words at caption (58px) and headline (160px) sizes for eyeball review.
 * PNGs land in the OS temp dir — never inside the repo.
 */
import fs from 'node:fs'
import { shapeText, drawShaped } from '../src/i18n/ShapedText.mjs'
import { LANGUAGES } from '../src/i18n/languages.mjs'
import { createCanvas } from '@napi-rs/canvas'

const OUT = '/private/var/folders/s_/qn9r_k5s0tg_4d04c_txppzh0000gn/T/opencode'

console.log('── RUNTIME opentype.js scale behavior ────────────────────────')
for (const [code, word] of [['ta', 'உலகளாவிய'], ['si', 'වැසි']]) {
  const pack = LANGUAGES[code]
  const layout = await shapeText(word, { fontFile: pack.fontFiles, size: 96, weight: 800 })
  const rec = layout.glyphs[0]?.rec
  const gl = rec.otFont.glyphs.get(layout.glyphs[0].gid)
  const bd = gl.getPath(0, 0).getBoundingBox()          // default (drawShaped today)
  const bs = gl.getPath(0, 0, 96).getBoundingBox()      // explicit size
  const b72 = gl.getPath(0, 0, 72).getBoundingBox()
  console.log(`${code} glyph gid=${layout.glyphs[0].gid} fontUpem=${rec.upem}`)
  console.log(`  path.unitsPerEm = ${gl.path.unitsPerEm}`)
  console.log(`  default(72)  w=${(bd.x2 - bd.x1).toFixed(3)}`)
  console.log(`  explicit 96  w=${(bs.x2 - bs.x1).toFixed(3)}`)
  console.log(`  explicit 72  w=${(b72.x2 - b72.x1).toFixed(3)}  (sanity vs default)`)
  console.log(`  default/explicit96 ratio = ${((bd.x2 - bd.x1) / (bs.x2 - bs.x1)).toFixed(4)}`)
}

console.log('\n── RENDER PNGs for eyeballing (white bg, black text) ─────────')
const SAMPLES = {
  ta: ['பருவமழை உலகளாவிய அரிசி அறுவடை', 'உலகளாவிய'],
  si: ['මෝසම් වැසි ගෝලීය සහල් අස්වැන්න', 'වැසි'],
}
for (const code of ['ta', 'si']) {
  const pack = LANGUAGES[code]
  for (const word of SAMPLES[code]) {
    for (const size of [58, 160]) {
      const W = 2400, H = Math.round(size * 2.6), y = H / 2
      const cnv = createCanvas(W, H)
      const ctx = cnv.getContext('2d')
      ctx.fillStyle = '#ffffff'
      ctx.fillRect(0, 0, W, H)
      ctx.strokeStyle = 'rgba(0,128,255,0.18)'
      ctx.lineWidth = 1
      for (let gx = 0; gx < W; gx += 100) { ctx.beginPath(); ctx.moveTo(gx, 0); ctx.lineTo(gx, H); ctx.stroke() }
      ctx.fillStyle = '#111111'
      const adv = await drawShaped(ctx, word, 60, y, { fontFile: pack.fontFiles, size, weight: 800, baseline: 'middle', fillStyle: '#111111' })
      const file = `${OUT}/spacing-${code}-${size}-${word.slice(0, 6).replace(/[^\p{L}]/gu, '')}.png`
      fs.writeFileSync(file, cnv.toBuffer('image/png'))
      console.log(`${code} @${size} "${word.slice(0, 14)}…" advance=${adv.toFixed(1)}px -> ${file}`)
    }
  }
}
console.log('DONE')
