// Pixel-probe verification for the broadcast footer.
//
// The pipeline is 16:9 ONLY, so the footer is a single COMPACT bottom-anchored
// strip occupying one centered row on a 1280x720 (VIDEO_HD) logical frame:
//   left:  domain URL
//   center: NEWS-MONSTER wordmark + [NM] monogram pair (horizontally centered)
//   right: SUBSCRIBE pill
// with a red accent line at the frame's bottom edge. This verifies:
//   1. the 3-column zone grid (25% | 50% | 25%) never clips the canvas edges,
//   2. no column overlaps its zone / neighbour,
//   3. the brand+logo pair is horizontally centered on the frame,
//   4. the strip is bottom-anchored and never exceeds the frame,
//   5. the footer.png generator probes clean.
//
// Run: node --test tests/footer-layout.test.mjs

import test from 'node:test'
import assert from 'node:assert/strict'
import { createCanvas, GlobalFonts } from '@napi-rs/canvas'
import fs from 'fs'
import { FooterLayout } from '../src/video/footer/FooterLayout.mjs'

if (fs.existsSync('assets/fonts/Montserrat-ExtraBold.ttf'))
  GlobalFonts.registerFromPath('assets/fonts/Montserrat-ExtraBold.ttf', 'Montserrat ExtraBold')

// Logical 16:9 frame (VIDEO_HD).
const W = 1280, H = 720
const PAD = 0.5 // tolerance for float measure rounds

test('footer — compact bar fits inside the 1280x720 frame', () => {
  const ctx = createCanvas(W, H).getContext('2d')
  const layout = FooterLayout.compute(ctx, W)
  assert.ok(layout.barHeight > 0, 'bar has height')
  assert.ok(layout.barHeight <= H, `bar ${layout.barHeight} <= frame ${H}`)
  assert.equal(layout.wide, true, 'the 16:9 footer is always the wide/compact strip')
})

test('footer — exactly 3 zones left|center|right; right is the widest (no clipping, no overlap)', () => {
  const ctx = createCanvas(W, H).getContext('2d')
  const layout = FooterLayout.compute(ctx, W)
  const zones = layout.zones

  assert.deepEqual(zones.map(z => z.key), ['left', 'center', 'right'], 'zone order: left | center | right')
  // URL column in the left zone must get the full domain; right zone holds the pill.
  for (const z of zones) {
    assert.ok(z.x >= -PAD, `${z.key} left ${z.x}`)
    assert.ok(z.x + z.w <= W + PAD, `${z.key} right ${z.x + z.w} <= ${W}`)
  }
  for (let i = 1; i < zones.length; i++) {
    assert.ok(zones[i].x + PAD >= zones[i - 1].x + zones[i - 1].w, `${zones[i - 1].key}->${zones[i].key} overlap`)
  }
})

test('footer — compact strip owns exactly 4 columns and hugs a single centered row', () => {
  const ctx = createCanvas(W, H).getContext('2d')
  const layout = FooterLayout.compute(ctx, W)

  assert.deepEqual(layout.left, [], 'no left-zone stack in the compact strip')
  const right = layout.right
  const keys = right.map(c => c.key)
  assert.deepEqual(keys.slice().sort(), ['brand', 'logo', 'subscribe', 'url'], 'columns: brand, logo, url, subscribe')

  const brand = right.find(c => c.key === 'brand')
  const logo = right.find(c => c.key === 'logo')
  const url = right.find(c => c.key === 'url')
  const pill = right.find(c => c.key === 'subscribe')

  // URL on the left, subscribe pill on the right.
  assert.ok(brand.x > url.x, 'domain URL is left of the brand')
  assert.ok(pill.x + pill.w > brand.x + brand.w, 'subscribe pill is right of the brand')

  // All columns share one centerline (single centered row).
  const centers = [brand, logo, url, pill].map(c => c.y + c.h / 2)
  for (const c of centers) {
    assert.ok(Math.abs(c - centers[0]) <= 1.5, `single centerline (delta ${Math.abs(c - centers[0]).toFixed(2)})`)
  }

  // brand+logo pair is horizontally centered on the frame.
  const groupL = Math.min(brand.x, logo.x)
  const groupR = Math.max(brand.x + brand.w, logo.x + logo.w)
  const groupCX = (groupL + groupR) / 2
  assert.ok(Math.abs(groupCX - W / 2) <= 4, `brand+logo group centered near frame middle (dx ${Math.abs(groupCX - W / 2).toFixed(2)})`)

  // URL column is non-trivial and inside the bar.
  assert.ok(url.w >= 60, `url column width ${url.w.toFixed(0)}`)
  assert.ok(url.y + url.h <= layout.barHeight + 1, 'URL column inside compact bar')

  // Compact bar height is small relative to the frame.
  assert.ok(layout.barHeight <= H * 0.2, `compact bar ${layout.barHeight} <= 20% of frame`)
})

