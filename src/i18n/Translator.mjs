/**
 * Translator — deterministic narration/caption translation for tri-lingual
 * broadcasts (EN master → தமிழ் / සිංහල).
 *
 * Guarantees:
 *  - Deterministic reuse: every translation is cached on disk keyed by
 *    sha256(source text). A re-run never re-bills or re-translates the same
 *    sentence (cache lives in data/translations/, persisted via the pipeline
 *    cache). Temperature 0 — the provider is treated as a pure function.
 *  - Never writes garbage: provider output is length- and script-validated.
 *    A wrong-length array, empty strings, or Latin fallback text for a
 *    Sinhala/Tamil request is REJECTED and falls to the next provider.
 *  - Fail-visible: if every provider fails, throws LANG_TRANSLATE_FAILED so
 *    the caller can SKIP that language for this run instead of publishing a
 *    half-English "localized" video.
 *
 * Providers (env-driven, first available wins):
 *   GEMINI_API_KEY        → generativelanguage (model GEMINI_MODEL, default gemini-2.0-flash)
 *   OPENROUTER_API_KEY    → OpenRouter OpenAI-compatible (OPENROUTER_MODEL, default google/gemini-2.0-flash-001)
 *   OPENAI_API_KEY        → OpenAI Chat Completions (OPENAI_MODEL, default gpt-4o-mini)
 */
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import os from 'node:os'

const CACHE_DIR = path.join('data', 'translations')

const SCRIPT_RANGES = {
  ta: /[\u0B80-\u0BFF]/,
  si: /[\u0D80-\u0DFF]/,
}
const SCRIPT_NAMES = { ta: 'Tamil', si: 'Sinhala' }

function readCache(lang) {
  const file = path.join(CACHE_DIR, `${lang}.json`)
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'))
  } catch {
    return {}
  }
}

function writeCache(lang, cache) {
  fs.mkdirSync(CACHE_DIR, { recursive: true })
  const file = path.join(CACHE_DIR, `${lang}.json`)
  const tmp = path.join(os.tmpdir(), `translations-${lang}-${Date.now()}.json`)
  fs.writeFileSync(tmp, JSON.stringify(cache, null, 2))
  fs.renameSync(tmp, file)
}

const key = (text) => crypto.createHash('sha256').update(text).digest('hex').slice(0, 32)

function buildPrompt(items, langCode) {
  const target = SCRIPT_NAMES[langCode] || langCode
  // Bullet markers, NOT numbered lines: a reasoning model studied on this
  // task echoed "1." / "2." prefixes back INTO the output array elements
  // when the inputs were numbered (observed: recursive/flint). Bullets are
  // forgivable (the array position carries the mapping) and produced clean
  // arrays in live probes for both Tamil and Sinhala.
  const body = items.map((it, i) => `- ${it.text}`).join('\n')
  return [
    `Translate each line into ${target}.`,
    'This is broadcast narration for a news video: keep it natural, concise and spoken-language fluent.',
    'Rules:',
    '- Keep numbers, percentages, names and URLs unchanged.',
    '- Keep brand words like NEWS-MONSTER unchanged.',
    '- Never merge or split lines: output translated line i for input line i.',
    '- Output ONLY a JSON array of the translated strings, one element per input line, no numbering inside elements, no commentary, no markdown fence.',
    '',
    body,
  ].join('\n')
}

function validateOutput(items, outTexts, langCode) {
  if (!Array.isArray(outTexts)) return false
  if (outTexts.length !== items.length) return false
  const script = SCRIPT_RANGES[langCode]
  for (let i = 0; i < items.length; i++) {
    const t = outTexts[i]
    if (typeof t !== 'string' || t.trim().length === 0) return false
    // Language script must be present for ta/si (Latin-only = provider gave English back)
    if (t.length > 8 && !script.test(t)) return false
  }
  return true
}

