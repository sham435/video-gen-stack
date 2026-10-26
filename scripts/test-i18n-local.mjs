/**
 * Local i18n verification — runs WITHOUT network/providers:
 *   1. parseLangSpec ordering/validation (LANGS env contract)
 *   2. Translator validation internals (script-range + array shape, JSON extraction)
 *   3. ShapedText glyph-order proof (HarfBuzz reordering: pre-base mark FIRST
 *      for Sinhala කෙ / Tamil தே) + ink presence on a real canvas render
 *   4. English zero-regression guard: with NO language pack active, shaped
 *      draw falls back to native canvas text (identical semantics)
 *
 * Run: node scripts/test-i18n-local.mjs
 */
import { strict as assert } from 'node:assert'
import { createCanvas } from '@napi-rs/canvas'

let passed = 0
let failed = 0
const t = (name, fn) => {
  try {
    return Promise.resolve(fn()).then(() => { passed++; console.log(`  PASS ${name}`) }, (e) => { failed++; console.log(`  FAIL ${name}: ${e.message}`) })
  } catch (e) {
    failed++
    console.log(`  FAIL ${name}: ${e.message}`)
    return Promise.resolve()
  }
}

const { parseLangSpec, LANGUAGES } = await import('../src/i18n/languages.mjs')
const { shapeText, drawShaped, setRenderLanguage, getRenderLanguage, needsShaping } = await import('../src/i18n/ShapedText.mjs')
const { _internals } = await import('../src/i18n/Translator.mjs')

console.log('— parseLangSpec —')
await t('default → [en]', () => {
  const packs = parseLangSpec(undefined)
  assert.equal(packs.length, 1)
  assert.equal(packs[0].code, 'en')
})
await t('explicit "en,ta,si" → en first, then extras in order', () => {
  const packs = parseLangSpec('en,ta,si')
  assert.deepEqual(packs.map(p => p.code), ['en', 'ta', 'si'])
})
await t('reordered spec still puts EN primary first', () => {
  const packs = parseLangSpec('si,en')
  assert.deepEqual(packs.map(p => p.code), ['en', 'si'])
})
await t('unknown code throws', () => {
  assert.throws(() => parseLangSpec('en,zz'), /UNKNOWN_LANGUAGE/)
})
await t('duplicate codes collapse', () => {
  assert.deepEqual(parseLangSpec('en,ta,ta').map(p => p.code), ['en', 'ta'])
})
await t('voices are the confirmed LK neural voices', () => {
  assert.equal(LANGUAGES.ta.edgeVoice, 'ta-LK-SaranyaNeural')
  // Verified against the live edge-tts catalog: the female Sinhala voice is
  // 'Thilini' (not the 'Thilina' id found in early notes).
  assert.equal(LANGUAGES.si.edgeVoice, 'si-LK-ThiliniNeural')
})
await t('variant packs declare vendored fonts that exist', async () => {
  const fs = await import('node:fs')
  for (const code of ['ta', 'si']) {
    for (const f of LANGUAGES[code].fontFiles) assert.ok(fs.existsSync(f), `missing font ${f}`)
  }
})

console.log('— Translator validation internals —')
await t('Latin-only output rejected for Sinhala', () => {
  assert.equal(_internals.validateOutput(
    [{ text: 'hello world today' }, { text: 'second line here' }],
    ['English fallback text', 'another latin line'],
    'si'
  ), false)
})
await t('Sinhala script output accepted', () => {
  assert.equal(_internals.validateOutput(
    [{ text: 'hello world today' }],
    ['සිංහල පරිවර්තනය මෙහි ඇත'],
    'si'
  ), true)
})
await t('Tamil script output accepted', () => {
  assert.equal(_internals.validateOutput(
    [{ text: 'hello world today' }],
    ['தமிழ் மொழிபெயர்ப்பு இங்கே'],
    'ta'
  ), true)
})
await t('length mismatch rejected', () => {
  assert.equal(_internals.validateOutput(
    [{ text: 'a' }, { text: 'b' }],
    ['one'],
    'ta'
  ), false)
})
await t('extractJsonArray unwraps fenced JSON', () => {
  assert.deepEqual(_internals.extractJsonArray('```json\n["ஒன்று","இரண்டு"]\n```'), ['ஒன்று', 'இரண்டு'])
})

