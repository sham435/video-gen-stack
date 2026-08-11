import { createCanvas, GlobalFonts, loadImage } from '@napi-rs/canvas'
import fs from 'fs'

const W = 1080, H = 1920
const canvas = createCanvas(W, H)
const ctx = canvas.getContext('2d')
const img = await loadImage('/tmp/brand_close_last.png')
ctx.drawImage(img, 0, 0)

// Scan rows: brightness profile to find content bands (text rows)
const rows = []
for (let y = 0; y < H; y += 2) {
  let lit = 0
  const d = ctx.getImageData(0, y, W, 2).data
  for (let i = 3; i < d.length; i += 4) if (d[i] > 0) lit++
  rows.push({ y, lit })
}
// Find contiguous bands with lit pixel coverage
const bands = []
let cur = null
for (const r of rows) {
  const active = r.lit > 200
  if (active && !cur) cur = { top: r.y, bot: r.y }
  else if (active && cur) cur.bot = r.y
  else if (!active && cur) { bands.push(cur); cur = null }
}
if (cur) bands.push(cur)
console.log('content bands (rows with >200 lit px):')
for (const b of bands) console.log(`  y ${b.top}->${b.bot} (h=${b.bot-b.top})`)
