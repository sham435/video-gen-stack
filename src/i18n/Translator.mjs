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

async function callOpenAICompat(items, langCode) {
  const isRouter = !!process.env.OPENROUTER_API_KEY && !process.env.OPENAI_API_KEY
  const apiKey = process.env.OPENAI_API_KEY || process.env.OPENROUTER_API_KEY
  if (!apiKey) return null
  const base = process.env.OPENAI_BASE_URL || (isRouter ? 'https://openrouter.ai/api/v1' : 'https://api.openai.com/v1')
  const model = isRouter
    ? (process.env.OPENROUTER_MODEL || 'google/gemini-2.0-flash-001')
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
  if (!r.ok) throw new Error(`openai-compat HTTP ${r.status}`)
  const j = await r.json()
  return extractJsonArray(j?.choices?.[0]?.message?.content)
}

async function callProvider(kind, items, langCode) {
  const out = kind === 'gemini' ? await callGemini(items, langCode) : await callOpenAICompat(items, langCode)
  if (!out) return null
  return validateOutput(items, out, langCode) ? out : null
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
  for (const provider of providers) {
    try {
      const out = await callProvider(provider, missing, lang)
      if (out) { translated = out; break }
      errors.push(`${provider}: unusable output`)
    } catch (e) {
      errors.push(`${provider}: ${e.message}`)
    }
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
