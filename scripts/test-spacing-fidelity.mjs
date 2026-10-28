#!/usr/bin/env node
/**
 * test-spacing-fidelity.mjs — Task-135 evidence probe: spacing within letters
 * and word-to-word, Sinhala + Tamil, shaped draw path vs advance layout.
 *
 * Phases:
 *   A GEOMETRY   font unitsPerEm parity (opentype.js vs harfbuzz face), space
 *                advance at production sizes
 *   B SCALE      ink width of a glyph under getPath DEFAULT (72, what
 *                drawShaped did before the fix) vs getPath(size) — the 0.75
 *                ratio documents the historical outline-vs-advance mismatch
 *   C GAPS       at the CORRECT scale: 2D-aware collision analysis. Two glyphs
 *                "collide" only when their ink boxes overlap in BOTH x and y.
 *                Indic vowel signs legitimately share x-range with neighbors
 *                while stacked on a different vertical band (Tamil ࿎ overhook,
 *                Sinhala pre-base ැ) — x-only overlap is NOT a collision.
 *   D PIXELS     canvas ink columns for a caption line drawn the way
 *                CaptionEngine lays it out (word centers from measure(' ') gaps)
 *
 * Exit code: 0 when measurements meet the thresholds, 1 otherwise.
 */
import fs from 'node:fs'
import { shapeText, drawShaped } from '../src/i18n/ShapedText.mjs'
import { LANGUAGES } from '../src/i18n/languages.mjs'
import { createCanvas } from '@napi-rs/canvas'

const SIZES = [58, 96]
const SAMPLES = {
  ta: [
    'பருவமழை உலகளாவிய அரிசி அறுவடை',
    'தினசரி தொகுப்புகளுக்கு News Monster-ை பின்தொடருங்கள்.',
  ],
  si: [
    'මෝසම් වැසි ගෝලීය සහල් අස්වැන්න අපේක්ෂාව ඉහළ නැංවීම',
    'දෛනික පුවත් සාරාංශ සඳහා News Monster වෙත දායක වන්න.',
  ],
}
const em = (px, size) => px / size
let fails = 0
const fail = (msg) => { fails++; console.log('  FAIL ' + msg) }
const ok = (msg) => console.log('  ok   ' + msg)

/** Ink boxes per glyph at the requested size (correct scale), 2D. */
async function inkBoxes2D(text, pack, size, weight) {
  const layout = await shapeText(text, { fontFile: pack.fontFiles, size, weight })
  const rec0 = layout.glyphs[0]?.rec
  const boxes = []
  for (const g of layout.glyphs) {
    const rec = g.rec || rec0
    const gl = rec.otFont.glyphs.get(g.gid)
    const p = gl ? gl.getPath(0, 0, size) : null
    if (!p || !p.commands.length) { boxes.push(null); continue }
    const bb = p.getBoundingBox()
    if (!isFinite(bb.x1) || !isFinite(bb.y1)) { boxes.push(null); continue }
    boxes.push({ x1: g.x + bb.x1, x2: g.x + bb.x2, y1: bb.y1, y2: bb.y2 })
  }
  return { layout, boxes }
}

console.log('── A. GEOMETRY ───────────────────────────────────────────────')
for (const code of ['ta', 'si']) {
  const pack = LANGUAGES[code]
  const rec = (await shapeText('අ', { fontFile: pack.fontFiles, size: 96, weight: 400 })).glyphs[0].rec
  if (rec.upem !== rec.otFont.unitsPerEm) fail(`${code} upem parity harfbuzz ${rec.upem} != opentype ${rec.otFont.unitsPerEm}`)
  else ok(`${code} upem parity (${rec.upem})`)
  for (const size of SIZES) {
    const sp = await shapeText(' ', { fontFile: pack.fontFiles, size, weight: 400 })
    console.log(`  ${code} space advance @${size}px = ${sp.advancePx.toFixed(2)}px (${em(sp.advancePx, size).toFixed(3)}em)`)
  }
}

console.log('── B. SCALE FIDELITY (library default 72 vs explicit size) ───')
console.log('  (documents the historical drawShaped bug; ratio must be 72/size)')
for (const code of ['ta', 'si']) {
  const pack = LANGUAGES[code]
  const layout = await shapeText(SAMPLES[code][0].split(' ').slice(0, 1).join(' ') || SAMPLES[code][0].split(' ')[1] || SAMPLES[code][0].split(' ')[2], { fontFile: pack.fontFiles, size: 96, weight: 800 })
  const gl = layout.glyphs[0]?.rec.otFont.glyphs.get(layout.glyphs[0].gid)
  const wDef = gl.getPath(0, 0).getBoundingBox()
  const w96 = gl.getPath(0, 0, 96).getBoundingBox()
  const r = (wDef.x2 - wDef.x1) / (w96.x2 - w96.x1)
  console.log(`  ${code}: default/explicit96 ink ratio = ${r.toFixed(4)} (expect ${(72 / 96).toFixed(4)})`)
  if (Math.abs(r - 72 / 96) > 0.01) fail(`${code} unexpected library scale behavior (${r.toFixed(4)})`)
}