console.log('— ShapedText glyph order (HarfBuzz reordering) —')
await t('Sinhala කෙ shapes to 2 glyphs with the mark FIRST (cluster 0,0)', async () => {
  const layout = await shapeText('කෙ', { fontFile: LANGUAGES.si.fontFiles, size: 60, weight: 400 })
  assert.equal(layout.glyphs.length, 2)
  assert.equal(layout.hasNotdef, false)
  // Mark glyph (gid of the vowel sign) must come BEFORE the base ka glyph.
  // Reference: harfbuzzjs direct shape gave 114 → 23 for this font.
  assert.deepEqual(layout.glyphs.map(g => g.gid), [114, 23])
})
await t('shaped render leaves ink on canvas for Tamil + Sinhala', async () => {
  const canvas = createCanvas(300, 100)
  const ctx = canvas.getContext('2d')
  ctx.fillStyle = '#000'
  ctx.fillRect(0, 0, 300, 100)
  setRenderLanguage(LANGUAGES.si)
  await drawShaped(ctx, 'කෙළ', 150, 50, { fontFile: LANGUAGES.si.fontFiles, size: 60, weight: 400, fillStyle: '#fff', align: 'center' })
  setRenderLanguage(LANGUAGES.ta)
  await drawShaped(ctx, 'தே', 150, 50, { fontFile: LANGUAGES.ta.fontFiles, size: 60, weight: 400, fillStyle: '#fff', align: 'center' })
  setRenderLanguage(null)
  const d = ctx.getImageData(0, 0, 300, 100).data
  let lit = 0
  for (let i = 0; i < d.length; i += 4) if (d[i] > 100) lit++
  assert.ok(lit > 50, `expected glyph ink, got ${lit} lit px`)
})

console.log('— English zero-regression guards —')
await t('no pack active → needsShaping false; getRenderLanguage null', () => {
  setRenderLanguage(null)
  assert.equal(getRenderLanguage(), null)
  assert.equal(needsShaping('BREAKING NEWS'), false)
})
await t('en pack never activates shaping', () => {
  setRenderLanguage(LANGUAGES.en)
  assert.equal(getRenderLanguage(), null)
  assert.equal(needsShaping('BREAKING NEWS'), false)
})
await t('non-EN pack activates shaping only for non-Latin strings', () => {
  setRenderLanguage(LANGUAGES.ta)
  assert.equal(needsShaping('Tamil'), false)          // Latin string stays native
  assert.equal(needsShaping('தேர்தல்'), true)           // Tamil string → shaped
  setRenderLanguage(null)
})

console.log('— ScriptUniqueness tri-lingual gates —')
const { ScriptUniqueness } = await import('../src/uniqueness/ScriptUniqueness.mjs')
await t('distinct Tamil narrations do NOT collapse to 1.00 (Unicode-aware _norm)', () => {
  const a = 'அறிவிப்பு இந்தக் கதைக்கு ஒரு முக்கிய மாற்றத்தை குறிக்கிறது.'
  const b = 'விரைவில் இந்தக் கதையைப் பற்றிய மேலதிக உள்ளீடு எதிர்பார்க்கப்படுகிறது.'
  const v = ScriptUniqueness._segmentSimilarity(a, b)
  assert.ok(v < 0.85, `expected below dedup threshold, got ${v}`)
})
await t('Sinhala distinct narrations pass the within-video gate', () => {
  const gate = ScriptUniqueness.validateWithinVideo([
    'අද රාත්‍රියේ මුදල් යන්නේ කොහෙද සොයමු.',
    'එම සංඛ්‍යාව මෙම මැතිවරණයේ ගණිතය වෙනස් කළේය.',
    'සංඛ්‍යා එනතුරු අප සමඟ රැඳී සිටන්න.',
  ])
  assert.equal(gate.pass, true, JSON.stringify(gate.duplicates))
})
await t('identical Tamil narrations still caught (gate sanity)', () => {
  const gate = ScriptUniqueness.validateWithinVideo([
    'இது முக்கியமான செய்தி ஆகும்',
    'இது முக்கியமான செய்தி ஆகும்',
  ])
  assert.equal(gate.pass, false)
})
await t('English within-video gate unchanged (zero regression)', () => {
  const gate = ScriptUniqueness.validateWithinVideo([
    'The money moved in eleven offshore transfers.',
    'Officials quietly changed the filing rules last week.',
  ])
  assert.equal(gate.pass, true)
})

console.log(`\n${passed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)
