#!/usr/bin/env node
/** Verify "ගෝලීය" renders completely (no glyph loss) at 58 and 160px. */
import fs from 'node:fs'
import { shapeText, drawShaped } from '../src/i18n/ShapedText.mjs'
import { LANGUAGES } from '../src/i18n/languages.mjs'
import { createCanvas } from '@napi-rs/canvas'

const OUT = '/private/var/folders/s_/qn9r_k5s0tg_4d04c_txppzh0000gn/T/opencode'
const word = 'ගෝලීය'
for (const size of [58, 160]) {
  const layout = await shapeText(word, { fontFile: LANGUAGES.si.fontFiles, size, weight: 800 })
  console.log(`@${size}: advance=${layout.advancePx.toFixed(1)}px glyphs=${layout.glyphs.length} hasNotdef=${layout.hasNotdef}`)
  layout.glyphs.forEach((g, i) => {
    const gl = (g.rec || layout.glyphs[0].rec).otFont.glyphs.get(g.gid)
    const p = gl ? gl.getPath(0, 0, size) : null
    console.log(`  g${i} gid=${g.gid} x=${g.x.toFixed(1)} ink=${p && p.commands.length ? (p.getBoundingBox().x2 - p.getBoundingBox().x1).toFixed(1) : 'blank'}px`)
  })
  const W = Math.ceil(layout.advancePx + size), H = Math.ceil(size * 2.6)
  const cnv = createCanvas(W, H)
  const ctx = cnv.getContext('2d')
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, W, H)
  ctx.fillStyle = '#000'
  await drawShaped(ctx, word, size / 2, H / 2, { fontFile: LANGUAGES.si.fontFiles, size, weight: 800, baseline: 'middle', fillStyle: '#000' })
  const file = `${OUT}/verify-goliiya-${size}.png`
  fs.writeFileSync(file, cnv.toBuffer('image/png'))
  console.log(`  -> ${file}`)
}
