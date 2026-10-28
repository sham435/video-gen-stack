/**
 * FontPreflight — startup gate for per-language text rendering (spec §9).
 *
 * A Unicode font file alone does NOT guarantee correct output: it must (a)
 * actually exist in THIS environment (local/CI/container — never a
 * machine-installed font), (b) parse, and (c) cover the target script's
 * canary corpus — vowel signs, conjuncts, digits, punctuation — with ZERO
 * .notdef glyphs, which is the "tofu box" failure the operator saw.
 *
 * Runs BEFORE any frame renders for a localized variant. Failure throws
 * RENDER_PREFLIGHT_FAILED so the variant quarantines the way translation
 * failures do — a half-shaped video must never reach the publish step.
 */
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { shapeText } from './ShapedText.mjs'
import { DesignSystemFontProbe } from './FontProbe.mjs'

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')

// Canary strings exercise the failure modes that matter for broadcast:
// pre-base vowel signs, conjunct/ligature sequences, native punctuation,
// Latin digits, mixed script, and NFC-normalized grapheme clusters.
const CANARY_CORPUS = {
  ta: {
    name: 'Tamil (தமிழ்)',
    // headline-style sample: வது matra cluster, க்ஷ conjunct, digits+commas
    strings: [
      'தமிழ்நாடு 2,500 கோடி முதலீடு',
      'க்ஷ த்யெ க்க்க',
      'ஆங்கிலம்-and-தமிழ்?',
      'ஏழு எழுத்து — தமிழ் : (ஐந்து)',
    ],
  },
  si: {
    name: 'Sinhala (සිංහල)',
    // කෙ shape-critical pre-base vowel sign; ර්/ක් conjunct sequences
    strings: [
      'ශ්‍රී ලංකාව 2,500 කෝටි',
      'කෙ කෛ කෝ ප්‍ර',
      'සිංහල-and-inc.',
      'නි , මි ෲ : (දෙක)',
    ],
  },
  en: { name: 'English', strings: [] },
}

const results = new Map() // `${code}|${fontFiles}` → report (per-process cache)

/**
 * Verify the pack's fonts exist, parse, and cover the canary corpus. Returns
 * a report { code, fontFamily, fontFiles, checks:[...], ok }. THROWS
 * RENDER_PREFLIGHT_FAILED on any hard failure (missing font, tofu canary).
 */
export async function assertLanguageFonts(pack) {
  if (!pack || !pack.fontFiles) {
    const missing = { code: pack?.code || 'en', ok: true, checks: [{ name: 'native-font', pass: true, note: 'no pack fonts (English native canvas path)' }] }
    if (pack) results.set(pack.code, missing)
    return missing
  }
  // Key by code AND the concrete font files: same code + different files
  // (misconfigured pack, test fixture) is a DIFFERENT report.
  const cacheKey = `${pack.code}|${pack.fontFiles.join(',')}`

  if (results.has(cacheKey)) return results.get(cacheKey)

  const checks = []
  const fail = (msg) => { const e = new Error(`RENDER_PREFLIGHT_FAILED (${pack.code}): ${msg}`); e.checks = checks; throw e }

  // 1) Files exist in THIS environment (tracked repo assets — no host fonts)
  for (const rel of pack.fontFiles) {
    const abs = path.isAbsolute(rel) ? rel : path.join(REPO_ROOT, rel)
    const exists = fs.existsSync(abs)
    checks.push({ name: 'font-file', pass: exists, detail: rel })
    if (!exists) fail(`font file missing: ${abs} — vendor the Noto file or run npm install of the repo (fonts are tracked assets)`)
  }

  // 2) Parse + shape every canary string; detect .notdef (tofu) + NaN advances
  const corpus = (CANARY_CORPUS[pack.code] || CANARY_CORPUS.en).strings
  for (const text of corpus) {
    try {
      const layout = await shapeText(text, { fontFile: pack.fontFiles, size: 64, weight: 400, latinFontFiles: pack.latinFontFiles ?? null })
      const tofu = !!layout.hasNotdef
      const sane = Number.isFinite(layout.advancePx) && layout.advancePx > 0
      checks.push({ name: 'canary', pass: !(tofu || !sane), detail: `${text.slice(0, 18)}… advance=${layout.advancePx.toFixed(1)}px notdef=${tofu}` })
      if (tofu) fail(`missing glyphs for "${text.slice(0, 24)}…" in ${pack.fontFiles.join('|')}`)
      if (!sane) fail(`non-finite advance shaping "${text.slice(0, 24)}…"`)
    } catch (e) {
      if (String(e.message || '').startsWith('SHAPED_FONT_MISSING')) fail(e.message)
      checks.push({ name: 'canary', pass: false, detail: `${text.slice(0, 18)}… ${e.message}` })
      fail(`shaping error on canary "${text.slice(0, 24)}…": ${e.message}`)
    }
  }

  // 3) Renderer registration probe: canvas GlobalFonts must resolve the family
  const reg = await DesignSystemFontProbe(pack)
  checks.push(reg)
  if (!reg.pass) fail(`canvas GlobalFonts cannot register/resolve "${pack.fontFamily}": ${reg.detail}`)

  const report = { code: pack.code, fontFamily: pack.fontFamily, fontFiles: [...pack.fontFiles], checks, ok: true }
  results.set(cacheKey, report)
  return report
}

