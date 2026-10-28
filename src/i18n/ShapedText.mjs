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
import { Path2D, createCanvas } from '@napi-rs/canvas'

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

// Symbol-only strings (arrows, geometric shapes, dingbats, emoji, whitespace,
// ASCII punctuation) have NO script text: the vendored Noto faces lack all of
// them, while the canvas's native font stack resolves them (that is exactly
// how the English path has always rendered "▶ · ⚡"). Such strings must draw
// native instead of shaping .notdef tofu.
// ── Symbol-only native detour ────────────────────────────────────────────────
// Strings with NO letter and NO digit anywhere (arrows ▶ ›, geometric ● ⬤,
// dingbats, emoji, bare punctuation/spaces) cannot be shaped meaningfully:
// the vendored Noto faces have NONE of the symbols (font-coverage probe
// verified), while the canvas's native font stack resolves them exactly the
// way the English path has always drawn them. Such strings take a
// transparent native detour inside drawShaped/measureShaped — same opts
// semantics (align/baseline/stroke/fill), same returned advance. Text that
// contains ANY letter or digit keeps the shaped path (per-glyph metrics
// stay authoritative for wrapping); symbols embedded in such text ride the
// run they attach to (e.g. 'REPLAY ▶ NEWS-MONSTER': ▶ joins the REPLAY
// Latin run → Montserrat, which carries ▶).
const TEXTISH_RE = /[A-Za-z0-9\u00C0-\u024F\u1E00-\u1EFF\u0370-\u03FF\u0400-\u04FF\u0600-\u06FF\u0900-\u097F\u0B80-\u0BFF\u0D80-\u0DFF\u3040-\u30FF\u4E00-\u9FFF\uAC00-\uD7AF]/

export function isSymbolOnly(text) {
  return !TEXTISH_RE.test(String(text))
}

// Family stack mirrors the EN broadcast path (SceneEngine registers
// 'Montserrat ExtraBold' into @napi-rs/canvas GlobalFonts at startup; the
// system/Inter fallthrough covers anything Montserrat lacks).
const NATIVE_SYMBOL_FONT = "'Montserrat ExtraBold', Inter, sans-serif"

let nativeCtx = null // lazy 1×1 measure canvas (no render-loop contention)
function nativeMeasureCtx() {
  if (!nativeCtx) nativeCtx = createCanvas(16, 16).getContext('2d')
  return nativeCtx
}

