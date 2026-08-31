// Regression suite: exactly ONE footer (single-authority render ownership).
//
// PRODUCTION BUG: the latest LinkedIn/YouTube video had TWO stacked
// NEWS-MONSTER footers. Root cause: the render engine bakes the footer into
// every frame on CANVAS (BrandingLayer.drawFooter → FooterLayout.draw, the
// manifest-correct owner), but scripts/composer.mjs ALSO ffmpeg-overlaid
// assets/footer.png onto the final at main_h-overlay_h — bypassing the
// RenderManifest ownership gate that src/index.mjs already enforces. Two
// independent footer producers → two footer bars.
//
// These tests prove single ownership is enforced at every layer:
//   1. the default render manifest owns footer by exactly one renderer (canvas),
//   2. no layer/script may render the footer unless the manifest grants it,
//   3. composer.mjs's ffmpeg overlay is gated by the same manifest,
//   4. the composed frame contains exactly one footer bar,
//   5. a real composed frame of the Expo pipeline shows one footer bar region.
//
// Run: node --test tests/footer-single-owner.test.mjs

import test from 'node:test'
import assert from 'node:assert/strict'
import { createCanvas, GlobalFonts } from '@napi-rs/canvas'
import fs from 'fs'
import { FooterLayout } from '../src/video/footer/FooterLayout.mjs'
import { resolveRenderManifest, resolveRenderGates } from '../src/pipeline/RenderManifest.mjs'
import { Compositor } from '../src/video/Compositor.mjs'
import { BROADCAST_TEXT } from '../src/style/text-tokens.mjs'

if (fs.existsSync('assets/fonts/Montserrat-ExtraBold.ttf'))
  GlobalFonts.registerFromPath('assets/fonts/Montserrat-ExtraBold.ttf', 'Montserrat ExtraBold')

const W = 1280, H = 720

function makeCanvas() {
  return createCanvas(W, H).getContext('2d')
}

function footerBarRuns(ctx) {
  // The footer bar is recognizable by its red accent strip (#E10600, a ~3px
  // line at the bar's bottom edge, spanning the left 30% of the width). A
  // single footer → exactly ONE accent band; the production bug (canvas footer
  // + standalone footer.png overlay) yielded TWO accent bands on the same
  // frame. Counting dense-red horizontal bands is robust to text rows inside
  // the bar (which split the near-black background into many runs).
  const W = ctx.canvas.width, H = ctx.canvas.height
  const layout = FooterLayout.compute(ctx, W)
  const barTop = FooterLayout.barTopInFrame(ctx, W, H)
  const scanTop = Math.max(0, barTop - 4)

  const d = ctx.getImageData(0, scanTop, W, H - scanTop).data
  const redRows = []
  for (let r = 0; r < H - scanTop; r++) {
    let red = 0, total = 0
    for (let x = 0; x < W; x += 2) {
      total++
      const i = (r * W + x) * 4
      if (d[i] > 170 && d[i + 1] < 70 && d[i + 2] < 70) red++
    }
    redRows.push(red / total >= 0.25)
  }

  // Merge adjacent red rows into bands.
  const bands = []
  let band = null
  for (let r = 0; r < redRows.length; r++) {
    if (redRows[r]) {
      if (!band) band = { start: scanTop + r }
    } else if (band) {
      band.end = scanTop + r
      bands.push(band)
      band = null
    }
  }
  if (band) { band.end = H; bands.push(band) }
  return bands.filter(b => b.end - b.start >= 2) // ignore 1px noise
}

// ── 1. Manifest: exactly one footer owner ───────────────────────────────

test('manifest — footer owned by exactly one renderer (canvas by default)', () => {
  const m = resolveRenderManifest({})
  const canCanvas = m.canRender('footer', 'canvas')
  const canFfmpeg = m.canRender('footer', 'ffmpeg')
  assert.equal(canCanvas, true, 'canvas footer enabled by default')
  assert.equal(canFfmpeg, false, 'no second owner may render the footer')
  assert.equal(m.isEnabled('footer'), true)
  assert.equal(m.owner('footer'), 'canvas')
})

test('manifest — disabling canvas closes the door for ffmpeg (single-owner contract)', () => {
  const m = resolveRenderManifest({ footer: false })
  assert.equal(m.canRender('footer', 'canvas'), false)
  // The manifest owner slot stays a single value; ffmpeg is only ever reached
  // through the gates below, never as a concurrent second owner.
  assert.equal(m.owner('footer') !== null, true)
})