/** CONTENT-coverage gate: canaries only prove the font file is present and
 *  healthy — the ACTUAL strings a variant will publish (translated narration,
 *  captions, review corrections) may contain codepoints the canaries never
 *  touched. Shapes every unique text with the SAME shaper/fonts the renderer
 *  uses and refuses any .notdef, so render-time tofu is blocked before any
 *  speech/render cost is paid. env: pack.latinFontFiles drives the
 *  mixed-script run split, exactly like the draw path. */
export async function assertContentCovers(pack, texts, { label = 'content' } = {}) {
  if (!pack || !pack.fontFiles) {
    return { code: pack?.code || 'en', ok: true, checked: 0, skipped: true, note: 'no pack fonts (native Latin path)' }
  }
  const list = Array.from(new Set((texts || []).map((t) => String(t ?? '').trim()).filter(Boolean)))
  const report = { code: pack.code, ok: true, checked: list.length }
  for (const text of list) {
    const layout = await shapeText(text, { fontFile: pack.fontFiles, size: 64, weight: 400, latinFontFiles: pack.latinFontFiles ?? null })
    if (layout.hasNotdef) {
      // Diagnose: shape each unique codepoint to name exactly what is missing.
      const bad = []
      for (const ch of new Set(Array.from(text))) {
        if (!ch.trim()) continue
        const one = await shapeText(ch, { fontFile: pack.fontFiles, size: 64, weight: 400, latinFontFiles: pack.latinFontFiles ?? null })
        if (one.hasNotdef) bad.push(`U+${ch.codePointAt(0).toString(16).toUpperCase().padStart(4, '0')} '${ch}'`)
      }
      report.ok = false
      throw Object.assign(
        new Error(
          `RENDER_PREFLIGHT_FAILED (${pack.code}): missing glyphs (${bad.join(', ') || 'unresolved'}) in ${label} "${text.slice(0, 40)}…" — vendored font(s) ${pack.fontFiles.join('|')}${pack.latinFontFiles ? ` + latin ${pack.latinFontFiles.join('|')}` : ''} cannot cover this content; no rendering (and no tofu boxes) will be produced for this variant`
        ),
        { report }
      )
    }
  }
  return report
}

/** Non-throwing variant for diagnostics/dashboards. */
export async function languageFontReport(pack) {
  try {
    const r = await assertLanguageFonts(pack)
    return { ...r, ok: true }
  } catch (e) {
    return { code: pack?.code || 'en', ok: false, error: e.message, checks: e.checks || [] }
  }
}
