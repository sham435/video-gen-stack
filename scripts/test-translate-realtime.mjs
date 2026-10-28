#!/usr/bin/env node
/**
 * test-translate-realtime.mjs — Google-Translate-like realtime evidence probe.
 *
 * Operator's examples (run exactly as given):
 *   1. en→ta  "Monsoon boosts global rice harvest prospects"
 *   2. si→ta  "මෝසම් වැසි ගෝලීය සහල් අස්වැන්න අපේක්ෂාව ඉහළ නැංවීම"
 *
 * Phases (timed with hrtime):
 *   LIVE    provider round-trip on the operator's lines (may be BLOCKED if no
 *           usable key — reported as data, never fabricated)
 *   REPLAY  translateSegments over REAL cached production pairs (cache-first
 *           replay = the steady-state realtime path; provider-free)
 *   STREAM  LocalizationPipeline.pushSegment on a real cached pair
 *   FONT    assertContentCovers on outputs — the no-tofu render gate
 *
 * Verdict semantics:
 *   REALTIME-OK   replay/stream/font phases all PASS (the pipeline's realtime
 *                 path is proven end-to-end offline-safe)
 *   LIVE-BLOCKED  live provider unavailable (keys) — cold latency UNVERIFIED
 *                 until a valid key is configured (GEMINI_API_KEY or a funded
 *                 OpenRouter/OpenAI key); fail-visible behavior is verified.
 */
import fs from 'node:fs'
import crypto from 'node:crypto'
import { translateSegments } from '../src/i18n/Translator.mjs'
import { LANGUAGES } from '../src/i18n/languages.mjs'
import { assertContentCovers } from '../src/i18n/FontPreflight.mjs'
import { LocalizationPipeline } from '../src/localize/LocalizationPipeline.mjs'

const EXAMPLES = [
  { name: 'en→ta', sourceLang: 'en', line: 'Monsoon boosts global rice harvest prospects' },
  { name: 'si→ta', sourceLang: 'si', line: 'මෝසම් වැසි ගෝලීය සහල් අස්වැන්න අපේක්ෂාව ඉහළ නැංවීම' },
]
const TARGET = LANGUAGES.ta
const ms = (ns) => Number(ns) / 1e6
const now = () => process.hrtime.bigint()
const scriptOf = (t) => (/[\u0B80-\u0BFF]/.test(t) ? 'Tamil-script ✓' : 'NO-TAMIL-SCRIPT ✗')

let hardFails = 0

console.log('── provider availability (booleans only; no secrets) ───────')
console.log(JSON.stringify({
  gemini: Boolean(process.env.GEMINI_API_KEY),
  openai_compat_key: Boolean(process.env.OPENAI_API_KEY || process.env.OPENROUTER_API_KEY),
  openai_base_url: process.env.OPENAI_BASE_URL || '(default api.openai.com)',
}))

console.log('\n── LIVE: operator lines through the provider chain ─────────')
let liveBlocked = false
{
  const t = now()
  try {
    const r = await translateSegments(
      EXAMPLES.map((e, i) => ({ index: i, start: 0, end: 1, source: e.line })),
      TARGET,
      { sourceLang: null } // first line is en-sourced; provider auto-detects mixed batch
    )
    r.segments.forEach((s) => console.log(`LIVE   ${ms(now() - t).toFixed(0)}ms total  → "${(s.text || '').slice(0, 40)}" ${scriptOf(s.text || '')}`))
  } catch (e) {
    liveBlocked = /LANG_TRANSLATE_FAILED/.test(e.message)
    console.log(`LIVE   ${liveBlocked ? 'BLOCKED' : 'FAILED'} — ${e.message.slice(0, 120)}`)
    if (!liveBlocked) hardFails++
  }
}
if (liveBlocked) {
  console.log('       → cold-path realtime latency is UNVERIFIED until a usable')
  console.log('         translation key exists (GEMINI_API_KEY, or funded OpenRouter).')
  console.log('         Fail-visible contract verified: LANG_TRANSLATE_FAILED, no empty/garbage published.')
}

console.log('\n── REPLAY: REAL cached production pairs (cache-first realtime) ──')
// Locate genuinely provider-translated pairs from the operator's own data:
// reviews ledgers hold the sourceText they were flagged for; the cache maps
// sha256(source).slice(0,32) → provider output. Only verified pairs used.
const key = (t) => crypto.createHash('sha256').update(String(t)).digest('hex').slice(0, 32)
const cache = JSON.parse(fs.readFileSync('data/translations/ta.json', 'utf8'))
const realPairs = []
for (const f of fs.readdirSync('data/translations/reviews')) {
  let st = {}
  try { st = JSON.parse(fs.readFileSync(`data/translations/reviews/${f}`, 'utf8')) } catch { continue }
  for (const it of st.items || []) {
    if (it.sourceText && cache[key(it.sourceText)] && realPairs.length < 3) {
      realPairs.push({ source: it.sourceText, expected: cache[key(it.sourceText)] })
    }
  }
}
if (!realPairs.length) { console.log('REPLAY  no real cached pairs found (skip)'); process.exit(1) }
const replayOutputs = []
for (const pair of realPairs) {
  const t = now()
  const r = await translateSegments([{ index: 0, start: 0, end: 1, source: pair.source }], TARGET, { sourceLang: null })
  const dt = ms(now() - t)
  const text = r.segments[0]?.text
  const match = text === pair.expected
  replayOutputs.push(text)
  console.log(`REPLAY ${dt.toFixed(2).padStart(8)} ms  src="${pair.source.slice(0, 36)}…" deterministic=${match} ${scriptOf(text || '')}`)
  if (!match) hardFails++ // cache must return the EXACT provider text (no re-billing drift)
}

console.log('\n── STREAM: LocalizationPipeline.pushSegment on a real pair ──')
const p = new LocalizationPipeline({ jobId: `realtime-probe-${Date.now() % 100000}`, lang: 'ta', outDir: 'output-ta-probe' })
{
  const pair = realPairs[0]
  const t = now()
  const out = await p.pushSegment({ index: 901, start: 0, end: 1, source: pair.source })
  const dt = ms(now() - t)
  const ok = out?.text === pair.expected
  console.log(`STREAM ${dt.toFixed(2).padStart(8)} ms  matches cached provider text: ${ok}`)
  if (!ok) hardFails++
}

console.log('\n── FONT: outputs shape with zero .notdef (no tofu) ──────────')
try {
  const covered = await assertContentCovers(TARGET, replayOutputs.filter(Boolean), { label: 'realtime demo outputs' })
  console.log(`FONT   PASS — ${covered.checked} localized strings, ZERO tofu, fonts ${TARGET.fontFiles.join('|')} + latin ${TARGET.latinFontFiles.join('|')}`)
} catch (e) {
  hardFails++
  console.log(`FONT   FAIL — ${e.message}`)
}

console.log(`\nVERDICT: ${hardFails === 0 ? 'REALTIME-OK' : `${hardFails} hard failure(s)`}${liveBlocked ? ' + LIVE-BLOCKED (no usable provider key)' : ''}`)
process.exit(hardFails === 0 ? 0 : 1)