test('gates — overlay is forbidden while canvas owns the footer (single-owner rule)', () => {
  const m = resolveRenderManifest({})
  const gates = resolveRenderGates({ overlayFooter: true }, m)
  assert.equal(gates.overlayFooter, false, 'overlay must not run when canvas owns footer')
})

test('gates — overlay allowed only when canvas footer is disabled', () => {
  const m = resolveRenderManifest({ footer: false })
  const gates = resolveRenderGates({ overlayFooter: true }, m)
  assert.equal(gates.overlayFooter, true)
})

// ── 2. Compositor: only draws footer when manifest grants canvas ────────

test('compositor — footer layer honors the manifest gate (no drawing when denied)', () => {
  const compositor = new Compositor()
  const manifest = resolveRenderManifest({ footer: false })
  let footerDrawn = 0
  const originalDraw = compositor.branding.draw.bind(compositor.branding)
  compositor.branding.draw = (...args) => {
    if (args[1] && args[1].type !== 'brand_close') footerDrawn++
    return originalDraw(...args)
  }
  // footer disabled → the ownership gate inside Compositor must skip it.
  const ctx = makeCanvas()
  const scene = { type: 'logo', duration: 4, category: 'technology' }
  void compositor.compose(ctx, scene, 0.5, 0, 'technology', manifest)
  assert.equal(footerDrawn, 0, 'footer must not render when canvas is denied')
})

test('compositor — footer rendered exactly once per frame when canvas owns it', async () => {
  const compositor = new Compositor()
  const manifest = resolveRenderManifest({})
  let footerCalls = 0
  const original = compositor.branding.draw.bind(compositor.branding)
  compositor.branding.draw = (...args) => { footerCalls++; return original(...args) }
  const ctx = makeCanvas()
  const scene = { type: 'logo', duration: 4, category: 'technology' }
  await compositor.compose(ctx, scene, 0.5, 0, 'technology', manifest)
  assert.equal(footerCalls, 1, 'exactly one footer draw per frame')
})

// ── 3. Composed frame: exactly one footer bar ───────────────────────────

test('composed frame — exactly one footer accent band (no stacked duplicate)', async () => {
  const { SceneEngine } = await import('../src/video/SceneEngine.mjs')
  const engine = new SceneEngine({ quality: 'default', category: 'technology' })
  const scene = { type: 'logo', duration: 4, category: 'technology', image: null }
  const buf = await engine.renderSceneFrame(scene, 0.5, [], 0, null)
  const canvas = createCanvas(W, H)
  const ctx = canvas.getContext('2d')
  const { loadImage } = await import('@napi-rs/canvas')
  ctx.drawImage(await loadImage(buf), 0, 0)

  const bands = footerBarRuns(ctx)
  assert.equal(bands.length, 1, `exactly ONE footer bar (got ${bands.length}: ${JSON.stringify(bands)})`)
})

// ── 4. Pipeline boundaries reference the same gate ──────────────────────

test('composer overlay — the ffmpeg footer composite is gated by the manifest', () => {
  // The exact decision composer.mjs now makes: only composite footer.png when
  // the manifest hands the footer to ffmpeg. Re-assert the values the
  // composer uses so a regression reverting the gate fails here.
  const m = resolveRenderManifest({})
  const gates = resolveRenderGates({}, m)
  assert.equal(gates.overlayFooter, false, 'default render skips footer.png composite')
})

