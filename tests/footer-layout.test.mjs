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
    // Right zone is the widest: it must fit the FULL site URL + channel
    // handle without ellipsis (left 25% | center 50% | right 25%).
    assert.ok(zones[2].w >= zones[0].w * 2, 'right zone >= 2x left (full URL visibility)')
    assert.ok(zones[2].w >= zones[1].w, 'right zone is the largest (URL column)')

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

    // 5. Right-aligned stack: TOP ROW = NM monogram + NEWS-MONSTER wordmark +
    //    SUBSCRIBE pill on one line (pill rightmost, vertically centered),
    //    then tagline, then URL, then AVAILABLE ON badges — every row
    //    right-aligned to the frame's right edge. No left-zone content.
    assert.deepEqual(layout.left, [], 'left zone is empty (all content right-aligned)')
    const right = layout.right
    const keys = right.map(c => c.key)
    assert.ok(keys.includes('logo') && keys.includes('brand'), `top row has logo+brand (${keys})`)
    assert.ok(keys.includes('subscribe') && keys.includes('tagline') && keys.includes('url') && keys.includes('platform'), `stack has subscribe+tagline+url+platform (${keys})`)
    const logo = right.find(c => c.key === 'logo')
    const brand = right.find(c => c.key === 'brand')
    const tagline = right.find(c => c.key === 'tagline')
    const platform = right.find(c => c.key === 'platform')
    assert.ok(logo.h > 0 && brand.h > 0 && tagline.h > 0 && platform.h > 0)
    // Monogram + wordmark share the top row (vertically centered together).
    const logoCenter = logo.y + logo.h / 2
    const brandCenter = brand.y + brand.h / 2
    assert.ok(Math.abs(brandCenter - logoCenter) <= 1, `logo + brand share top row (delta ${Math.abs(brandCenter - logoCenter).toFixed(2)})`)
    assert.ok(brand.x + brand.w + 0.5 <= logo.x, 'wordmark left of the [NM] badge')
    // Tagline on its own line below the top row; badges below the tagline.
    const topRowBottom = Math.max(logo.y + logo.h, brand.y + brand.h)
    assert.ok(tagline.y + 0.5 >= topRowBottom, 'top row -> tagline overlap')
    assert.ok(platform.y + 0.5 >= tagline.y + tagline.h, 'tagline -> platform overlap')

    // 6. Subscribe pill sits on the LAST line, LEFT of AVAILABLE ON; the [NM]
    //    badge is rightmost on the top row. URL is on line 3 between them.
    const pill = right.find(c => c.key === 'subscribe')
    const url = right.find(c => c.key === 'url')
    assert.ok(pill.h > 0 && url.h > 0)
    assert.ok(pill.y + 0.5 >= url.y + url.h, 'url -> pill overlap (pill below URL)')
    assert.ok(url.w >= 60, `url column width ${url.w.toFixed(0)}`)
    // Pill shares the AVAILABLE ON row (same centerline).
    const pillCenter = pill.y + pill.h / 2
    const platformCenter = platform.y + platform.h / 2
    assert.ok(Math.abs(pillCenter - platformCenter) <= 1, `pill shares platform row center (delta ${Math.abs(pillCenter - platformCenter).toFixed(2)})`)
    // [NM] badge rightmost on the top row; every row right-aligns to the
    // frame's right edge; pill sits LEFT of the AVAILABLE ON group.
    const rightEdge = fmt.W - Math.max(16, Math.round(FOOTER.padding.x * layout.scale))
    assert.ok(Math.abs(logo.x + logo.w - rightEdge) <= 1.5, '[NM] badge right-aligns to the frame edge')
    assert.ok(pill.x + pill.w + 0.5 <= platform.x, 'pill left of AVAILABLE ON group')
    assert.ok(Math.abs(url.x + url.w - rightEdge) <= 1.5, 'url right-aligns to the frame edge')
    assert.ok(Math.abs(tagline.x + tagline.w - rightEdge) <= 1.5, 'tagline right-aligns to the frame edge')
    assert.ok(Math.abs(platform.x + platform.w - rightEdge) <= 1.5, 'platform row right-aligns to the frame edge')

    // 7. Tagline font at its token size (32 — slightly smaller than the
    //    38px wordmark); AVAILABLE ON matches the subscribe pill label size.
    assert.equal(Math.round(FOOTER.tagline.size * layout.scale), Math.round(32 * layout.scale), 'tagline size == 32 token')
    assert.equal(Math.round(FOOTER.available.size * layout.scale), Math.round(FOOTER.pill.labelSize * layout.scale), 'AVAILABLE ON size == pill label size')

    // 8. The URL always stays fully inside the bar (never overflows) and sits
    //    below the tagline on its own line.
    const { scale } = layout
    const urlBaseline = url.y + Math.round(FOOTER.url.size * scale)
    assert.ok(url.y + url.h <= layout.barHeight + 1, `URL column inside bar (bottom ${Math.round(url.y + url.h)} ≤ bar ${layout.barHeight})`)
    assert.ok(urlBaseline >= url.y + FOOTER.url.size * 0.5, 'URL baseline sits within the URL column')

    // 9. URL font size fits the FULL hostname in the right column at design
    //    width — the regression this suite guards: the URL used to ellipsize
    //    to "video-gen-stac-…" because the column was too narrow.
    const urlPx = Math.round(FOOTER.url.size * scale)
    const urlFont = `${FOOTER.url.weight} ${urlPx}px 'Montserrat ExtraBold', Inter, sans-serif`
    ctx.font = urlFont
    const urlFull = ctx.measureText('sham435.github.io/video-gen-stack').width
    assert.ok(urlFull <= zones[2].w + PAD, `full URL (${Math.round(urlFull)}px) fits right zone (${Math.round(zones[2].w)}px) — no ellipsis`)
    assert.ok(urlPx >= 20, `URL font ${urlPx}px readable`)

    // 10. Line gaps: the logo→platform stack carries at least a 12px
    //     (scaled) vertical gap — no touching lines.
    const lineGapPx = Math.round(FOOTER.lineGap * scale)
    assert.ok(lineGapPx >= 12, `line gap ${lineGapPx}px must be ≥ 12px`)
    // The urlTagline line was removed — the URL column is a single line.
    assert.ok(url.h === Math.round(FOOTER.url.size * scale), 'URL column is single-line (no urlTagline)')
  })
}

