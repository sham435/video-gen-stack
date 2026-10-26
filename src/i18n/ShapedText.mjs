/**
 * ShapedText — correct complex-script text rendering for Tamil/Sinhala.
 *
 * WHY THIS EXISTS: @napi-rs/canvas resolves fonts but does not run HarfBuzz
 * shaping, so Indic scripts render with vowel signs/conjuncts on the WRONG
 * side (verified by ink-offset measurement: Sinhala කෙ drew its mark AFTER
 * ක instead of before it; Tamil தே same failure). Garbled on-screen text is
 * a broadcast-quality failure — this module restores renderer correctness.
 *
 * HOW: shape strings with harfbuzzjs (wasm, offline, deterministic) and draw
 * the resulting glyph outlines via opentype.js paths on the same canvas ctx.
 * English keeps the native fillText path — zero regression for the primary
 * language (this module is a strict no-op unless a non-English pack is set).
 *
 * Draw sites call drawLocalized/measureLocalized instead of fillText/
 * measureText. The active pack is set per-render by the engine (single-
 * threaded frame loops → render-scoped global is race-free).
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { Path2D } from '@napi-rs/canvas'

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')

// Latin ranges: anything outside these needs shaping when a script pack is active
const LATIN_ONLY = /^[\x00-\x7F\u2000-\u206F]*$/

let hb = null            // harfbuzzjs namespace
let ot = null            // opentype.js namespace
let initPromise = null

/** fontFile(boolean bold variant resolved by caller) → {hbFont, otFont, upem, asc, desc, scale} */
const fontCache = new Map()
/** `${fontKey}|${text}` → shaped layout (per-render repeat strings stay cheap) */
const shapeCache = new Map()

let activePack = null    // LanguagePack or null

export function setRenderLanguage(pack) {
  activePack = pack && pack.code !== 'en' ? pack : null
  if (activePack) ensureShaper() // warm init eagerly, failures surface at render start
}

export function getRenderLanguage() {
  return activePack
}

export function isLatinOnly(text) {
  return LATIN_ONLY.test(text)
}

/** A non-English pack is active AND this string contains non-Latin script. */
export function needsShaping(text) {
  return !!activePack && !isLatinOnly(text)
}

export async function ensureShaper() {
  if (hb && ot) return true
  if (!initPromise) {
    initPromise = (async () => {
      hb = await import('harfbuzzjs')
      ot = (await import('opentype.js')).default
    })()
  }
  await initPromise
  return true
}

async function getFontRec(fontFile, weight) {
  const chosen = resolveFontFile(fontFile, weight)
  let rec = fontCache.get(chosen)
  if (rec) return rec
  await ensureShaper()
  const abs = path.isAbsolute(chosen) ? chosen : path.join(REPO_ROOT, chosen)
  if (!fs.existsSync(abs)) throw new Error(`SHAPED_FONT_MISSING: ${abs} — vendor the Noto font file (see src/i18n/languages.mjs)`)
  const bytes = fs.readFileSync(abs)
  const ab = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)
  const hbFace = new hb.Face(new hb.Blob(new Uint8Array(bytes)))
  const hbFont = new hb.Font(hbFace)
  hbFont.scale = [hbFace.upem, hbFace.upem]
  const otFont = ot.parse(ab)
  rec = {
    hbFont,
    otFont,
    upem: hbFace.upem,
    asc: otFont.ascender,
    desc: otFont.descender, // typically negative
  }
  fontCache.set(chosen, rec)
  return rec
}

function resolveFontFile(fontFile, weight) {
  if (Array.isArray(fontFile)) {
    const pickBold = (weight ?? 400) >= 600
    const withHint = fontFile.find((f) => /Bold\./.test(f))
    const plain = fontFile.find((f) => !/Bold\./.test(f))
    return pickBold && withHint ? withHint : (plain || fontFile[0])
  }
  return fontFile
}

/**
 * Shape a string into glyph placement data.
 * Returns { glyphs:[{gid,x,y}], width(scalePx), hasNotdef }
 * Negative x (pre-base marks) is EXPECTED — that is correct shaping.
 */
export async function shapeText(text, { fontFile, size, weight }) {
  const rec = await getFontRec(fontFile, weight)
  const cacheKey = `${resolveFontFile(fontFile, weight)}|${size}|${text}`
  let layout = shapeCache.get(cacheKey)
  if (layout) return { ...layout, width: layout.advancePx }
  const { Font, Buffer, shape: hbShape } = hb
  const buf = new Buffer()
  buf.addText(text)
  buf.guessSegmentProperties()
  hbShape(rec.hbFont, buf)
  const infos = buf.getGlyphInfos()
  const pos = buf.getGlyphPositions()
  const scale = size / rec.upem
  let x = 0
  let advance = 0
  let hasNotdef = false
  const glyphs = []
  for (let i = 0; i < infos.length; i++) {
    const gid = infos[i].codepoint // post-shaping: codepoint IS the glyph id
    if (gid === 0 && !/\s/.test(text[infos[i].cluster] || ' ')) hasNotdef = true
    const dx = pos[i].xOffset * scale
    const dy = pos[i].yOffset * scale
    glyphs.push({ gid, x: x + dx, y: dy })
    x += pos[i].xAdvance * scale
    advance += pos[i].xAdvance * scale
  }
  layout = { glyphs, advancePx: advance, scale, hasNotdef }
  shapeCache.set(cacheKey, layout)
  if (shapeCache.size > 2000) shapeCache.clear() // frame-loop safety valve
  return { ...layout, width: advancePxOf(layout) }
}

