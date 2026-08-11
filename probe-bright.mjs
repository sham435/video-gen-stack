import { createCanvas, loadImage } from '@napi-rs/canvas'
const W = 1080, H = 1920
const { SceneEngine } = await import('./src/video/SceneEngine.mjs')
const engine = new SceneEngine({ quality: 'default' })
const scene = { type: 'brand_close', duration: 6 }
const buf = await engine.renderSceneFrame(scene, 0.5, [], 0, null)
const canvas = createCanvas(W, H)
const ctx = canvas.getContext('2d')
await loadImage(buf).then(i => ctx.drawImage(i, 0, 0))

function probeRegion(x0, y0, x1, y1) {
  const d = ctx.getImageData(x0, y0, x1 - x0, y1 - y0).data
  let maxB = 0, brightN = 0, total = 0
  for (let i = 0; i < d.length; i += 4) {
    total++
    const lum = (d[i] + d[i + 1] + d[i + 2]) / 3
    if (lum > maxB) maxB = lum
    if (lum > 60) brightN++
  }
  return { maxB: maxB.toFixed(0), brightN, pct: (brightN / total * 100).toFixed(1) + '%' }
}

console.log('footer whole bar region (0,1710-1900):', probeRegion(0, 1710, 1080, 1900))
console.log('URL zone right (760-1080, 1760-1860):', probeRegion(760, 1760, 1080, 1860))
console.log('AVAILABLE zone left (0-300, 1780-1860):', probeRegion(0, 1780, 300, 1860))
console.log('LIVE corner top-right (840-1080, 0-60):', probeRegion(840, 0, 1080, 60))
console.log('LIVE pill area (1100-80):', probeRegion(1080 - 200, 10, 1080 - 30, 60))
console.log('bug top-left (14-300, 12-90):', probeRegion(10, 10, 300, 100))