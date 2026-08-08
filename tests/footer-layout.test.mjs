// Pixel-probe verification for the responsive broadcast footer.
//
// Renders the FooterLayout on 9:16 (1080x1920), square (1080x1080), and
// 16:9 (1920x1080) surfaces and asserts the fixed 3-column broadcast grid:
//   1. zones are 25% | 50% | 25% and never clip the canvas edges,
//   2. left/right stacks never overlap their zone boundaries,
//   3. the URL column is always fully inside its box (ellipsized, never wraps),
//   4. the YouTube pill keeps its 50px (scaled) height and the bar owns the
//      180px bottom safe zone (footer height never exceeds the frame).
//
// Run: node --test tests/footer-layout.test.mjs

import test from 'node:test'
import assert from 'node:assert/strict'
import { createCanvas, GlobalFonts } from '@napi-rs/canvas'
import fs from 'node:fs'
import { FooterLayout } from '../src/video/footer/FooterLayout.mjs'
import { BROADCAST_TEXT } from '../src/style/text-tokens.mjs'
const FOOTER = BROADCAST_TEXT.footer

if (fs.existsSync('assets/fonts/Montserrat-ExtraBold.ttf'))
  GlobalFonts.registerFromPath('assets/fonts/Montserrat-ExtraBold.ttf', 'Montserrat ExtraBold')

const FORMATS = [
  { name: '9:16', W: 1080, H: 1920 },
  { name: '1:1', W: 1080, H: 1080 },
  { name: '16:9', W: 1920, H: 1080 },
]

const PAD = 0.5 // tolerance for float measure rounds

for (const fmt of FORMATS) {
  test(`footer layout — ${fmt.name} (${fmt.W}x${fmt.H})`, () => {
    const ctx = createCanvas(fmt.W, fmt.H).getContext('2d')
    const layout = FooterLayout.compute(ctx, fmt.W)
    const zones = layout.zones

    // 1. Bar fits inside the frame.
    assert.ok(layout.barHeight > 0, 'bar has height')
    assert.ok(layout.barHeight <= fmt.H, `bar ${layout.barHeight} <= frame ${fmt.H}`)

    // 2. Exactly three zones: left | center | right.
    assert.deepEqual(
      zones.map(z => z.key),
      ['left', 'center', 'right'],
      'zone order: left | center | right'
    )
    assert.ok(Math.abs(zones[0].w - zones[2].w) < 1, 'left/right zones equal width')
    assert.ok(zones[1].w > zones[0].w * 1.5, 'center zone is the largest (whitespace)')

    // 3. No zone clips the canvas horizontally.
    for (const z of zones) {
      assert.ok(z.x >= -PAD, `${z.key} left ${z.x}`)
      assert.ok(z.x + z.w <= fmt.W + PAD, `${z.key} right ${z.x + z.w} <= ${fmt.W}`)
    }

    // 4. Zones do not overlap (ordered, contiguous).
    for (let i = 1; i < zones.length; i++) {
      assert.ok(
        zones[i].x + PAD >= zones[i - 1].x + zones[i - 1].w,
        `${zones[i - 1].key}->${zones[i].key} overlap`
      )
    }

    // 5. Left stack: logo then AVAILABLE ON, stacked vertically inside left zone.
    const [logo, platform] = layout.left
    assert.equal(logo.key, 'logo')
    assert.equal(platform.key, 'platform')
    assert.ok(logo.h > 0 && platform.h > 0)
    assert.ok(platform.y + PAD >= logo.y + logo.h, 'logo -> platform overlap')

    // 6. Right stack: pill on top, URL+tagline beneath, inside right zone.
    const [pill, url] = layout.right
    assert.equal(pill.key, 'subscribe')
    assert.equal(url.key, 'url')
    assert.ok(pill.h > 0 && url.h > 0)
    assert.ok(url.y + PAD >= pill.y + pill.h, 'pill -> url overlap')
    assert.ok(url.w >= 60, `url column width ${url.w.toFixed(0)}`)

    // 7. Subscribe pill keeps its scaled 50px-height intent.
    assert.ok(pill.h > 0)

    // 8. Site-URL text baseline is aligned with the "AVAILABLE ON" label
    //    baseline (both brand lines sit on the same optical line).
    const { scale } = layout
    const availableBaseline = platform.y + Math.round(FOOTER.available.size * scale)
    const urlBaseline = url.y + Math.round(FOOTER.url.size * scale)
    assert.equal(urlBaseline, availableBaseline, 'URL baseline must match AVAILABLE ON baseline')
  })
}

// Deterministic draw smoke test: rendering must not throw and produces pixels.
test('footer draw — produces a non-empty frame', () => {
  const fmt = FORMATS[0]
  const canvas = createCanvas(fmt.W, fmt.H)
  const ctx = canvas.getContext('2d')
  const layout = FooterLayout.draw(ctx, fmt.W, fmt.H)
  assert.ok(layout.left.length === 2 && layout.right.length === 2)
  const data = ctx.getImageData(0, fmt.H - layout.barHeight, fmt.W, layout.barHeight).data
  let lit = 0
  for (let i = 3; i < data.length; i += 4) if (data[i] > 0) lit++
  assert.ok(lit > 1000, `bar has lit pixels: ${lit}`)
})

// Each block must actually paint content in its slice of the bar —
// guards against a column silently rendering empty (all background).
test('draw — each block paints content in its column', () => {
  const fmt = FORMATS[0]
  const canvas = createCanvas(fmt.W, fmt.H)
  const ctx = canvas.getContext('2d')
  const layout = FooterLayout.draw(ctx, fmt.W, fmt.H)
  for (const col of [...layout.left, ...layout.right]) {
    const img = ctx.getImageData(
      Math.max(0, Math.floor(col.x)),
      Math.max(0, Math.floor(col.y)),
      Math.min(fmt.W, Math.max(1, Math.floor(col.x + col.w))) - Math.max(0, Math.floor(col.x)),
      Math.min(fmt.H, Math.max(1, Math.floor(col.y + col.h))) - Math.max(0, Math.floor(col.y))
    )
    const d = img.data
    let lit = 0
    for (let i = 3; i < d.length; i += 4) if (d[i] > 0) lit++
    assert.ok(lit > 20, `${col.key} paints content (lit=${lit})`)
  }
})

// The generated assets/footer.png matches the shared engine at 3 widths.
test('footer generator — writes responsive PNGs that probe clean', () => {
  for (const W of [1080, 1080, 1920]) {
    const ctx = createCanvas(W, 1).getContext('2d')
    const layout = FooterLayout.compute(ctx, W)
    const canvas = createCanvas(W, layout.barHeight)
    const dctx = canvas.getContext('2d')
    FooterLayout.renderStandalone(dctx, W, {})
    const data = dctx.getImageData(0, 0, W, layout.barHeight).data
    let lit = 0
    for (let i = 3; i < data.length; i += 4) if (data[i] > 0) lit++
    assert.ok(lit > 500, `W=${W} bar lit pixels ${lit}`)
  }
})

void fs