function extractJsonArray(text) {
  const s = String(text).replace(/```(json)?/g, '').trim()
  const start = s.indexOf('[')
  const end = s.lastIndexOf(']')
  if (start === -1 || end === -1 || end <= start) return null
  try {
    return JSON.parse(s.slice(start, end + 1))
  } catch {
    return null
  }
}

async function callGemini(items, langCode) {
  const apiKey = process.env.GEMINI_API_KEY
  if (!apiKey) return null
  const model = process.env.GEMINI_MODEL || 'gemini-2.5-flash'
  const r = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: buildPrompt(items, langCode) }] }],
        generationConfig: { temperature: 0, maxOutputTokens: 4096 },
      }),
    }
  )
  if (!r.ok) throw new Error(`gemini HTTP ${r.status}`)
  const j = await r.json()
  const parts = j?.candidates?.[0]?.content?.parts || []
  return extractJsonArray(parts.map((p) => p.text || '').join(''))
}

async function callOpenAICompat(items, langCode, { routerOverride = false } = {}) {
  // Router intent: OPENROUTER_MODEL set → route through OpenRouter even when
  // an OPENAI_API_KEY also exists (evidenced: paired keys where the OpenAI
  // key 402s would otherwise silently shadow the working router path).
  const isRouter = routerOverride || (!!process.env.OPENROUTER_API_KEY && (!process.env.OPENAI_API_KEY || !!process.env.OPENROUTER_MODEL))
  const apiKey = process.env.OPENAI_API_KEY || process.env.OPENROUTER_API_KEY
  if (!apiKey) return null
  const base = process.env.OPENAI_BASE_URL || (isRouter ? 'https://openrouter.ai/api/v1' : 'https://api.openai.com/v1')
  const model = isRouter
    ? (process.env.OPENROUTER_MODEL || 'recursive/flint-v1.0:free')
    : (process.env.OPENAI_MODEL || 'gpt-4o-mini')
  const r = await fetch(`${base}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      temperature: 0,
      // Explicit token budget: OpenRouter's default reasoning models (e.g.
      // recursive/flint) spend 2-4k+ tokens thinking before emitting the JSON
      // array; an unset/low cap truncates mid-array → finish:len → null
      // content → unusable output. Probed: 16-line Tamil batch truncated at
      // 6500 tokens (reasoning variance) and completed at 12000 (usage 5727);
      // Sinhala 8-line used 5173. 16000 covers both languages worst-case.
      // Override with I18N_MAX_TOKENS.
      max_tokens: Number(process.env.I18N_MAX_TOKENS) || 16000,
      messages: [{ role: 'user', content: buildPrompt(items, langCode) }],
    }),
  })
  if (!r.ok) {
    // Honest provider failover (same contract as the context path): a 402/429
    // on the primary endpoint falls back ONCE to router mode when a usable
    // OpenRouter key is configured.
    if (!isRouter && routerOverride === false && process.env.OPENROUTER_API_KEY) {
      return await callOpenAICompat(items, langCode, { routerOverride: true })
    }
    throw new Error(`openai-compat HTTP ${r.status}`)
  }
  const j = await r.json()
  return extractJsonArray(j?.choices?.[0]?.message?.content)
}

async function callProvider(kind, items, langCode) {
  const out = kind === 'gemini' ? await callGemini(items, langCode) : await callOpenAICompat(items, langCode)
  if (!out) return null
  return validateOutput(items, out, langCode) ? out : null
}

/**
 * translateSegments(segments=[{index,start,end,source}], langPack, opts)
 *   → { segments:[{...seg, text}], flags:[{index,issues,names}], stats }
 *
 * Stage 3 of the LocalizationPipeline: CONTEXT-AWARE translation.
 * Differences from translateStrings:
 *  - context: the 2 source sentences BEFORE and AFTER each batch are included
 *    in the prompt as read-only context so pronouns, referents and story
 *    deixisin (he/the bill/that election) resolve in the target language.
 *  - fidelity: source NUMBERS must appear in the translation (broadcast rule:
 *    keep numbers unchanged). A missing number does NOT silently pass — the
 *    segment gets a fidelity flag for the stage-5 gate/review queue. Names are
 *    extracted as review metadata (transliteration can't be literal-matched).
 *  - incremental cache: every batch is written to disk immediately, so a
 *    failed run resumes without re-billing or re-translating.
 * EN passthrough (langPack.translate false) returns segments untouched —
 * the English master path never pays a translation bill.
 */
