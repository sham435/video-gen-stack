/**
 * tests/unicode-shaping.test.mjs — Unicode + layout correctness for the
 * tri-lingual shaping pipeline (task: Tamil/Sinhala broadcast quality).
 *
 * What these tests pin down (each traced to a real defect or a HarfBuzz
 * contract the on-screen output depends on):
 *  - Zero .notdef (tofu) for script canaries incl. digits + punctuation
 *  - .notdef DETECTION actually fires (Malayalam 'അ' against a Tamil font,
 *    Latin letters against a font that ships without them)
 *  - Mixed-script strings ("AI" inside a Tamil headline) route Latin runs to
 *    the companion Latin font when the pack declares one (Noto Sans Tamil
 *    ships WITHOUT Latin letters — preflight-verified)
 *  - Unicode normalization invariance: NFC == NFD shaped advances
 *  - Conjunct compaction: shaped 'க்ஷ' is tighter than its parts
 *  - Whitespace preservation: shaped advances never collapse spaces
 *  - wrapLocalized greedy bounds: every wrapped line fits maxWidth
 *  - headless FontMetrics approximation stays within a sane ratio of REAL
 *    shaped widths (layout authority never wildly off the glyph reality)
 *  - FontPreflight: pass / missing-file / tofu / canvas-registration
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { createCanvas } from '@napi-rs/canvas'

import { LANGUAGES, parseLangSpec } from '../src/i18n/languages.mjs'
import {
  setRenderLanguage,
  getRenderLanguage,
  shapeText,
  drawShaped,
  measureShaped,
  measureLocalized,
  wrapLocalized,
  needsShaping,
  isSymbolOnly,
} from '../src/i18n/ShapedText.mjs'
import { assertLanguageFonts, languageFontReport } from '../src/i18n/FontPreflight.mjs'
import { DesignSystemFontProbe } from '../src/i18n/FontProbe.mjs'
import { FontMetrics } from '../src/layout/FontMetrics.mjs'

const TA = LANGUAGES.ta
const SI = LANGUAGES.si

function canvasCtx() {
  const cv = createCanvas(1600, 400)
  return { cv, ctx: cv.getContext('2d') }
}

// ── preflight: the startup gate ─────────────────────────────────────────────

test('unicode: font preflight PASSES for en (trivial), ta and si (fonts vendored, canaries shaped, canvas registration)', async t => {
  t.after(() => setRenderLanguage(null))
  const en = await languageFontReport(LANGUAGES.en)
  assert.equal(en.ok, true, 'english requires no shaping pack')

  const ta = await assertLanguageFonts(TA) // throws on any failure
  assert.equal(ta.ok, true)
  assert.equal(ta.code, 'ta')
  for (const c of ta.checks) assert.equal(c.pass !== false, true, `preflight check ${c.name} failed: ${c.detail}`)

  const si = await assertLanguageFonts(SI)
  assert.equal(si.ok, true)
  for (const c of si.checks) assert.equal(c.pass !== false, true, `preflight check ${c.name} failed: ${c.detail}`)
})

test('unicode: font preflight FAILS LOUD on a missing font file (RENDER_PREFLIGHT_FAILED)', async t => {
  const fake = { ...TA, code: 'zz-missing-font', fontFiles: ['assets/fonts/NotoSansDoesNotExist.ttf'] }
  await assert.rejects(
    () => assertLanguageFonts(fake),
    (e) => /RENDER_PREFLIGHT_FAILED.*font file missing/.test(e.message),
    'a missing font must never reach the renderer silently'
  )
})

test('unicode: font preflight FAILS LOUD on tofu — Sinhala canaries shaped with the Tamil-only font', async t => {
  // Simulates a misconfigured pack: Sinhala corpus (borrowed via code 'si'),
  // wrong (Tamil) font. The Sinhala strings are not covered → .notdef →
  // quarantine. The composite cache key keeps this separate from the real si
  // pack's report (same code, different files = different preflight).
  const fake = { code: 'si', fontFiles: TA.fontFiles, fontFamily: 'Noto Sans Tamil', latinFontFiles: null }
  await assert.rejects(
    () => assertLanguageFonts(fake),
    (e) => /RENDER_PREFLIGHT_FAILED/.test(e.message),
  )
})

test('unicode: canvas registration probe verifies GlobalFonts knows the pack family', async t => {
  const ok = await DesignSystemFontProbe(TA)
  assert.equal(ok.name, 'canvas-registered')
  assert.equal(ok.pass, true, `GlobalFonts.has("${TA.fontFamily}") must be true: ${ok.detail}`)

  // A pack without fontFiles (English) passes trivially.
  const en = await DesignSystemFontProbe(LANGUAGES.en)
  assert.equal(en.pass, true)
})

// ── tofu detection: must fire, must not fire ────────────────────────────────

test('unicode: .notdef detection fires for a script the font does not cover (Malayalam vs Tamil font)', async t => {
  t.after(() => setRenderLanguage(null))
  const l = await shapeText('അ', { fontFile: TA.fontFiles, size: 64, weight: 400 })
  assert.equal(l.hasNotdef, true, 'ᴍᴀʟᴀʏᴀʟᴀ። അ must be detected as missing from Noto Sans Tamil')
})

test('unicode: Latin letters are .notdef in Noto Sans Tamil (the shipped upstream face has digits+punct only)', async t => {
  const missing = await shapeText('A', { fontFile: TA.fontFiles, size: 64, weight: 400, latinFontFiles: null })
  assert.equal(missing.hasNotdef, true, 'Noto Sans Tamil must NOT claim Latin letter coverage')

  const digits = await shapeText('2,500 : (1)', { fontFile: TA.fontFiles, size: 64, weight: 400, latinFontFiles: null })
  assert.equal(digits.hasNotdef, false, 'digits + basic punctuation ARE covered by Noto Sans Tamil')
})

test('unicode: Tamil script shapes with ZERO tofu across a defect-hunting canary corpus', async t => {
  const corpus = [
    'தமிழ்நாடு 2,500 கோடி முதலீடு',
    'க்ஷ த்யெ க்க்க',
    'ஏழு எழுத்து — தமிழ் : (ஐந்து)',
    'ஆங்கிலம்-and-தமிழ்?', // mixed script — Latin runs to the companion font
  ]
  for (const text of corpus) {
    const l = await shapeText(text, { fontFile: TA.fontFiles, size: 64, weight: 900, latinFontFiles: TA.latinFontFiles })
    assert.equal(l.hasNotdef, false, `"${text}" must shape without tofu (advance=${l.advancePx})`)
    assert.ok(Number.isFinite(l.advancePx) && l.advancePx > 0, `"${text}" must have a positive finite advance`)
  }
})

test('unicode: Sinhala script shapes with ZERO tofu (pre-base vowel signs, conjoined ශ්‍ර / ප්‍ර, punctuation)', async t => {
  t.after(() => setRenderLanguage(null))
  setRenderLanguage(SI)
  const corpus = [
    'ශ්‍රී ලංකාව 2,500 කෝටි',
    'කෙ කෛ කෝ ප්‍ර',
    'සිංහල-and-inc.',
    'නි , මි ෲ : (දෙක)',
  ]
  for (const text of corpus) {
    const l = await shapeText(text, { fontFile: SI.fontFiles, size: 64, weight: 900, latinFontFiles: null })
    assert.equal(l.hasNotdef, false, `"${text}" must shape without tofu (advance=${l.advancePx})`)
    assert.ok(l.advancePx > 0)
  }
})

// ── mixed-script run splitting ──────────────────────────────────────────────

test('unicode: mixed-script Tamil headline (Latin brand word + digits) draws with NO tofu via the pack-declared companion font', async t => {
  t.after(() => setRenderLanguage(null))
  setRenderLanguage(TA)
  const text = 'AI சூத்திரம் 2,500'

  // Real call-site path: measureShaped resolves the companion Latin font from
  // the ACTIVE pack automatically (call sites pass pack.fontFiles).
  const adv = await measureShaped(text, { fontFile: TA.fontFiles, size: 64, weight: 900 })
  assert.ok(adv > 0 && Number.isFinite(adv))
  // Explicit run-splitting must produce the SAME advance as the default path.
  const explicit = await shapeText(text, { fontFile: TA.fontFiles, size: 64, weight: 900, latinFontFiles: TA.latinFontFiles })
  assert.equal(explicit.hasNotdef, false)
  assert.equal(explicit.advancePx, adv, 'active-pack default must equal explicit run-splitting')

  // The unsplit fallback (pre-fix behavior) WOULD tofu — regression guard that
  // the split actually engaged.
  const unsplit = await shapeText(text, { fontFile: TA.fontFiles, size: 64, weight: 900, latinFontFiles: null })
  assert.equal(unsplit.hasNotdef, true, 'without the companion font Latin letters must tofu (proves the split engaged)')

  // Glyphs carry their per-run font records (drawShaped uses them).
  for (const g of explicit.glyphs) assert.ok(g.rec, 'every shaped glyph must carry its font record')
})

test('unicode: drawShaped renders mixed-script text on a real canvas without throwing and reports the advance', async t => {
  t.after(() => setRenderLanguage(null))
  setRenderLanguage(TA)
  const { ctx } = canvasCtx()
  const adv = await drawShaped(ctx, 'AI சூத்திரம் 2,500', 800, 200, {
    fontFile: TA.fontFiles, size: 64, weight: 900, align: 'center', baseline: 'middle',
    fillStyle: '#FFFFFF', stroke: { style: '#000000', width: 6 },
  })
  assert.ok(adv > 0)
  // English path untouched: with NO pack the latin-only string uses native text
  const native = ctx.measureText('plain english').width
  assert.ok(native > 0)
})

// ── symbol-only native detour (the REPLAY ▶ banner defect) ──────────────────

test('unicode: needsShaping routes pure-symbol strings AWAY from shaping (si pack active)', async t => {
  t.after(() => setRenderLanguage(null))
  setRenderLanguage(SI)
  assert.equal(isSymbolOnly('▶'), true, '▶ is symbol-only')
  assert.equal(isSymbolOnly('REPLAY'), false, 'Latin word is not symbol-only')
  assert.equal(isSymbolOnly('தமிழ்'), false, 'script text is not symbol-only')
  assert.equal(isSymbolOnly('2,500'), false, 'digits keep the shaped path (wrapping metrics)')
  assert.equal(needsShaping('▶'), false, '▶ must never reach hb shaping (run-2 tofu source)')
  assert.equal(needsShaping('REPLAY'), false)
  assert.equal(needsShaping('தமிழ்'), true)
})

test('unicode: drawShaped(▶) draws via the native detour — NO tofu warning, positive width', async t => {
  t.after(() => setRenderLanguage(null))
  setRenderLanguage(SI)
  const warnings = []
  const origWarn = console.warn
  console.warn = (...a) => warnings.push(a.join(' '))
  try {
    const { ctx } = canvasCtx()
    const w = await drawShaped(ctx, '▶', 500, 200, {
      fontFile: SI.fontFiles, size: 58, weight: 900, align: 'center', baseline: 'middle',
      fillStyle: '#FFFFFF', stroke: { style: '#000000', width: 6 },
    })
    assert.ok(w > 0, `▶ must report a positive advance (got ${w})`)
  } finally {
    console.warn = origWarn
  }
  assert.equal(warnings.filter(x => /tofu/.test(x)).length, 0, 'no [SHAPED] tofu warnings for ▶ (was 3× in run-2)')
})

test('unicode: measureShaped(▶) matches the drawShaped detour width exactly (wrap math stays consistent)', async t => {
  t.after(() => setRenderLanguage(null))
  setRenderLanguage(TA)
  const { ctx } = canvasCtx()
  const drawn = await drawShaped(ctx, '▶', 100, 100, { fontFile: TA.fontFiles, size: 58, weight: 800 })
  const measured = await measureShaped('▶', { fontFile: TA.fontFiles, size: 58, weight: 800 })
  assert.equal(measured, drawn, `measureShaped (${measured}) must equal drawShaped (${drawn})`)
  assert.ok(measured > 0)
})

test('unicode: REPLAY ▶ NEWS-MONSTER routes ▶ WITH the Latin run (Montserrat carries it) and wraps with the symbol word', async t => {
  t.after(() => setRenderLanguage(null))
  setRenderLanguage(TA)
  const text = 'REPLAY ▶ NEWS-MONSTER'
  const l = await shapeText(text, { fontFile: TA.fontFiles, size: 64, weight: 900, latinFontFiles: TA.latinFontFiles })
  assert.equal(l.hasNotdef, false, '▶ inside a Latin-bordered string must shape without tofu')
  assert.equal(new Set(l.glyphs.map(g => g.rec)).size, 1, 'whole banner is one Montserrat run (symbols ride the Latin run)')

  const { ctx } = canvasCtx()
  const lines = await wrapLocalized(ctx, `புதிய தொழில்நுட்பம் ${text} இன்று`, 700, { fontFile: TA.fontFiles, size: 58, weight: 900 })
  assert.ok(lines.length >= 1)
  for (const line of lines) {
    if (line.includes(' ')) {
      const w = await measureShaped(line, { fontFile: TA.fontFiles, size: 58, weight: 900 })
      assert.ok(w <= 700, `wrapped line "${line}" (${w.toFixed(0)}px) fits 700px incl. symbol words`)
    }
  }
})

// ── RC6: EmphasisLayer keyword must take the shaped path for pack scripts ───

test('unicode: EmphasisLayer (AI accent keyword) draws pack-script caption_focus SHAPED — no notdef boxes, accent ink present', async t => {
  t.after(() => setRenderLanguage(null))
  const { DesignSystem } = await import('../src/visuals/DesignSystem.mjs')
  const { VIDEO_HD } = await import('../src/video/RenderProfile.mjs')
  const { EmphasisLayer } = await import('../src/video/layers/EmphasisLayer.mjs')
  DesignSystem.setProfile(VIDEO_HD)
  setRenderLanguage(TA)
  const cv = createCanvas(1280, 720)
  const ctx = cv.getContext('2d')
  ctx.fillStyle = '#101010'
  ctx.fillRect(0, 0, 1280, 720)
  const warnings = []
  const origWarn = console.warn
  console.warn = (...a) => warnings.push(a.join(' '))
  let goldInk = 0
  try {
    await new EmphasisLayer().draw(
      ctx,
      { type: 'hook', captionHidden: true, textPolicy: {}, caption_focus: 'மண்டலம்' },
      0.5, 'finance', 1
    )
  } finally {
    console.warn = origWarn
    setRenderLanguage(null)
  }
  const d = ctx.getImageData(0, 380, 1280, 200).data
  for (let i = 0; i < d.length; i += 4) {
    const r = d[i], g = d[i + 1], b = d[i + 2]
    if (r > 170 && g > 130 && b < 100) goldInk++
  }
  assert.ok(goldInk > 500, `emphasis keyword must paint accent ink (got ${goldInk} px) — was hollow .notdef boxes before RC6 fix`)
  assert.equal(warnings.filter(x => /tofu/.test(x)).length, 0, 'no [SHAPED] tofu warnings from the emphasis layer')
})

test('unicode: EmphasisLayer EN (no pack) keeps the native path — accent ink present, nothing regime-changed', async t => {
  t.after(() => setRenderLanguage(null))
  const { DesignSystem } = await import('../src/visuals/DesignSystem.mjs')
  const { VIDEO_HD } = await import('../src/video/RenderProfile.mjs')
  const { EmphasisLayer } = await import('../src/video/layers/EmphasisLayer.mjs')
  DesignSystem.setProfile(VIDEO_HD)
  setRenderLanguage(null)
  const cv = createCanvas(1280, 720)
  const ctx = cv.getContext('2d')
  ctx.fillStyle = '#101010'
  ctx.fillRect(0, 0, 1280, 720)
  await new EmphasisLayer().draw(
    ctx,
    { type: 'hook', captionHidden: true, textPolicy: {}, caption_focus: 'MARKET SHOCK' },
    0.5, 'finance', 1
  )
  const d = ctx.getImageData(0, 380, 1280, 200).data
  let goldInk = 0
  for (let i = 0; i < d.length; i += 4) {
    const r = d[i], g = d[i + 1], b = d[i + 2]
    if (r > 170 && g > 130 && b < 100) goldInk++
  }
  assert.ok(goldInk > 500, `EN emphasis must still paint accent ink natively (got ${goldInk} px)`)
})

// ── shaping contracts ───────────────────────────────────────────────────────

test('unicode: NFC and NFD variants of the same text measure with EQUAL shaped advances', async t => {
  const pairs = ['ஔ', 'கா', 'ஓடி'].map((s) => [s.normalize('NFC'), s.normalize('NFD')])
  for (const [nfc, nfd] of pairs) {
    const a = await measureShaped(nfc, { fontFile: TA.fontFiles, size: 64, weight: 400, latinFontFiles: TA.latinFontFiles })
    const b = await measureShaped(nfd, { fontFile: TA.fontFiles, size: 64, weight: 400, latinFontFiles: TA.latinFontFiles })
    assert.ok(Math.abs(a - b) < 0.001, `NFC(${nfc}) = ${a} must equal NFD(${nfd}) = ${b}`)
  }
})

test('unicode: conjunct compaction — shaped க்ஷ is strictly tighter than its three parts', async t => {
  const ksha = await measureShaped('க்ஷ', { fontFile: TA.fontFiles, size: 64, weight: 400, latinFontFiles: null })
  const ka = await measureShaped('க', { fontFile: TA.fontFiles, size: 64, weight: 400, latinFontFiles: null })
  const virama = await measureShaped('்', { fontFile: TA.fontFiles, size: 64, weight: 400, latinFontFiles: null })
  const sha = await measureShaped('ஷ', { fontFile: TA.fontFiles, size: 64, weight: 400, latinFontFiles: null })
  assert.ok(ka > 0 && sha > 0 && virama >= 0)
  assert.ok(ksha < ka + virama + sha, `shaped conjunct க்ஷ (${ksha.toFixed(1)}px) must be tighter than க+்+ஷ summed (${(ka + virama + sha).toFixed(1)}px) — HarfBuzz compaction proof`)
})

test('unicode: whitespace preservation — extra spaces NEVER collapse in shaped advances', async t => {
  const one = await measureShaped('தமிழ் நாடு', { fontFile: TA.fontFiles, size: 64, weight: 400, latinFontFiles: TA.latinFontFiles })
  const two = await measureShaped('தமிழ்  நாடு', { fontFile: TA.fontFiles, size: 64, weight: 400, latinFontFiles: TA.latinFontFiles })
  assert.ok(two > one, `double-space (${two.toFixed(1)}) must be wider than single-space (${one.toFixed(1)})`)
  const siOne = await measureShaped('ලංකා සිංහල', { fontFile: SI.fontFiles, size: 64, weight: 400, latinFontFiles: null })
  const siTwo = await measureShaped('ලංකා  සිංහල', { fontFile: SI.fontFiles, size: 64, weight: 400, latinFontFiles: null })
  assert.ok(siTwo > siOne)
})

test('unicode: pack OFF (`en`) leaves everything on the native canvas path', async t => {
  t.after(() => setRenderLanguage(null))
  setRenderLanguage(null)
  assert.equal(getRenderLanguage(), null)
  const { ctx } = canvasCtx()
  const text = 'STOCK FUTURES FALL'
  const native = ctx.measureText(text).width
  const viaApi = await measureLocalized(ctx, text, {}) // no pack → ctx.measureText
  assert.equal(viaApi, native, 'measureLocalized must be a transparent passthrough without a pack')
})

// ── wrapLocalized greedy bounds ─────────────────────────────────────────────

test('unicode: wrapLocalized lines all fit maxWidth (single-word overflow tolerated) for ta and si', async t => {
  t.after(() => setRenderLanguage(null))
  setRenderLanguage(TA)
  const { ctx } = canvasCtx()
  const max = 600
  const samples = [
    'தமிழ்நாடு 2,500 கோடி முதலீடு — புதிய அறிக்கை AI தொழில்நுட்பம்',
    'இன்றைய பெரிய செய்தி: சந்தைகள் வீழ்ச்சி அடைந்தன',
  ]
  for (const text of samples) {
    const lines = await wrapLocalized(ctx, text, max, { fontFile: TA.fontFiles, size: 58, weight: 900 })
    assert.ok(lines.length >= 1)
    for (const line of lines) {
      const w = await measureShaped(line, { fontFile: TA.fontFiles, size: 58, weight: 900 })
      // Multi-word lines MUST fit; a single word that alone exceeds the width
      // is the documented greedy exception.
      if (line.includes(' ')) assert.ok(w <= max, `wrapped line "${line}" (${w.toFixed(0)}px) exceeds ${max}px — wrap must respect real glyph advances`)
    }
  }

  setRenderLanguage(SI)
  const linesSi = await wrapLocalized(ctx, 'ශ්‍රී ලංකාවේ නව ආයෝජන ව්‍යාපෘතිය අද සිට ක්‍රියාත්මක වේ 2,500 කෝටි', max, { fontFile: SI.fontFiles, size: 58, weight: 900 })
  assert.ok(linesSi.length >= 1)
  for (const line of linesSi) {
    const w = await measureShaped(line, { fontFile: SI.fontFiles, size: 58, weight: 900 })
    if (line.includes(' ')) assert.ok(w <= max, `Sinhala wrapped line "${line}" (${w.toFixed(0)}px) exceeds ${max}px`)
  }
})

// ── headless layout authority (FontMetrics) vs shaped reality ───────────────

test('unicode: FontMetrics approximation stays within a sane ratio of real shaped advances', async t => {
  t.after(() => setRenderLanguage(null))
  const size = 58
  const taHeadline = 'தமிழ்நாடு 2,500 கோடி முதலீடு'
  const shaped = await measureShaped(taHeadline, { fontFile: TA.fontFiles, size, weight: 900, latinFontFiles: TA.latinFontFiles })
  const headless = FontMetrics.measure(taHeadline, size, 'sans')
  const ratio = shaped / headless
  assert.ok(ratio > 0.4 && ratio < 2.0, `FontMetrics/sḥaped ratio ${ratio.toFixed(2)} out of sane band (headless=${headless.toFixed(0)} shaped=${shaped.toFixed(0)})`)
  // Calibration evidence (task notes): Tamil shaped ≈ 0.60 ε/cluster ≈ the 0.6
  // constant; Sinhala headless over-measures (~0.6 vs real ~0.5) which wraps
  // EARLIER = the safe direction (no clipped headlines). No constant change.
})

// ── engine wiring: preflight gate + localized burn skip are actually hooked ─

test('unicode: engine wires the preflight fail-fast and the libass burn skip for localized renders', t => {
  const src = fs.readFileSync(new URL('../src/index.mjs', import.meta.url), 'utf8')
  // preflight runs right after the pack is set (fail-fast for direct callers)
  assert.match(src, /setRenderLanguage\(langPack\)[\s\S]{0,800}assertLanguageFonts\(langPack\)/, 'generateFromArticle must run the font preflight after activating the pack')
  assert.match(src, /this\.currentLangPack = langPack \?\? null/, 'engine must stash the pack for assembleVideo')
  // localized burn skip: Inter has no Tamil/Sinhala glyphs — libass burn must
  // be bypassed for translated packs while the EN burn path stays intact
  assert.match(src, /lpBurn\.code !== 'en' && lpBurn\.translate/, 'burn guard keys on a translated pack')
  assert.match(src, /localized render \(\$\{lpBurn\.code\}\): skipping libass burn/, 'skip marker explains why')
  assert.match(src, /else if \(gates\.burnSubtitles\)/, 'the EN burn path remains unchanged')
})

// ── composer quarantine wiring ──────────────────────────────────────────────

test('unicode: composer quarantines a variant on preflight failure with the translation-failure contract', t => {
  const src = fs.readFileSync(new URL('../scripts/composer.mjs', import.meta.url), 'utf8')
  assert.match(src, /FONT PREFLIGHT[\s\S]{0,800}assertLanguageFonts\(langPack\)/, 'per-variant preflight runs before translation spend')
  assert.match(src, /quarantined for this run: \$\{e\.message\}/, 'preflight failure quarantines ONLY this variant')
})

test('unicode: parseLangSpec resolves ordered packs and rejects unknown codes', t => {
  assert.deepEqual(parseLangSpec('en,ta,si').map((p) => p.code), ['en', 'ta', 'si'])
  // Case-insensitive lookup; requesting ONLY a variant yields only that
  // variant (the en master is not force-included by design — callers prepend
  // it via the primary-first rule when 'en' is requested).
  assert.deepEqual(parseLangSpec('TA').map((p) => p.code), ['ta'])
  assert.throws(() => parseLangSpec('xx'), /UNKNOWN_LANGUAGE/)
})

test('unicode: Tamil and Sinhala packs declare their vendored Noto fonts + per-pack essentials', t => {
  assert.deepEqual(TA.fontFiles, ['assets/fonts/NotoSansTamil-Regular.ttf', 'assets/fonts/NotoSansTamil-Bold.ttf'])
  assert.deepEqual(TA.latinFontFiles, ['assets/fonts/Montserrat-ExtraBold.ttf'])
  assert.equal(TA.translate, true)
  assert.equal(TA.edgeVoice, 'ta-LK-SaranyaNeural')

  // Sinhala's Noto face covers Latin letters (preflight-canary verified) — it
  // declares NO companion Latin font.
  assert.equal(SI.latinFontFiles, undefined)
  assert.deepEqual(SI.fontFiles, ['assets/fonts/NotoSansSinhala-Regular.ttf', 'assets/fonts/NotoSansSinhala-Bold.ttf'])
  assert.equal(SI.translate, true)
})

// ── spacing fidelity (Task-135): outline scale == advance scale ─────────────
// HISTORY: drawShaped called glyph.getPath(x, y) WITHOUT the fontSize argument
// and opentype.js defaults it to 72 — outlines drew at 72/upem while HarfBuzz
// advances scaled at size/upem. At caption sizes (<72px) letters drew ~1.24×
// wider than their reserved slots and MERGED (meaning destroyed); at headline
// sizes letters shrank into scattered fragments. The fix passes `size` and
// these tests pin it forever.

function inkColumns(ctx, W, H) {
  const d = ctx.getImageData(0, 0, W, H).data
  const cols = []
  for (let x = 0; x < W; x++) {
    let ink = false
    for (let y = 0; y < H; y += 2) { if (d[(y * W + x) * 4] < 100) { ink = true; break } }
    cols.push(ink)
  }
  return cols
}

test('unicode: spacing fidelity — drawn glyph ink is scale-invariant vs its advance ( getPath(size) fix pin )', async t => {
  t.after(() => setRenderLanguage(null))
  for (const [code, letter] of [['ta', 'க'], ['si', 'අ']]) {
    const pack = LANGUAGES[code]
    const ratios = []
    const spans = []
    for (const size of [58, 96, 160]) {
      const layout = await shapeText(letter, { fontFile: pack.fontFiles, size, weight: 800 })
      const adv = layout.advancePx
      const pad = Math.ceil(size)
      const W = Math.ceil(adv) + pad * 2, H = Math.ceil(size * 2.5)
      const cv = createCanvas(W, H)
      const ctx = cv.getContext('2d')
      ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, W, H)
      ctx.fillStyle = '#000'
      await drawShaped(ctx, letter, pad, H / 2, { fontFile: pack.fontFiles, size, weight: 800, baseline: 'middle', fillStyle: '#000' })
      const cols = inkColumns(ctx, W, H)
      const first = cols.indexOf(true), last = cols.lastIndexOf(true)
      const span = last - first + 1
      spans.push(span)
      ratios.push(span / adv)
    }
    const max = Math.max(...ratios), min = Math.min(...ratios)
    assert.ok(
      (max - min) / ratios[1] <= 0.04,
      `${code} ink/advance ratio must not depend on size (the 72px-outline bug drew 1.24× slots at 58px): got ${JSON.stringify(ratios.map(r => +r.toFixed(3)))}`
    )
    // ink must grow linearly with size: ink@160 == ink@58 × (160/58) ±4%
    const lin = spans[2] / (spans[0] * (160 / 58))
    assert.ok(lin > 0.96 && lin < 1.04, `${code} drawn ink must scale linearly with size (got ×${lin.toFixed(3)})`)
  }
})

test('unicode: spacing fidelity — word-to-word ink separation visible at caption size (CaptionEngine-style layout, 58px)', async t => {
  t.after(() => setRenderLanguage(null))
  for (const [code, seq] of [
    ['ta', 'பருவமழை உலகளாவிய அறுவடை'],
    ['si', 'මෝසම් වැසි අස්වැන්න'],
  ]) {
    const pack = LANGUAGES[code]
    const size = 58
    setRenderLanguage(pack)
    const words = seq.split(' ')
    const line = words.join(' ')
    const W = 2400, H = 200, y = 100
    const cv = createCanvas(W, H)
    const ctx = cv.getContext('2d')
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, W, H)
    ctx.fillStyle = '#000'
    // CaptionEngine's real algorithm: lineAdvance from shaped measure, word
    // slots cw += wordAdvance + shapedSpaceAdvance, words centered in slots.
    const lineW = (await shapeText(line, { fontFile: pack.fontFiles, size, weight: 800 })).advancePx
    const spaceW = (await shapeText(' ', { fontFile: pack.fontFiles, size, weight: 800 })).advancePx
    let cw = (W - lineW) / 2
    for (const w of words) {
      const ww = (await shapeText(w, { fontFile: pack.fontFiles, size, weight: 800 })).advancePx
      await drawShaped(ctx, w, cw + ww / 2, y, { fontFile: pack.fontFiles, size, weight: 800, align: 'center', baseline: 'middle', fillStyle: '#000' })
      cw += ww + spaceW
    }
    const cols = inkColumns(ctx, W, H)
    const first = cols.indexOf(true), last = cols.lastIndexOf(true)
    let best = 0, run = 0
    for (let x = first; x <= last; x++) {
      if (!cols[x]) { run++; if (run > best) best = run } else run = 0
    }
    const emRun = best / size
    assert.ok(
      emRun >= 0.28,
      `${code}: word-to-word ink gap too thin at caption size (${best}px = ${emRun.toFixed(2)}em — pre-fix the 72px outline bug squeezed it to 9px/0.155em)`
    )
  }
})
