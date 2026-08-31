// Regression suite for chrome visibility in the actual compose path.
//
// These caught a real production bug: the footer and LIVE were drawn BEFORE
// PostProcessLayer, whose vignette + color grade painted over them — leaving
// the footer URL at brightness ~124, the tagline at ~84, and LIVE at ~83 in
// the rendered MP4, while the NEWS-MONSTER bug (drawn after post) stayed 255.
//
// The fixes are structural (z-order in Compositor + shared HeaderLayout), so
// the tests assert pixel brightness + geometry against an actual composed
// frame — not just layout math.
//
// The pipeline is 16:9 ONLY (1280x720 logical, VIDEO_HD).
//
// Run: node --test tests/chrome-visibility.test.mjs

import test from 'node:test'
import assert from 'node:assert/strict'
import { createCanvas, GlobalFonts } from '@napi-rs/canvas'
import fs from 'fs'
import { FooterLayout } from '../src/video/footer/FooterLayout.mjs'
import { headerLayout, HEADER_GAP } from '../src/layout/HeaderLayout.mjs'
import { resolveRenderManifest } from '../src/pipeline/RenderManifest.mjs'

if (fs.existsSync('assets/fonts/Montserrat-ExtraBold.ttf'))
  GlobalFonts.registerFromPath('assets/fonts/Montserrat-ExtraBold.ttf', 'Montserrat ExtraBold')

// Logical 16:9 frame (VIDEO_HD).
const W = 1280, H = 720

async function renderBrandCloseFrame(progress = 1.0) {
  const { SceneEngine } = await import('../src/video/SceneEngine.mjs')
  const engine = new SceneEngine({ quality: 'default', category: 'technology' })
  const scene = { type: 'brand_close', duration: 6, category: 'technology', image: 'output/batch-01/cover.png', ticker: ['AI', 'Robotics', 'Cybersecurity'] }
  return engine.renderSceneFrame(scene, progress, [], 0, null)
}

async function loadIntoCanvas(buf) {
  const canvas = createCanvas(W, H)
  const ctx = canvas.getContext('2d')
  const { loadImage } = await import('@napi-rs/canvas')
  const img = await loadImage(buf)
  ctx.drawImage(img, 0, 0)
  return ctx
}

function regionStats(ctx, x0, y0, x1, y1, brightThresh = 80) {
  const d = ctx.getImageData(Math.max(0, x0), Math.max(0, y0), Math.max(1, x1 - x0), Math.max(1, y1 - y0)).data
  let maxB = 0, brightN = 0, total = 0
  for (let i = 0; i < d.length; i += 4) {
    total++
    const lum = (d[i] + d[i + 1] + d[i + 2]) / 3
    if (lum > maxB) maxB = lum
    if (lum > brightThresh) brightN++
  }
  return { maxB, brightN, total, pct: brightN / total }
}

// ── FOOTER ──────────────────────────────────────────────────────────────

test('footer layout — compact bar inside 1280x720 bounds, URL within bar', () => {
  const ctx = createCanvas(W, H).getContext('2d')
  const layout = FooterLayout.compute(ctx, W)
  assert.ok(layout.barHeight > 0)
  assert.ok(layout.barHeight <= H, `barHeight ${layout.barHeight} <= ${H}`)
  assert.equal(layout.wide, true, 'footer is always the wide/compact 16:9 strip')
  for (const col of [...layout.left, ...layout.right]) {
    assert.ok(col.y >= 0 && col.y + col.h <= H, `${col.key} inside frame`)
    assert.ok(col.x >= 0 && col.x + col.w <= W, `${col.key} inside width`)
  }
})

test('footer — compact strip owns exactly the 4 columns (brand, logo, url, subscribe)', () => {
  const ctx = createCanvas(W, H).getContext('2d')
  const layout = FooterLayout.compute(ctx, W)
  const keys = layout.right.map(c => c.key).sort()
  assert.deepEqual(keys, ['brand', 'logo', 'subscribe', 'url'])
  // The full site URL stays rational and inside its box.
  const url = layout.right.find(c => c.key === 'url')
  assert.ok(url.w >= 60, `url column width ${url.w}`)
  assert.ok(url.y + url.h <= layout.barHeight + 1, 'url column inside bar')
})

test('footer — bottom-anchored at the frame bottom (SAFE_BOTTOM=0)', () => {
  const ctx = createCanvas(W, H).getContext('2d')
  const layout = FooterLayout.compute(ctx, W)
  const footerTop = FooterLayout.barTopInFrame(ctx, W, H)
  assert.ok(Math.abs(footerTop + layout.barHeight - H) <= 2, `footer bottom ${footerTop + layout.barHeight} == ${H}`)
})