export async function translateSegments(segments, langPack, { batchSize, onBatch } = {}) {
  const lang = langPack?.code
  // Accept SourceIngest manifests ({text}) and pipeline-native ({source}).
  const segs = (segments || [])
    .map((s) => ({ ...s, source: typeof s.source === 'string' ? s.source : typeof s.text === 'string' ? s.text : undefined }))
    .filter((s) => s && typeof s.source === 'string' && s.source.trim())
    .map((s, i) => ({ ...s, source: s.source }))
  if (!lang) throw new Error('translateSegments: langPack.code required')
  if (!langPack.translate) {
    return {
      segments: segs.map((s) => ({ ...s, text: s.source })),
      flags: segs.map((s) => ({ index: s.index, issues: [], names: extractNames(s.source) })),
      stats: { batches: 0, provider: 'passthrough', cached: 0, fresh: 0 },
    }
  }

  const BATCH = Math.max(1, Number(batchSize || process.env.I18N_BATCH_SIZE) || 6)
  const cache = readCache(lang)
  let fresh = 0
  let batchCount = 0
  const batches = []
  for (let k = 0; k < segs.length; k += BATCH) {
    batchCount++
    const slice = segs.slice(k, k + BATCH)
    const missing = slice.filter((s) => !cache[key(s.source)])
    let texts
    let provider = 'cache'
    if (!missing.length) {
      texts = slice.map((s) => cache[key(s.source)])
    } else {
      const ctxBefore = segs.slice(Math.max(0, k - 2), k).map((s) => s.source)
      const ctxAfter = segs.slice(k + BATCH, k + BATCH + 2).map((s) => s.source)
      // Retry loop shares translateStrings' providers order + 2 attempts,
      // but operates on THIS batch so one bad batch ≠ whole run failed.
      const order = process.env.I18N_PROVIDER_ORDER
        ? process.env.I18N_PROVIDER_ORDER.split(',')
        : ['gemini', 'openai-compat']
      const ATTEMPTS = 2
      const errors = []
      for (const providerK of order) {
        for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
          try {
            const segItems = missing.map((s) => ({ key: key(s.source), text: s.source }))
            const out = await callProviderContext(providerK, segItems, lang, ctxBefore, ctxAfter)
            if (out) {
              texts = out
              provider = providerK
              break
            }
            errors.push(`${providerK}: unusable output`)
          } catch (e) {
            errors.push(`${providerK}: ${e.message}`)
          }
          if (attempt < ATTEMPTS) await new Promise((r) => setTimeout(r, 3000))
        }
        if (texts) break
      }
      if (!texts) throw new Error(`LANG_TRANSLATE_FAILED (segments batch ${k / BATCH}): ${errors.join(' | ')}`)
      // Incremental persist: resume-safe after any later batch failure.
      missing.forEach((s, i) => { cache[key(s.source)] = texts[i] })
      fresh += missing.length
      writeCache(lang, cache)
      if (onBatch) await onBatch({ batchStart: k, done: k + missing.length, texts })
    }
    slice.forEach((s, i) => { batches.push({ ...s, text: texts[i] ?? '' }) })
  }

  // Post-gate fidelity per segment (never silently wrong).
  const flags = []
  for (const s of batches) {
    const numbers = Array.from(String(s.source || '').matchAll(/\d[\d,.%`]*/g)).map((m) => m[0])
    const missingNums = numbers.filter((n) => !String(s.text || '').includes(n))
    const issues = missingNums.length ? missingNums.map((n) => `number:${n} missing`) : []
    // Latin-remnant check (ta/si): words ≥3 letters that are neither source
    // names kept per the prompt rule nor the brand → untranslated fragment.
    // Evidence: flint cache reused a Tamil line embedding "366 million
    // dollars" verbatim — the workflow never publishes a silent half-English.
    if (['ta', 'si'].includes(lang)) {
      const allowed = new Set([...extractNames(s.source).map((w) => w.toLowerCase()), 'news', 'monster'])
      const latin = Array.from(new Set(String(s.text || '').match(/[A-Za-z]{3,}/g) || [])).filter((w) => !allowed.has(w.toLowerCase()))
      if (latin.length) issues.push(`untranslated:latin:${latin.join(',')}`)
    }
    flags.push({ index: s.index, issues, names: extractNames(s.source) })
  }
  return {
    segments: batches,
    flags,
    stats: {
      batches: batchCount,
      provider: 'mixed',
      cached: segs.length - fresh,
      fresh,
    },
  }
}

/** Capitalized tokens = review metadata (transliterated names can't be
 *  literal-matched against Tamil/Sinhala). Reported, not enforced. */
function extractNames(text) {
  const STOP = ['The', 'This', 'That', 'Where', 'What', 'Why', 'How', 'After', 'Before', 'Despite', 'Meanwhile', 'Conservative', 'Republican', 'Democratic', 'Party']
  const matched = (String(text || '').replace(/NEWS-MONSTER/gi, '').match(/(?<![.!?]\s)[A-Z][a-z]{2,}/g) || []).filter((w) => !STOP.includes(w))
  return Array.from(new Set(matched))
}

/** Context-aware prompt: context is read-only preamble, translation body is
 * the same bullet-form the providers validated live (flint echo quirk safe). */
function buildContextPrompt(items, langCode, ctxBefore = [], ctxAfter = []) {
  const target = SCRIPT_NAMES[langCode] || langCode
  const lines = [
    `Translate each line into ${target}.`,
    'This is broadcast narration for a news video: keep it natural, concise and spoken-language fluent.',
    'Rules:',
    '- Keep numbers, percentages, names and URLs unchanged.',
    '- Keep brand words like NEWS-MONSTER unchanged.',
    '- Never merge or split lines: output translated line i for input line i.',
    '- Output ONLY a JSON array of the translated strings, one element per input line, no numbering inside elements, no commentary, no markdown fence.',
  ]
  if (ctxBefore.length) {
    lines.push('', 'CONTEXT — earlier narration (for pronouns/meaning ONLY; do NOT translate or output it):')
    ctxBefore.forEach((c) => lines.push(`— ${c}`))
  }
  if (ctxAfter.length) {
    lines.push('', 'CONTEXT — following narration (for meaning ONLY; do NOT translate or output it):')
    ctxAfter.forEach((c) => lines.push(`— ${c}`))
  }
  lines.push('', 'TRANSLATE THESE LINES:')
  items.forEach((it) => lines.push(`- ${it.text}`))
  return lines.join('\n')
}

async function callProviderContext(kind, items, langCode, ctxBefore, ctxAfter) {
  const RAW = kind === 'gemini' ? await callGeminiContext(items, langCode, ctxBefore, ctxAfter) : await callOpenAICompatContext(items, langCode, ctxBefore, ctxAfter)
  if (!RAW) return null
  if (!validateOutput(items, RAW, langCode)) return null
  return RAW
}

async function callGeminiContext(items, langCode, ctxBefore, ctxAfter) {
  const apiKey = process.env.GEMINI_API_KEY
  if (!apiKey) return null
  const model = process.env.GEMINI_MODEL || 'gemini-2.5-flash'
  const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
    body: JSON.stringify({
      contents: [{ role: 'user', parts: [{ text: buildContextPrompt(items, langCode, ctxBefore, ctxAfter) }] }],
      generationConfig: { temperature: 0, maxOutputTokens: Number(process.env.I18N_MAX_TOKENS) || 16000 },
    }),
  })
  if (!r.ok) throw new Error(`gemini HTTP ${r.status}`)
  const j = await r.json()
  const parts = j?.candidates?.[0]?.content?.parts || []
  return extractJsonArray(parts.map((p) => p.text || '').join(''))
}

async function callOpenAICompatContext(items, langCode, ctxBefore, ctxAfter, { routerOverride = false } = {}) {
  const isRouter = routerOverride || (!!process.env.OPENROUTER_API_KEY && (!process.env.OPENAI_API_KEY || !!process.env.OPENROUTER_MODEL))
  const apiKey = process.env.OPENAI_API_KEY || process.env.OPENROUTER_API_KEY
  if (!apiKey) return null
  const base = process.env.OPENAI_BASE_URL || (isRouter ? 'https://openrouter.ai/api/v1' : 'https://api.openai.com/v1')
  const model = isRouter ? (process.env.OPENROUTER_MODEL || 'recursive/flint-v1.0:free') : (process.env.OPENAI_MODEL || 'gpt-4o-mini')
  const r = await fetch(`${base}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json; charset=utf-8', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model,
      temperature: 0,
      max_tokens: Number(process.env.I18N_MAX_TOKENS) || 16000,
      messages: [{ role: 'user', content: buildContextPrompt(items, langCode, ctxBefore, ctxAfter) }],
    }),
  })
  if (!r.ok) {
    // Honest provider failover: the primary OpenAI-compat endpoint rejected
    // us (billing/quota) but an OpenRouter key exists → retry once in router
    // mode with the configured free model. A 402 must never fail the whole
    // run when a usable provider is configured.
    if (!isRouter && routerOverride === false && process.env.OPENROUTER_API_KEY) {
      return await callOpenAICompatContext(items, langCode, ctxBefore, ctxAfter, { routerOverride: true })
    }
    throw new Error(`openai-compat HTTP ${r.status}`)
  }
  const j = await r.json()
  return extractJsonArray(j?.choices?.[0]?.message?.content)
}