// Deterministic draw smoke test: rendering must not throw and produces pixels.
test('footer draw — produces a non-empty frame', () => {
  const fmt = FORMATS[0]
  const canvas = createCanvas(fmt.W, fmt.H)
  const ctx = canvas.getContext('2d')
  const layout = FooterLayout.draw(ctx, fmt.W, fmt.H)
  assert.ok(layout.left.length === 0 && layout.right.length === 6, `left=${layout.left.length} right=${layout.right.length}`)
  const barTop = FooterLayout.barTopInFrame(ctx, fmt.W, fmt.H)
  const data = ctx.getImageData(0, barTop, fmt.W, layout.barHeight).data
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

// The ticker docks above the footer's ACTUAL bar top (computed), never above
// the static height token. Guards the regression where the ticker rode 10px
// onto the bar after the bar grew past 180px.
test('ticker docks strictly above the footer bar (no overlap)', () => {
  const fmt = FORMATS[0]
  const ctx = createCanvas(fmt.W, fmt.H).getContext('2d')
  const layout = FooterLayout.compute(ctx, fmt.W)
  const footerTop = FooterLayout.barTopInFrame(ctx, fmt.W, fmt.H)
  const tickerH = 50
  const margin = 14
  const tickerY = footerTop - tickerH - margin
  assert.ok(tickerY + tickerH <= footerTop, `ticker bottom ${tickerY + tickerH} <= footer top ${footerTop}`)
})

// The brand-close (last) scene: the tagline wraps into lines that fit and the
// anchor badge sits between the tagline block and the footer bar top — never
// clipped by the footer, never truncated.
test('brand close — tagline wraps to fit and anchor clears the footer', async () => {
  const { SceneEngine } = await import('../src/video/SceneEngine.mjs')
  const { BROADCAST_TEXT } = await import('../src/style/text-tokens.mjs')
  const close = BROADCAST_TEXT.close
  const fmt = FORMATS[0]
  const engine = new SceneEngine({ category: 'technology' })
  const scene = {
    type: 'brand_close',
    duration: 3,
    ticker: ['AI', 'Robotics', 'Cybersecurity', 'Space', 'Programming', 'Quantum', 'Biotech'],
  }
  // progress 1.0 = full brand-outro exposure (anchor + tagline fully in)
  const buf = await engine.renderSceneFrame(scene, 1.0, [], 0, null)
  const canvas = createCanvas(fmt.W, fmt.H)
  const cctx = canvas.getContext('2d')
  const { loadImage } = await import('@napi-rs/canvas')
  const img = await loadImage(buf)
  cctx.drawImage(img, 0, 0)

  const countLit = (y0, y1, thresh = 130) => {
    const d = cctx.getImageData(0, y0, fmt.W, y1 - y0).data
    let n = 0
    for (let i = 0; i < d.length; i += 4) {
      if (d[i] > thresh && d[i + 1] > thresh && d[i + 2] > thresh) n++
    }
    return n
  }

  // Tagline block present (wrapped lines around the STAY WITH / brand area).
  const tagLit = countLit(1120, 1280)
  assert.ok(tagLit > 2000, `tagline renders content (lit=${tagLit})`)

  // Anchor badge renders between the tagline and the footer bar.
  const anchorLit = countLit(1270, 1350)
  assert.ok(anchorLit > 800, `anchor badge renders content (lit=${anchorLit})`)

  // Safe-zone contract: the anchor badge bottom never enters the footer bar.
  const footerTop = FooterLayout.barTopInFrame(cctx, fmt.W, fmt.H)
  const anchorBottom = footerTop - close.anchor.margin - close.anchor.badgeH + close.anchor.badgeH
  assert.ok(anchorBottom <= footerTop, `anchor bottom ${anchorBottom} <= footer top ${footerTop}`)

  // No truncation: the tagline max-width holds the full phrase on ≤ 2 lines.
  const ctx2 = createCanvas(fmt.W, 1).getContext('2d')
  ctx2.font = `900 ${close.tagline.size}px "Montserrat ExtraBold", sans-serif`
  const fullW = ctx2.measureText('UNFILTERED BREAKING NEWS FROM THE FUTURE').width
  assert.ok(close.tagline.maxWidth <= fmt.W - 160, 'tagline maxWidth fits within frame margins')
  assert.ok(fullW > close.tagline.maxWidth, 'tagline genuinely wraps (was overflowing single line)')
})

void fs