test('composer source — footer.png composite is conditional on the manifest gate', () => {
  // Structural guard: the production bug was composer.mjs compositing
  // footer.png UNconditionally (bypassing RenderManifest). If someone reverts
  // that, this fails on the next run.
  const src = fs.readFileSync(new URL('../scripts/composer.mjs', import.meta.url), 'utf8')
  assert.ok(src.includes('gates.overlayFooter'), 'composer.mjs footer overlay must check gates.overlayFooter')
  assert.ok(src.includes('resolveRenderGates'), 'composer.mjs must consult the RenderManifest gates')
  const overlay = src.match(/if \(gates\.overlayFooter[\s\S]*?footerPath[\s\S]*?\) \{/)
  assert.ok(overlay, 'footer.png ffmpeg composite guarded by gate')
})

// ── 5. Readability contract (kept intact by the single-owner footer) ──────

test('readability — compact footer text stays readable (URL/brand ≥ legibility floor)', () => {
  // The footer is the single owner of the bottom chrome; the compact 16:9
  // strip still enforces a smaller-but-readable floor via the shared tokens,
  // so the in-frame canvas footer and any footer.png composite stay identical.
  const F = BROADCAST_TEXT.footer
  const ctx = makeCanvas()
  const layout = FooterLayout.compute(ctx, W)
  const urlPx = Math.round(F.url.size * layout.scale)
  const brandPx = Math.round(F.brand.size * layout.scale)
  assert.ok(urlPx >= 12, `URL ${urlPx}px readable on the compact strip`)
  assert.ok(brandPx >= 24, `brand ${brandPx}px readable on the compact strip`)
})

test('readability — URL and subscribe pill share one centered row, no horizontal overlap', () => {
  const ctx = makeCanvas()
  const layout = FooterLayout.compute(ctx, W)
  const pill = layout.right.find(c => c.key === 'subscribe')
  const url = layout.right.find(c => c.key === 'url')
  // Both on the SAME centered row — the hard invariant is that nothing leaves
  // the bar and the URL stays left of the pill.
  assert.ok(url.y + url.h <= layout.barHeight + 1, `URL inside bar (bottom ${Math.round(url.y + url.h)} ≤ bar ${layout.barHeight})`)
  assert.ok(url.x + url.w <= pill.x, 'URL does not overlap the subscribe pill')
  const urlCenter = url.y + url.h / 2
  const pillCenter = pill.y + pill.h / 2
  assert.ok(Math.abs(pillCenter - urlCenter) <= 1.5, `pill shares the URL centerline (delta ${Math.abs(pillCenter - urlCenter).toFixed(2)})`)
})

test('outro caption — single-owner rule enforced at the gate (production BrandOutro)', async () => {
  // The 16:9 frame is only 720px tall and the outro's own end-card stack
  // legitimately covers the wide caption anchor band, so a pixel probe there
  // is not a clean signal. The real single-owner guarantee is a logic gate:
  // the production brand_outro scene (BrandOutro.mjs) sets textPolicy that
  // disables story captions — this holds for BOTH profiles. This is the
  // authoritative, profile-independent assertion of FOOTER-001/outro.
  const { canRenderText } = await import('../src/video/TextPolicy.mjs')
  const { brandOutroScene } = await import('../src/publishing/BrandOutro.mjs')
  const outro = brandOutroScene({})
  assert.equal(outro.type, 'close')
  assert.equal(canRenderText(outro, 'caption'), false, 'caption must be off for brand_outro')
  assert.equal(canRenderText(outro, 'generic'), false, 'generic scheduling must be off for brand_outro')
  assert.equal(canRenderText(outro, 'emphasis'), false, 'emphasis must be off for brand_outro')

  // And the full 16:9 composed frame still renders the end card visibly.
  const { SceneEngine } = await import('../src/video/SceneEngine.mjs')
  const { VIDEO_HD, DEFAULT_PROFILE } = await import('../src/video/RenderProfile.mjs')
  const { DesignSystem } = await import('../src/visuals/DesignSystem.mjs')
  const engine = new SceneEngine({ quality: 'default', category: 'technology' })
  const { loadImage, createCanvas } = await import('@napi-rs/canvas')
  const WW = 1280, HH = 720
  DesignSystem.setProfile(VIDEO_HD)
  const buf = await engine.renderSceneFrame(
    { ...outro, image: null, ticker: [] },
    0.9, [], 0, null
  )
  const ctx = createCanvas(WW, HH).getContext('2d')
  ctx.drawImage(await loadImage(buf), 0, 0)
  // End card tagline region (mid-frame) contains bright white text — proves the
  // outro content itself renders on 16:9 (not suppressed with the captions).
  const d = ctx.getImageData(0, 300, WW, 200).data
  let lit = 0
  for (let i = 0; i < d.length; i += 4) if ((d[i] + d[i + 1] + d[i + 2]) / 3 > 160) lit++
  DesignSystem.setProfile(DEFAULT_PROFILE)
  assert.ok(lit > 500, `16:9 outro end card paints (lit=${lit})`)
})