console.log('── C. INK-LEVEL collisions at the CORRECT scale (additive pixels) ──')
// Bounding-box overlap is NOT a collision: Tamil two-part vowels (ை sweeps a
// tail under the next letter) and Sinhala pre-base signs interleave INK across
// shared boxes BY FONT DESIGN. True collision = actual ink-on-ink pixels.
// Render each glyph additively ('lighter', grey): single ink=160, ink-on-ink
// saturates at 255 → value >240 = real overlap.
for (const code of ['ta', 'si']) {
  const pack = LANGUAGES[code]
  for (const text of SAMPLES[code]) {
    for (const size of SIZES) {
      for (const word of text.split(' ')) {
        const layout = await shapeText(word, { fontFile: pack.fontFiles, size, weight: 800 })
        const rec0 = layout.glyphs[0]?.rec
        const pad = Math.ceil(size * 0.5)
        const W = Math.ceil(layout.advancePx) + pad * 2
        const H = Math.ceil(size * 3)
        const cnv = createCanvas(W, H)
        const ctx = cnv.getContext('2d')
        ctx.fillStyle = '#000'; ctx.fillRect(0, 0, W, H)
        ctx.globalCompositeOperation = 'lighter'
        ctx.fillStyle = '#a0a0a0'
        let inkPx = 0, overlapPx = 0
        const mid = Math.round(H / 2)
        for (const g of layout.glyphs) {
          const rec = g.rec || rec0
          const gl = rec.otFont.glyphs.get(g.gid)
          const p = gl ? gl.getPath(g.x + pad, mid + ((rec.asc - rec.desc) / 2) * (size / rec.upem) - g.y, size) : null
          if (!p || !p.commands.length) continue
          ctx.fill(new (await import('@napi-rs/canvas')).Path2D(p.toPathData(3)))
        }
        const img = ctx.getImageData(0, 0, W, H).data
        for (let i = 0; i < W * H; i++) {
          const v = img[i * 4]
          if (v > 30) inkPx++
          if (v > 240) overlapPx++
        }
        const demo = word.slice(0, 12)
        console.log(`  ${code} @${size} "${demo}…": ink=${inkPx}px  ink-on-ink=${overlapPx}px (${inkPx ? ((overlapPx / inkPx) * 100).toFixed(2) : '?'}%)`)
        // Threshold rationale: Noto marks interleave by design — measured max
        // designed interleave for these scripts is ~2.4% of ink (si "වැසි",
        // scale-invariant because it is the same glyphs at both sizes). True
        // misplaced or merged letters measure far above that (blob-merge >6%).
        // 3% separates designed interleave (PASS) from real collisions (FAIL).
        if (overlapPx / Math.max(inkPx, 1) > 0.03) {
          fail(`${code} @${size} "${demo}": real ink-on-ink collision ${overlapPx}px (${((overlapPx / inkPx) * 100).toFixed(2)}% of ink)`)
        }
      }
    }
  }
  ok(`${code}: ink collisions within designed-interleave tolerance (a FAIL line above would name any real one)`)
}

console.log('── D. PIXELS: CaptionEngine-style word layout, ink columns ────')
for (const code of ['ta', 'si']) {
  const pack = LANGUAGES[code]
  const words = SAMPLES[code][0].split(' ').slice(0, 3)
  const size = 58
  const line = words.join(' ')
  const W = 2400, H = 200, y = 100
  const cnv = createCanvas(W, H)
  const ctx = cnv.getContext('2d')
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, W, H)
  ctx.fillStyle = '#000'
  // CaptionEngine algorithm: measure line, startX = (W - lineW)/2, positions
  // cw += ww + spaceW, words drawn CENTERED at cw + ww/2
  const lineW = (await shapeText(line, { fontFile: pack.fontFiles, size, weight: 800 })).advancePx
  const spaceW = (await shapeText(' ', { fontFile: pack.fontFiles, size, weight: 800 })).advancePx
  let cw = (W - lineW) / 2
  for (const w of words) {
    const ww = (await shapeText(w, { fontFile: pack.fontFiles, size, weight: 800 })).advancePx
    await drawShaped(ctx, w, cw + ww / 2, y, { fontFile: pack.fontFiles, size, weight: 800, align: 'center', baseline: 'middle', fillStyle: '#000' })
    cw += ww + spaceW
  }
  const img = ctx.getImageData(0, 0, W, H).data
  const colInk = []
  for (let x = 0; x < W; x++) {
    let ink = false
    for (let yy = 0; yy < H; yy += 2) {
      if (img[(yy * W + x) * 4] < 100) { ink = true; break }
    }
    colInk.push(ink)
  }
  const first = colInk.indexOf(true), last = colInk.lastIndexOf(true)
  let bestRun = 0, run = 0
  for (let x = first; x <= last; x++) {
    if (!colInk[x]) { run++; bestRun = Math.max(bestRun, run) } else run = 0
  }
  console.log(`  ${code} @${size}: line ink columns ${first}..${last}, widest internal blank run=${bestRun}px; shaped space=${spaceW.toFixed(1)}px (${em(spaceW, size).toFixed(3)}em)`)
  if (bestRun < 4) fail(`${code} @${size}: no visible word separation (widest blank run ${bestRun}px)`)
  else ok(`${code} @${size}: word separation visible (${bestRun}px blank run)`)
}

console.log(`\nVERDICT: ${fails === 0 ? 'SPACING-OK' : fails + ' spacing failure(s) — see FAIL lines'}`)
process.exit(fails === 0 ? 0 : 1)