/** A non-English pack is active AND this string contains non-Latin script. */
export function needsShaping(text) {
  return !!activePack && !isLatinOnly(text) && !isSymbolOnly(text)
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

// ── Script-run splitting (mixed-script localized text) ─────────────────────
// Some Noto script faces ship WITHOUT Latin letters (Noto Sans Tamil has
// digits + basic punctuation only — verified by preflight canary). A Tamil
// headline containing "AI" or an English brand word would otherwise render
// .notdef tofu for the Latin part. When the caller declares a companion
// Latin font (pack.latinFontFiles), the string is split into runs:
//   pack-script chars → the pack (Noto) font
//   Latin letters     → the companion Latin font
//   everything else   → NEUTRAL: attaches to the current run (digits/punct/
//                       spaces exist in both fonts; ZWJ/ZWNJ stay inside the
//                       script cluster they belong to)
const PACK_SCRIPT_RE = {
  ta: /[\u0B80-\u0BFF]/u,
  si: /[\u0D80-\u0DFF]/u,
}
const LATIN_LETTER_RE = /[A-Za-z\u00C0-\u024F\u1E00-\u1EFF]/u

/** Split text into script runs only when a companion Latin font is declared.
 *  Returns [{text, fontFile, weight}] or null (single-font shaping). */
function splitRuns(text, fontFile, latinFontFiles) {
  if (!latinFontFiles) return null
  const packRe = /Tamil/i.test(JSON.stringify(fontFile)) ? PACK_SCRIPT_RE.ta
    : /Sinhala/i.test(JSON.stringify(fontFile)) ? PACK_SCRIPT_RE.si
    : null
  if (!packRe) return null
  const runs = []
  let cur = 'pack' // leading neutrals attach to the pack run
  for (const ch of text) {
    let c
    if (packRe.test(ch)) c = 'pack'
    else if (LATIN_LETTER_RE.test(ch)) c = 'latin'
    else c = cur
    const last = runs[runs.length - 1]
    if (!last || last.cls !== c) runs.push({ cls: c, text: ch })
    else last.text += ch
    cur = c
  }
  return runs.map(r => ({ text: r.text, fontFile: r.cls === 'latin' ? latinFontFiles : fontFile }))
}

/** Core single-font shaping against one hb/ot font record. */
async function shapeOne(text, rec, size) {
  const { Buffer, shape: hbShape } = hb
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
  return { glyphs, advancePx: advance, scale, hasNotdef }
}

/**
 * Shape a string into glyph placement data. When the caller declares a
 * companion Latin font (`latinFontFiles` — e.g. pack.latinFontFiles), text is
 * split into script runs (Latin letters drawn from the companion font) so
 * mixed-script strings never fall back to .notdef tofu.
 *
 * Returns { glyphs:[{gid,x,y,rec}], width(scalePx), hasNotdef } where `rec`
 * is the font record each glyph was shaped against (drawShaped uses it to
 * fetch outlines per font). Negative x (pre-base marks) is EXPECTED — that
 * is correct shaping.
 */
export async function shapeText(text, { fontFile, size, weight, latinFontFiles = null }) {
  const runs = (splitRuns(text, fontFile, latinFontFiles) || [{ text, fontFile }]).map((r) => ({ ...r, weight: r.weight ?? weight }))
  const cacheKey = `${runs.map((r) => resolveFontFile(r.fontFile, r.weight)).join('|')}|${size}|${text}`
  let layout = shapeCache.get(cacheKey)
  if (layout) return { ...layout, width: layout.advancePx }
  await ensureShaper()

  let x = 0
  let advance = 0
  let hasNotdef = false
  const glyphs = []
  for (const run of runs) {
    const runRec = await getFontRec(run.fontFile, run.weight)
    const shaped = await shapeOne(run.text, runRec, size)
    for (const g of shaped.glyphs) glyphs.push({ gid: g.gid, x: x + g.x, y: g.y, rec: runRec })
    x += shaped.advancePx
    advance += shaped.advancePx
    hasNotdef = hasNotdef || shaped.hasNotdef
  }
  const firstRec = await getFontRec(runs[0].fontFile, runs[0].weight)
  layout = { glyphs, advancePx: advance, scale: size / firstRec.upem, hasNotdef }
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

  // SYMBOL-ONLY native detour (runs BEFORE any shaping): pure symbol strings
  // (▶ › ● ⚡ emoji, bare punctuation/spaces) must never reach hb shaping —
  // the vendored Noto faces notdef them (the run-2 SI render proved it with
  // 3 tofu warnings for the REPLAY banner's ▶). Native canvas draw, same
  // align/baseline/stroke/fill semantics as the shaped path.
  if (isSymbolOnly(text)) {
    ctx.save()
    ctx.font = `${weight} ${size}px ${NATIVE_SYMBOL_FONT}`
    ctx.textAlign = align
    ctx.textBaseline = baseline === 'top' ? 'top' : (baseline === 'alphabetic' ? 'alphabetic' : 'middle')
    if (stroke) {
      ctx.strokeStyle = stroke.style
      ctx.lineWidth = stroke.width
      ctx.lineJoin = 'round'
      ctx.miterLimit = 2
      ctx.strokeText(text, x, y)
    }
    ctx.fillStyle = fillStyle
    ctx.fillText(text, x, y)
    const nativeWidth = ctx.measureText(text).width
    ctx.restore()
    return nativeWidth
  }

  // Companion Latin font: explicit opt wins; otherwise the ACTIVE pack lends
  // its latinFontFiles when the caller passed the pack's own font array
  // (every existing call site passes pack.fontFiles → free mixed-script fix).
  const pack = getRenderLanguage()
  const latinFontFiles = opts.latinFontFiles !== undefined
    ? opts.latinFontFiles
    : (pack && fontFile === pack.fontFiles ? pack.latinFontFiles || null : null)
  const layout = await shapeText(text, { fontFile, size, weight, latinFontFiles })
  if (layout.hasNotdef) {
    // HARD STOP (no-tofu guarantee): glyphs the vendored fonts cannot draw
    // would appear as boxes in the published video. The preflight/content
    // gates block earlier with diagnostics; THIS is the last line of
    // defense — refuse to draw instead of shipping boxes.
    throw new Error(`SHAPED_TOFU: glyphs missing for "${text.slice(0, 24)}…" — fontFile=${resolveFontFile(fontFile, weight)} cannot cover this string; refusing to render tofu`)
  }

  let ox = x
  if (align === 'center') ox = x - layout.advancePx / 2
  else if (align === 'right') ox = x - layout.advancePx

  const rec = await getFontRec(fontFile, weight)
  ctx.save()
  if (stroke) {
    ctx.strokeStyle = stroke.style
    ctx.lineWidth = stroke.width
    ctx.lineJoin = 'round'
    ctx.miterLimit = 2
  }
  for (const g of layout.glyphs) {
    // Each glyph carries the font record it was shaped against (mixed-script
    // runs): position vertically by THAT font's metrics so the Latin and
    // pack scripts share one coherent line.
    const gRec = g.rec || rec
    const gScale = gRec === rec ? layout.scale : size / gRec.upem
    const gOy = baseline === 'middle'
      ? y + ((gRec.asc - gRec.desc) / 2) * gScale
      : (baseline === 'top' ? y + gRec.asc * gScale : y)
    const otGlyph = gRec.otFont.glyphs.get(g.gid)
    if (!otGlyph || gidIsBlank(otGlyph)) continue
    // SCALE FIDELITY (spacing guarantee): getPath's fontSize arg MUST equal the
    // requested size. opentype.js defaults it to 72, which drew outlines at
    // 72/upem while HarfBuzz advances scale at size/upem — glyphs drew 1.24×
    // their reserved slot at caption sizes (letters merge → meaning destroyed)
    // and shrank below their slots at headline sizes (scattered words).
    const p = otGlyph.getPath(g.x + ox + letterSpacing, gOy - g.y, size)
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

export async function measureShaped(text, { fontFile, size, weight, letterSpacing = 0, latinFontFiles }) {
  // Symbol-only: native measure through the SAME synthesized font family as
  // drawShaped's detour (identical width basis; wrap math stays consistent).
  if (isSymbolOnly(text)) {
    const m = nativeMeasureCtx()
    m.font = `${weight} ${size}px ${NATIVE_SYMBOL_FONT}`
    return m.measureText(text).width + letterSpacing
  }
  const pack = getRenderLanguage()
  const lat = latinFontFiles !== undefined
    ? latinFontFiles
    : (pack && fontFile === pack.fontFiles ? pack.latinFontFiles || null : null)
  const layout = await shapeText(text, { fontFile, size, weight, latinFontFiles: lat })
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