function advancePxOf(layout) {
  return layout.advancePx
}

/**
 * Draw text with correct shaping. Mirrors canvas fillText semantics:
 *  - opts.align: 'left' | 'center' | 'right' (x is the anchor)
 *  - opts.baseline: 'middle' (canvas default used by call sites) | 'alphabetic'
 *  - opts.stroke: { style, width } drawn before fill (caption halo pattern)
 *  - opts.fillStyle / opts.color set on ctx by caller beforehand? — we accept
 *    explicit colors to keep call sites one-line.
 */
export async function drawShaped(ctx, text, x, y, opts = {}) {
  const {
    fontFile,
    size = 24,
    weight = 400,
    align = 'left',
    baseline = 'middle',
    fillStyle = ctx.fillStyle,
    stroke = null, // { style, width }
    letterSpacing = 0,
  } = opts

  const layout = await shapeText(text, { fontFile, size, weight })
  if (layout.hasNotdef) {
    console.warn(`[SHAPED] tofu glyphs in "${text.slice(0, 24)}…" — font missing coverage; fontFile=${resolveFontFile(fontFile, weight)}`)
  }

  let ox = x
  if (align === 'center') ox = x - layout.advancePx / 2
  else if (align === 'right') ox = x - layout.advancePx

  const rec = await getFontRec(fontFile, weight)
  // canvas 'middle' baseline centers the em square: drawOffset = (asc - desc)/2;
  // canvas 'top' anchors the em-box top: drawOffset = ascent.
  const oy = baseline === 'middle'
    ? y + ((rec.asc - rec.desc) / 2) * layout.scale
    : (baseline === 'top' ? y + rec.asc * layout.scale : y)

  ctx.save()
  if (stroke) {
    ctx.strokeStyle = stroke.style
    ctx.lineWidth = stroke.width
    ctx.lineJoin = 'round'
    ctx.miterLimit = 2
  }
  for (const g of layout.glyphs) {
    const otGlyph = rec.otFont.glyphs.get(g.gid)
    if (!otGlyph || gidIsBlank(otGlyph)) continue
    const p = otGlyph.getPath(g.x + ox + letterSpacing, oy - g.y)
    const path = new Path2D(p.toPathData(3))
    if (stroke) ctx.stroke(path)
    ctx.fillStyle = fillStyle
    ctx.fill(path)
  }
  ctx.restore()
  return layout.advancePx
}

function gidIsBlank(otGlyph) {
  // opentype.js exposes advanceWidth; a zero-path blank is fine to skip
  return otGlyph.path && otGlyph.path.commands && otGlyph.path.commands.length === 0 && otGlyph.advanceWidth === 0
}

export async function measureShaped(text, { fontFile, size, weight, letterSpacing = 0 }) {
  const layout = await shapeText(text, { fontFile, size, weight })
  return layout.advancePx + letterSpacing
}

/**
 * DROP-IN draw used by every localized call site:
 *  - No active pack (English) → native fillText/strokeText, EXACTLY as before.
 *  - Non-Latin content + active pack → shaped glyph rendering.
 * Returns the advance width (px) for callers that need measurement.
 */
export async function drawLocalized(ctx, text, x, y, opts = {}) {
  if (!needsShaping(text)) {
    if (opts.stroke) {
      ctx.strokeStyle = opts.stroke.style
      ctx.lineWidth = opts.stroke.width
      ctx.lineJoin = 'round'
      ctx.strokeText(text, x, y)
    }
    ctx.fillStyle = opts.fillStyle || ctx.fillStyle
    ctx.fillText(text, x, y)
    return ctx.measureText(text).width
  }
  return drawShaped(ctx, text, x, y, opts)
}

/** measureLocalized: shaped width for script text, native measureText otherwise. */
export async function measureLocalized(ctx, text, opts = {}) {
  if (!needsShaping(text)) return ctx.measureText(text).width
  return measureShaped(text, opts)
}

/**
 * Wrap text into lines that fit maxWidth (shaped measure), greedy on spaces.
 * Returns array of lines. Used by headline/caption layout code paths.
 */
export async function wrapLocalized(ctx, text, maxWidth, opts = {}) {
  const words = String(text).split(/\s+/).filter(Boolean)
  const lines = []
  let line = ''
  for (const w of words) {
    const candidate = line ? line + ' ' + w : w
    const width = await measureLocalized(ctx, candidate, opts)
    if (width <= maxWidth || !line) line = candidate
    else { lines.push(line); line = w }
  }
  if (line) lines.push(line)
  return lines
}
