// FOSS (free-and-open-source-licensed) model filtering.
//
// The provider chain must NEVER use paid models, and the operator requires
// FOSS (open-weights / open-license) models only. `:free` OpenRouter endpoints
// can point at proprietary models (e.g. openai/gpt-4o-mini:free free tier), so
// a cost filter alone is insufficient.
//
// Strategy: strict-by-default marker matching.
//   - Named proprietary families (by id substring) are DENIED first.
//   - Known open-weight families are ALLOWED.
//   - Anything unrecognized is EXCLUDED (strict) — never selected.
//
// Matching operates on the model id (lowercased) so it works identically for
// harvest-free id lists (`gemma-4-26b-a4b-it:free`), full prefixed ids
// (`google/gemma-4-26b-a4b-it:free`), and registry keys
// (`deepseek-v4-flash-free`, `qwen3.6-plus-free`).

// Known closed/proprietary families — denied even if other markers match.
const NON_FOSS_MARKERS = [
  /\bgpt-\d/, /\bgpt-4o/, /\bgpt-5/, // OpenAI (gpt-oss IS open, allowed below)
  /\bo[1-9]\b/i, /\bopenai\b/i, /\bchatgpt\b/i,
  /\bclaude\b/i, /\banthropic\b/i,
  /\bgemini\b/i, /\bgoogle\/(?!gemma)/i,
  /\bminimax\b/i, /\bbig-pickle\b/i, /\bnorth-mini\b/i, /\bnorth\b\s?code/i,
  /\bglm\b/i, // Zhipu GLM on OpenRouter is API-served; not open weights
  /\bgrok\b/i, /\bx-ai\b/i,
  /\bcommand\b/i, /\bcohere\b/i,
  /\bjamba\b/i, /\bai21\b/i,
  /\bqwen-(max|plus|turbo)\b/i, // Qwen API-only tiers — closed weights
  /\bmoonshot\b/i, /\bkimi\b/i, /\bnova\b/i, /\bamazon\b/i,
  /\bmistral-(large|medium|next|codestral)\b/i, // closed Mistral tiers
  /\bpalm\b/i, /\bvertex\b/i, /\baya\b/i,
]

// Known open-weight families — allowed.
const FOSS_MARKERS = [
  /\bgpt-oss\b/i,          // OpenAI's open-weights model (MIT) — explicitly allowed
  /\bllama\b/i,            // Meta Llama (open weights)
  /\bqwen/i,               // Alibaba Qwen (Apache 2.0) — qwen3, qwen2.5, qwen-max are closed
  /\bgemma\b/i,            // Google Gemma (open weights)
  /\bdeepseek\b/i,         // DeepSeek (MIT)
  /\bmixtral\b/i,          // Mistral open mixture (Apache)
  /\bmistral-(7b|small)\b/i, // open Mistral variants (Apache)
  /\bnemotron\b/i,         // NVIDIA Nemotron (open license)
  /\bdevstral\b/i,         // Mistral Devstral (Apache)
  /\bphi\b/i,              // Microsoft Phi (MIT)
  /\bolmo\b/i,             // Allen AI OLMo (Apache)
  /\bgranite\b/i,          // IBM Granite (Apache)
  /\bfalcon\b/i,           // TII Falcon (Apache)
  /\byi-?\d/i,             // 01.AI Yi (Apache)
  /\bzephyr\b/i,           // H4 Zephyr (MIT)
  /\bdolphin\b/i,          // Cognitive Computations Dolphin (MIT/Apache)
  /\bsolar\b/i,            // Upstage SOLAR (Apache)
  /\bopenchat\b/i,         // OpenChat (Apache)
  /\bhermes\b/i,           // Nous Research Hermes (Apache)
  /\bminicpm\b/i,          // OpenBMB MiniCPM (Apache/MIT)
  /\bstarcoder\b/i,        // BigCode StarCoder (Apache)
  /\bcodegeex\b/i,         // CodeGeeX (Apache)
  /\bbge-\b/i,             // BGE embeddings (MIT)
  /\bcevian\b/i,           // Cevian (Apache)
  /\bt5\b/i,               // T5 (Apache)
]

/**
 * Whether the model id is FOSS-eligible.
 * Deny-list first, then allow-list; unrecognized ids → false (strict).
 */
export function isFossModelId(id) {
  if (!id) return false
  const s = String(id).toLowerCase()
  if (NON_FOSS_MARKERS.some(re => re.test(s))) return false
  return FOSS_MARKERS.some(re => re.test(s))
}

/** Filter a list of model ids to FOSS-eligible entries. */
export function filterFossModels(models) {
  return models.filter(isFossModelId)
}