/**
 * translateStrings(items=[{key,text}], langPack) → { key: translated }
 * Cache-first, provider-second, fail-visible.
 */
export async function translateStrings(items, langPack) {
  const lang = langPack.code
  if (!langPack.translate) return Object.fromEntries(items.map((it) => [it.key, it.text]))

  const cache = readCache(lang)
  const missing = items.filter((it) => !cache[key(it.text)])
  if (missing.length === 0) {
    return Object.fromEntries(items.map((it) => [it.key, cache[key(it.text)]]))
  }

  const providers = process.env.I18N_PROVIDER_ORDER
    ? process.env.I18N_PROVIDER_ORDER.split(',')
    : ['gemini', 'openai-compat']
  const errors = []
  let translated = null
  // Reasoning models (recursive/flint) are non-deterministic at temperature 0:
  // the same prompt can end finish:length → null content (observed) or emit a
  // valid array. Retry once per provider before moving on.
  const ATTEMPTS_PER_PROVIDER = 2
  for (const provider of providers) {
    for (let attempt = 1; attempt <= ATTEMPTS_PER_PROVIDER; attempt++) {
      try {
        const out = await callProvider(provider, missing, lang)
        if (out) { translated = out; break }
        errors.push(`${provider}: unusable output`)
      } catch (e) {
        errors.push(`${provider}: ${e.message}`)
      }
      if (attempt < ATTEMPTS_PER_PROVIDER) await new Promise((r) => setTimeout(r, 3000))
    }
    if (translated) break
  }
  if (!translated) {
    throw new Error(`LANG_TRANSLATE_FAILED: no provider produced valid ${SCRIPT_NAMES[lang] || lang} output (${errors.join(' | ')})`)
  }

  const result = {}
  for (let i = 0; i < missing.length; i++) {
    cache[key(missing[i].text)] = translated[i]
    result[missing[i].key] = translated[i]
  }
  writeCache(lang, cache)

  // Hydrate the already-cached remainder
  for (const it of items) {
    if (result[it.key] === undefined) result[it.key] = cache[key(it.text)]
  }
  return result
}

export const _internals = { buildPrompt, validateOutput, extractJsonArray } // exposed for tests