test('footer — actually visible in the composed frame (bright text after post-process)', async () => {
  const ctx = await loadIntoCanvas(await renderBrandCloseFrame(1.0))
  const footerTop = FooterLayout.barTopInFrame(ctx, W, H)
  const layout = FooterLayout.compute(ctx, W)
  const url = layout.right.find(c => c.key === 'url')
  // Center of the URL column, a few px above the accent line.
  const yRow = footerTop + Math.round(url.y) + 6
  const x0 = Math.round(url.x), x1 = Math.round(url.x + url.w)
  const s = regionStats(ctx, x0, yRow, x1, yRow + url.h)
  assert.ok(s.maxB >= 200, `URL area max brightness ${s.maxB} must be ≥200 (was ~124 before fix)`)
  assert.ok(s.pct > 0.05, `URL area has visible text (${(s.pct * 100).toFixed(1)}%)`)
})

test('footer — allowed by RenderManifest (canvas owner, enabled by default)', () => {
  const m = resolveRenderManifest({})
  assert.ok(m.canRender('footer', 'canvas'), 'footer canRender canvas')
  assert.equal(m.isEnabled('footer'), true)
})

// ── HEADER (NEWS-MONSTER + LIVE + CATEGORY, single right-aligned row) ────

test('header — brand rightmost, 40px from the right edge', () => {
  const ctx = createCanvas(W, H).getContext('2d')
  const layout = headerLayout(ctx, undefined, 'TECHNOLOGY')
  const rightGap = W - (layout.brand.x + layout.brand.w)
  assert.ok(Math.abs(rightGap - 40) <= 0.6, `brand rightGap ${rightGap} == 40px from right edge`)
})

test('header — LIVE, category, brand share the same centerline; gaps are HEADER_GAP', () => {
  const ctx = createCanvas(W, H).getContext('2d')
  const layout = headerLayout(ctx, undefined, 'TECHNOLOGY')
  const center = layout.brand.y + layout.brand.h / 2
  for (const box of [layout.live, layout.category, layout.brand]) {
    assert.ok(Math.abs(box.y + box.h / 2 - center) <= 0.6, `centerline delta ${Math.abs(box.y + box.h / 2 - center)}`)
  }
  assert.equal(layout.gap, HEADER_GAP)
  // Right-aligned order: LIVE left of category left of brand.
  assert.ok(layout.live.x + layout.live.w <= layout.category.x, 'LIVE left of category')
  assert.ok(layout.category.x + layout.category.w <= layout.brand.x, 'category left of brand')
})

test('header — NEWS-MONSTER + LIVE + CATEGORY all inside the top safe zone', () => {
  const ctx = createCanvas(W, H).getContext('2d')
  const layout = headerLayout(ctx, undefined, 'TECHNOLOGY')
  assert.ok(layout.brand.y >= 0 && layout.live.y >= 0 && layout.category.y >= 0)
  assert.ok(layout.brand.y <= 44, `brand top ${layout.brand.y} at compact header y`)
  for (const box of [layout.live, layout.category, layout.brand]) {
    assert.ok(box.y + box.h <= 150, `pill bottom ${box.y + box.h}`)
    assert.ok(box.x + box.w <= W, 'pill inside width')
  }
})

test('header — LIVE pill actually painted in composed frame', async () => {
  const ctx = await loadIntoCanvas(await renderBrandCloseFrame(0.9))
  const layout = headerLayout(ctx, undefined, 'TECHNOLOGY')
  const box = layout.live
  const d = ctx.getImageData(box.x, box.y, Math.max(1, box.w), Math.max(1, box.h)).data
  let red = 0
  for (let i = 0; i < d.length; i += 4) if (d[i] > 120 && d[i + 1] < 100 && d[i + 2] < 100) red++
  assert.ok(red > 300, `LIVE red pill pixels ${red}`)
})

// ── CHROME-vs-CONTENT ordering ──────────────────────────────────────────

test('chrome — footer drawn ABOVE post-process (never behind vignette)', async () => {
  const ctx = await loadIntoCanvas(await renderBrandCloseFrame(1.0))
  const footerTop = FooterLayout.barTopInFrame(ctx, W, H)
  // The footer bar region must contain bright text; vignette alone yields ~124.
  const s = regionStats(ctx, 0, footerTop, W, H)
  assert.ok(s.maxB >= 200, `footer bar max brightness ${s.maxB} ≥200 (pre-fix was 124)`)
})

void fs
