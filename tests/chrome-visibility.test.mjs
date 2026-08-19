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
// Run: node --test tests/chrome-visibility.test.mjs

import test from 'node:test'
import assert from 'node:assert/strict'
import { createCanvas, GlobalFonts } from '@napi-rs/canvas'
import fs from 'fs'
import { FooterLayout } from '../src/video/footer/FooterLayout.mjs'
import { BROADCAST_TEXT } from '../src/style/text-tokens.mjs'
import { headerLayout } from '../src/layout/HeaderLayout.mjs'
import { resolveRenderManifest } from '../src/pipeline/RenderManifest.mjs'

if (fs.existsSync('assets/fonts/Montserrat-ExtraBold.ttf'))
  GlobalFonts.registerFromPath('assets/fonts/Montserrat-ExtraBold.ttf', 'Montserrat ExtraBold')

const W = 1080, H = 1920

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

test('footer layout — bar inside 1080x1920 bounds, URL within bar', () => {
  const ctx = createCanvas(W, H).getContext('2d')
  const layout = FooterLayout.compute(ctx, W)
  assert.ok(layout.barHeight > 0)
  assert.ok(layout.barHeight <= H, `barHeight ${layout.barHeight} <= ${H}`)
  for (const col of [...layout.left, ...layout.right]) {
    assert.ok(col.y >= 0 && col.y + col.h <= H, `${col.key} inside frame`)
    assert.ok(col.x >= 0 && col.x + col.w <= W, `${col.key} inside width`)
  }
})

test('footer URL — non-zero visible bounds inside the bar', () => {
  const ctx = createCanvas(W, H).getContext('2d')
  const layout = FooterLayout.compute(ctx, W)
  const url = layout.right.find(c => c.key === 'url')
  assert.ok(url, 'url column exists')
  assert.ok(url.w >= 60, `url column width ${url.w}`)
  assert.ok(url.h > 0, 'url column has height')
  assert.ok(url.y + url.h <= layout.barHeight + 1, 'url column inside bar')
})

test('footer URL — does not overlap AVAILABLE ON', () => {
  const ctx = createCanvas(W, H).getContext('2d')
  const layout = FooterLayout.compute(ctx, W)
  const url = layout.right.find(c => c.key === 'url')
  const platform = layout.right.find(c => c.key === 'platform')
  // URL on line 3, AVAILABLE ON badges on line 4 — vertically stacked, both
  // right-aligned. They must not overlap (URL bottom above platform top).
  assert.ok(url.y + url.h <= platform.y + 0.5, `url bottom ${url.y + url.h} <= platform top ${platform.y}`)
  // Zone-level separation still holds (right zone after left zone).
  const zones = layout.zones
  assert.ok(zones[2].x >= zones[0].x + zones[0].w, 'right zone after left zone')
})

test('footer — actually visible in the composed frame (bright text after post-process)', async () => {
  const ctx = await loadIntoCanvas(await renderBrandCloseFrame(1.0))
  const footerTop = FooterLayout.barTopInFrame(ctx, W, H)
  const layout = FooterLayout.compute(ctx, W)
  const url = layout.right.find(c => c.key === 'url')
  // URL text sits at the top of the URL column (right-aligned in the right zone).
  const yRow = footerTop + Math.round(url.y) + 16
  const x0 = Math.round(url.x), x1 = Math.round(url.x + url.w)
  const s = regionStats(ctx, x0, yRow, x1, yRow + 40)
  assert.ok(s.maxB >= 200, `URL area max brightness ${s.maxB} must be ≥200 (was ~124 before fix)`)
  assert.ok(s.pct > 0.1, `URL area has visible text (${(s.pct * 100).toFixed(1)}%)`)
})

test('footer — urlTagline removed (no second line under the URL)', async () => {
  const ctx = await loadIntoCanvas(await renderBrandCloseFrame(1.0))
  const footerTop = FooterLayout.barTopInFrame(ctx, W, H)
  const layout = FooterLayout.compute(ctx, W)
  const url = layout.right.find(c => c.key === 'url')
  const platform = layout.right.find(c => c.key === 'platform')
  // The gap between the URL row and the AVAILABLE ON row must be empty —
  // the removed urlTagline would have painted there (bright) if it came back.
  // Skip the first few px (URL glyph descenders sit at the box bottom).
  const yRow = footerTop + Math.round(url.y + url.h + 8)
  const gapH = Math.max(4, Math.round(platform.y - url.y - url.h - 10))
  const x0 = Math.round(url.x), x1 = Math.round(url.x + url.w)
  const s = regionStats(ctx, x0, yRow, x1, yRow + gapH)
  assert.ok(s.maxB < 150, `tagline gap is empty after removal (max brightness ${s.maxB})`)
})

