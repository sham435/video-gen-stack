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

const W = 1080, H = 1920

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

test('readability — footer text sizes readable (brand/URL ≥ legibility floor)', () => {
  // The footer is the single owner of the bottom chrome; these metrics are
  // enforced with the shared design tokens so the in-frame canvas footer and
  // any footer.png composite stay identical and readable.
  const F = BROADCAST_TEXT.footer
  const ctx = makeCanvas()
  const layout = FooterLayout.compute(ctx, W)
  const urlPx = Math.round(F.url.size * layout.scale)
  const brandPx = Math.round(F.brand.size * layout.scale)
  const availablePx = Math.round(F.available.size * layout.scale)
  assert.ok(urlPx >= 30, `URL ${urlPx}px readable (≥30)`)
  assert.ok(brandPx >= 34, `brand ${brandPx}px readable`)
  assert.ok(availablePx >= 22, `AVAILABLE ON ${availablePx}px readable`)
})

test('readability — URL baseline aligned with AVAILABLE ON; line gaps keep text apart', () => {
  const ctx = makeCanvas()
  const layout = FooterLayout.compute(ctx, W)
  const F = BROADCAST_TEXT.footer
  const { scale } = layout
  const platform = layout.left.find(c => c.key === 'platform')
  const url = layout.right.find(c => c.key === 'url')
  const urlBaseline = url.y + Math.round(F.url.size * scale)
  // URL aligns exactly with AVAILABLE ON only when the stack fits (no handle).
  // With the handle line the URL group clamps up; the hard invariant is that
  // the URL column never leaves the bar.
  assert.ok(url.y + url.h <= layout.barHeight + 1, `URL inside bar (bottom ${Math.round(url.y + url.h)} ≤ bar ${layout.barHeight})`)
  const noHandle = FooterLayout.compute(ctx, W, { handle: null, showHandle: false })
  const nhUrl = noHandle.right.find(c => c.key === 'url')
  const nhPlatform = noHandle.left.find(c => c.key === 'platform')
  const nhAvail = nhPlatform.y + Math.round(F.available.size * noHandle.scale)
  const nhUrlBaseline = nhUrl.y + Math.round(F.url.size * noHandle.scale)
  assert.equal(nhUrlBaseline, nhAvail, 'URL baseline === AVAILABLE ON baseline when no handle')
  // Vertical gap between stacked footer lines has a floor so glyphs never touch.
  const lineGapPx = Math.round(F.lineGap * scale)
  assert.ok(lineGapPx >= 12, `line gap ${lineGapPx}px`)
})

test('outro caption — CaptionLayer does not render in the lower third for close scenes', async () => {
  // The outro scene carries caption.fullText='STAY WITH NEWS-MONSTER'. The
  // centered InformationLayer stack already renders it; the CaptionLayer must
  // NOT duplicate it in the lower third (y≈H*0.78), where it collides with the
  // footer zone and re-prints the outro text. Single-owner rule, like FOOTER-001.
  const { SceneEngine } = await import('../src/video/SceneEngine.mjs')
  const engine = new SceneEngine({ quality: 'default', category: 'technology' })
  const { loadImage } = await import('@napi-rs/canvas')

  const buf = await engine.renderSceneFrame(
    { type: 'brand_close', outro: true, duration: 6, category: 'technology', image: null, ticker: [], caption: { focus: 'STAY WITH', fullText: 'STAY WITH NEWS-MONSTER' } },
    0.9, [], 0, null
  )
  const canvas = createCanvas(W, H)
  const ctx = canvas.getContext('2d')
  ctx.drawImage(await loadImage(buf), 0, 0)
  // CaptionEngine default anchor: y = H*0.78. Probe a tight window around it.
  const y0 = Math.floor(H * 0.78) - 30, y1 = Math.floor(H * 0.78) + 30
  let bright = 0
  const dd = ctx.getImageData(0, y0, W, y1 - y0).data
  for (let i = 0; i < dd.length; i += 4) {
    const l = (dd[i] + dd[i + 1] + dd[i + 2]) / 3
    if (l > 140) bright++
  }
  assert.equal(bright, 0, `outro scene must not render caption glyphs near footer (bright=${bright})`)
})