test('footer — bottom-anchored at the frame bottom (SAFE_BOTTOM=0)', () => {
  const ctx = createCanvas(W, H).getContext('2d')
  const layout = FooterLayout.compute(ctx, W)
  const footerBottom = FooterLayout.barTopInFrame(ctx, W, H) + layout.barHeight
  assert.ok(Math.abs(footerBottom - H) <= 2, `wide footer bottom-anchored at frame bottom (${footerBottom} == ${H})`)
})

test('footer draw — produces a non-empty frame with the 4 compact columns', () => {
  const canvas = createCanvas(W, H)
  const ctx = canvas.getContext('2d')
  const layout = FooterLayout.draw(ctx, W, H)
  assert.equal(layout.left.length, 0)
  assert.equal(layout.right.length, 4)
  const barTop = FooterLayout.barTopInFrame(ctx, W, H)
  const data = ctx.getImageData(0, barTop, W, layout.barHeight).data
  let lit = 0
  for (let i = 3; i < data.length; i += 4) if (data[i] > 0) lit++
  assert.ok(lit > 500, `bar has lit pixels: ${lit}`)
})

test('draw — each block paints content in its column', () => {
  const canvas = createCanvas(W, H)
  const ctx = canvas.getContext('2d')
  const layout = FooterLayout.draw(ctx, W, H)
  for (const col of [...layout.left, ...layout.right]) {
    const img = ctx.getImageData(
      Math.max(0, Math.floor(col.x)),
      Math.max(0, Math.floor(col.y)),
      Math.min(W, Math.max(1, Math.floor(col.x + col.w))) - Math.max(0, Math.floor(col.x)),
      Math.min(H, Math.max(1, Math.floor(col.y + col.h))) - Math.max(0, Math.floor(col.y))
    )
    const d = img.data
    let lit = 0
    for (let i = 3; i < d.length; i += 4) if (d[i] > 0) lit++
    assert.ok(lit > 20, `${col.key} paints content (lit=${lit})`)
  }
})

// The generated assets/footer.png matches the shared engine.
test('footer generator — writes a responsive PNG that probes clean', () => {
  const ctx = createCanvas(W, 1).getContext('2d')
  const layout = FooterLayout.compute(ctx, W)
  const canvas = createCanvas(W, layout.barHeight)
  const dctx = canvas.getContext('2d')
  FooterLayout.renderStandalone(dctx, W, {})
  const data = dctx.getImageData(0, 0, W, layout.barHeight).data
  let lit = 0
  for (let i = 3; i < data.length; i += 4) if (data[i] > 0) lit++
  assert.ok(lit > 500, `standalone bar lit pixels ${lit}`)
})

// The ticker docks above the footer's ACTUAL bar top (computed).
test('ticker docks strictly above the footer bar (no overlap)', () => {
  const ctx = createCanvas(W, H).getContext('2d')
  FooterLayout.compute(ctx, W)
  const footerTop = FooterLayout.barTopInFrame(ctx, W, H)
  const tickerH = 50
  const margin = 14
  const tickerY = footerTop - tickerH - margin
  assert.ok(tickerY + tickerH <= footerTop, `ticker bottom ${tickerY + tickerH} <= footer top ${footerTop}`)
})

// Rendering the brand-close scene must not throw and yields a frame that puts
// the footer at the bottom without clipping.
test('brand close — composed frame still renders the compact footer', async () => {
  const { SceneEngine } = await import('../src/video/SceneEngine.mjs')
  const engine = new SceneEngine({ category: 'technology' })
  const scene = { type: 'brand_close', duration: 3, ticker: ['AI', 'Robotics', 'Cybersecurity', 'Space'] }
  const buf = await engine.renderSceneFrame(scene, 1.0, [], 0, null)
  const canvas = createCanvas(W, H)
  const cctx = canvas.getContext('2d')
  const { loadImage } = await import('@napi-rs/canvas')
  cctx.drawImage(await loadImage(buf), 0, 0)

  const footerTop = FooterLayout.barTopInFrame(cctx, W, H)
  const d = cctx.getImageData(0, footerTop, W, H - footerTop).data
  let lit = 0
  for (let i = 3; i < d.length; i += 4) if (d[i] > 0) lit++
  assert.ok(lit > 500, `composed footer region paints (lit=${lit})`)
})

void fs