test('footer — allowed by RenderManifest (canvas owner, enabled by default)', () => {
  const m = resolveRenderManifest({})
  assert.ok(m.canRender('footer', 'canvas'), 'footer canRender canvas')
  assert.equal(m.isEnabled('footer'), true)
})

// ── HEADER (NEWS-MONSTER + LIVE) ─────────────────────────────────────────

test('header (classic 16:9) — LIVE.x = brandRight + 40 (LinkedIn-safe 40px gap)', () => {
  const ctx = createCanvas(1920, 1080).getContext('2d')
  const layout = headerLayout(ctx)
  assert.equal(layout.shorts, false, '16:9 canvas must use the classic layout')
  const gap = layout.live.x - (layout.brand.x + layout.brand.w)
  assert.equal(gap, 40, `gap ${gap} must be exactly 40`)
})

test('header (classic 16:9) — NEWS-MONSTER and LIVE vertically aligned (same centerline)', () => {
  const ctx = createCanvas(1920, 1080).getContext('2d')
  const layout = headerLayout(ctx)
  const brandCenter = layout.brand.y + layout.brand.h / 2
  const liveCenter = layout.live.y + layout.live.h / 2
  assert.ok(Math.abs(liveCenter - brandCenter) <= 0.6, `centerline delta ${Math.abs(liveCenter - brandCenter)}`)
})

test('header (Shorts 9:16) — brand right-aligned at 40px margin, below the 160px controls band', () => {
  const ctx = createCanvas(W, H).getContext('2d')
  const layout = headerLayout(ctx, { chipWidth: 110 })
  assert.equal(layout.shorts, true, '9:16 canvas must use the Shorts layout')
  assert.equal(layout.brand.x + layout.brand.w, W - 40, 'brand right edge sits at the 40px safe margin')
  assert.equal(layout.brand.y, 170, 'brand row starts below the controls band')
  assert.ok(layout.brand.y >= 160, 'nothing above the 160px top danger line')
})

test('header (Shorts 9:16) — LIVE + category chip on a right-aligned row below the brand', () => {
  const ctx = createCanvas(W, H).getContext('2d')
  const chipWidth = 110
  const layout = headerLayout(ctx, { chipWidth })
  // Row 2 lives below the brand pill (never overlapping the top band)
  assert.ok(layout.live.y >= layout.brand.y + layout.brand.h, 'LIVE row is below the brand row')
  assert.ok(layout.chip.y >= layout.brand.y + layout.brand.h, 'chip row is below the brand row')
  // Right-aligned to the 40px safe margin: chip rightmost, LIVE left of it
  assert.equal(layout.chip.x + layout.chip.w, W - 40, 'chip right edge at the 40px safe margin')
  assert.ok(layout.live.x + layout.live.w <= layout.chip.x - 12, 'LIVE clears the chip (12px gap)')
  // Both rows entirely inside the frame width
  assert.ok(layout.brand.x >= 0 && layout.live.x >= 0 && layout.chip.x >= 0, 'all header chrome inside width')
})

test('header — LIVE pill actually painted in composed frame', async () => {
  const ctx = await loadIntoCanvas(await renderBrandCloseFrame(0.9))
  const layout = headerLayout(ctx)
  const box = layout.live
  const d = ctx.getImageData(box.x, box.y, Math.max(1, box.w), Math.max(1, box.h)).data
  let red = 0
  for (let i = 0; i < d.length; i += 4) if (d[i] > 120 && d[i + 1] < 100 && d[i + 2] < 100) red++
  assert.ok(red > 3000, `LIVE red pill pixels ${red}`)
})

// ── CHROME-vs-CONTENT ordering ──────────────────────────────────────────

test('chrome — footer drawn ABOVE post-process (never behind vignette)', async () => {
  const ctx = await loadIntoCanvas(await renderBrandCloseFrame(1.0))
  const footerTop = H - FooterLayout.compute(ctx, W).barHeight
  // The footer bar region must contain bright text; vignette alone yields ~124.
  const s = regionStats(ctx, 0, footerTop, W, H)
  assert.ok(s.maxB >= 200, `footer bar max brightness ${s.maxB} ≥200 (pre-fix was 124)`)
})

void fs