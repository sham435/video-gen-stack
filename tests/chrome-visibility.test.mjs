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
  const platform = layout.left.find(c => c.key === 'platform')
  // URL in right zone, AVAILABLE ON in left zone — no shared x range.
  assert.ok(url.x > platform.x + platform.w, `url.x ${url.x} > platform right ${platform.x + platform.w}`)
  // Zone-level separation too.
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

test('footer tagline — readable (not crushed by vignette)', async () => {
  const ctx = await loadIntoCanvas(await renderBrandCloseFrame(1.0))
  const footerTop = FooterLayout.barTopInFrame(ctx, W, H)
  const layout = FooterLayout.compute(ctx, W)
  const url = layout.right.find(c => c.key === 'url')
  const urlTagPx = Math.round((BROADCAST_TEXT.footer.urlTagline.size) * layout.scale)
  const yRow = footerTop + Math.round(url.y) + Math.round((BROADCAST_TEXT.footer.url.size) * layout.scale) + Math.round(urlTagPx * 0.4)
  const x0 = Math.round(url.x), x1 = Math.round(url.x + url.w)
  const s = regionStats(ctx, x0, yRow, x1, yRow + 40)
  assert.ok(s.maxB >= 150, `tagline max brightness ${s.maxB} ≥150`)
})

test('footer — allowed by RenderManifest (canvas owner, enabled by default)', () => {
  const m = resolveRenderManifest({})
  assert.ok(m.canRender('footer', 'canvas'), 'footer canRender canvas')
  assert.equal(m.isEnabled('footer'), true)
})

// ── HEADER (NEWS-MONSTER + LIVE) ─────────────────────────────────────────

test('header — LIVE.x = brandRight + 40 (LinkedIn-safe 40px gap)', () => {
  const ctx = createCanvas(W, H).getContext('2d')
  const layout = headerLayout(ctx)
  const gap = layout.live.x - (layout.brand.x + layout.brand.w)
  assert.equal(gap, 40, `gap ${gap} must be exactly 40`)
})

test('header — NEWS-MONSTER and LIVE vertically aligned (same centerline)', () => {
  const ctx = createCanvas(W, H).getContext('2d')
  const layout = headerLayout(ctx)
  const brandCenter = layout.brand.y + layout.brand.h / 2
  const liveCenter = layout.live.y + layout.live.h / 2
  assert.ok(Math.abs(liveCenter - brandCenter) <= 0.6, `centerline delta ${Math.abs(liveCenter - brandCenter)}`)
})

test('header — LIVE + NEWS-MONSTER both inside top safe zone', () => {
  const ctx = createCanvas(W, H).getContext('2d')
  const layout = headerLayout(ctx)
  assert.ok(layout.brand.y >= 0 && layout.live.y >= 0)
  assert.ok(layout.live.y + layout.live.h <= 150, `LIVE bottom ${layout.live.y + layout.live.h}`)
  assert.ok(layout.live.x + layout.live.w <= W, 'LIVE inside width')
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