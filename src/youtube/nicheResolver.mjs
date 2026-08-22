// Production niche resolver — the single source of truth for niche classification.
//
// Design:
//   1. Canonical set of niches (closed — no arbitrary LLM text leaks through)
//   2. Returns { niche, confidence, source, reason } — not just a string
//   3. Confidence policy: ≥0.80 auto-accept, 0.60-0.79 low-confidence tag, <0.60 → GENERAL
//   4. normalize() maps any input to a canonical niche or null
//   5. detectNiche() is the full resolver: explicit category > LLM > heuristic > GENERAL

export const NICHES = [
  'TESLA', 'APPLE', 'AI', 'SAMSUNG', 'GOOGLE', 'MICROSOFT',
  'SPACE', 'GAMING', 'CRYPTO', 'GENERAL',
]

// Extended keyword map — covers both canonical and legacy niches for
// backward compatibility. NicheResolver maps legacy → canonical.
const NICHE_KEYWORDS = {
  TESLA:     ['tesla', 'elon musk', 'cybertruck', 'model s', 'model 3', 'model y', 'gigafactory', 'fsd', 'starlink'],
  APPLE:     ['apple', 'iphone', 'ipad', 'macbook', 'macos', 'vision pro', 'tim cook', 'm_series', 'm1', 'm2', 'm3', 'm4', 'apple intelligence'],
  AI:        ['artificial intelligence', 'openai', 'chatgpt', 'gpt', 'llm', 'anthropic', 'machine learning', 'neural', 'gemini', 'claude', 'deepseek', 'copilot', 'ai agent'],
  SAMSUNG:   ['samsung', 'galaxy', 'exynos', 'one ui'],
  GOOGLE:    ['google', 'alphabet', 'youtube', 'waymo', 'deepmind', 'android', 'pixel'],
  MICROSOFT: ['microsoft', 'windows', 'azure', 'xbox', 'surface', 'copilot', 'github'],
  SPACE:     ['spacex', 'nasa', 'rocket', 'orbit', 'mars', 'moon', 'satellite', 'starship', 'blue origin', 'boeing starliner'],
  GAMING:    ['playstation', 'xbox', 'ps5', 'nintendo', 'switch 2', 'steam', 'gpu', 'rtx', 'gaming', 'game', 'nvidia', 'amd', 'radeon'],
  CRYPTO:    ['bitcoin', 'crypto', 'ethereum', 'btc', 'eth', 'solana', 'blockchain', 'defi', 'nft', 'stablecoin'],
  // Legacy niches that map to GENERAL or a canonical niche:
  STOCKS:    ['stock market', 'stocks', 's&p', 'nasdaq', 'dow jones', 'earnings', 'shares', 'equity', 'fed', 'interest rate'],
  POLITICS:  ['election', 'senate', 'congress', 'president', 'parliament', 'policy', 'bill', 'vote', 'government'],
  SPORTS:    ['nfl', 'nba', 'fifa', 'world cup', 'championship', 'playoff', 'super bowl', 'premier league', 'match'],
  CLIMATE:   ['climate', 'global warming', 'emissions', 'carbon', 'wildfire', 'hurricane', 'heatwave', 'extreme weather'],
  HEALTH:    ['fda', 'covid', 'vaccine', 'virus', 'disease', 'drug', 'clinical', 'medical', 'health'],
  TECH:      ['technology', 'tech', 'software', 'startup', 'app', 'gadget', 'internet', 'chip', 'semiconductor'],
}

// Legacy → canonical mapping (STOCKS → GENERAL, POLITICS → GENERAL, etc.)
const LEGACY_MAP = {
  STOCKS: 'GENERAL', POLITICS: 'GENERAL', SPORTS: 'GENERAL',
  CLIMATE: 'GENERAL', HEALTH: 'GENERAL', MUSIC: 'GENERAL',
  MOVIES: 'GENERAL', TECH: 'GENERAL',
}

// Canonical entity first-keyword short-circuit (specific > generic)
const CANONICAL_FIRST = {}
for (const niche of NICHES) {
  if (NICHE_KEYWORDS[niche]) CANONICAL_FIRST[niche] = NICHE_KEYWORDS[niche][0]
}

// ─── normalize ───────────────────────────────────────────────────────────────
// Map any input string to a canonical niche or null.
export function normalize(candidate) {
  if (!candidate) return null
  const raw = String(candidate).trim()
  const up = raw.toUpperCase().replace(/[^A-Z0-9]/g, '')
  // Direct canonical match
  if (NICHES.includes(up)) return up
  // Strip trailing plural
  const stripped = up.replace(/S$/, '')
  if (NICHES.includes(stripped)) return stripped
  // Legacy → canonical
  if (LEGACY_MAP[up]) return LEGACY_MAP[up]
  // Case-insensitive alias (e.g. "artificialintelligence" → AI)
  const key = raw.toLowerCase().replace(/[^a-z]/g, '')
  for (const [niche, keywords] of Object.entries(NICHE_KEYWORDS)) {
    const canonical = LEGACY_MAP[niche] || niche
    if (keywords.some(kw => kw.replace(/[^a-z]/g, '') === key)) return canonical
  }
  return null
}

// ─── heuristicScore ──────────────────────────────────────────────────────────
// Weighted keyword scoring with canonical entity short-circuit.
// Returns { niche, confidence, reason }
function heuristicScore(text) {
  const lower = ` ${String(text || '').toLowerCase()} `
  // 1) Canonical entity mention wins outright
  for (const niche of NICHES) {
    const firstKw = NICHE_KEYWORDS[niche]?.[0]
    if (firstKw && lower.includes(firstKw)) {
      return { niche, confidence: 0.95, reason: `canonical entity "${firstKw}"` }
    }
  }
  // 2) Weighted scoring
  const scores = {}
  const reasons = {}
  for (const [niche, keywords] of Object.entries(NICHE_KEYWORDS)) {
    const canonical = LEGACY_MAP[niche] || niche
    for (const kw of keywords) {
      if (lower.includes(kw)) {
        const weight = kw.length > 6 ? 2 : 1
        scores[canonical] = (scores[canonical] || 0) + weight
        if (!reasons[canonical]) reasons[canonical] = []
        reasons[canonical].push(kw)
      }
    }
  }
  let best = null, bestScore = 0
  for (const [n, s] of Object.entries(scores)) {
    if (s > bestScore) { bestScore = s; best = n }
  }
  if (!best) {
    return { niche: 'GENERAL', confidence: 0.3, reason: 'no keyword match' }
  }
  // Confidence from score density: more keywords matched = higher confidence
  const maxPossible = (NICHE_KEYWORDS[Object.keys(scores).find(k => LEGACY_MAP[k] === best || k === best)] || []).length * 2
  const ratio = bestScore / Math.max(maxPossible, 1)
  const confidence = Math.min(0.92, 0.60 + ratio * 0.35)
  return { niche: best, confidence: Math.round(confidence * 100) / 100, reason: reasons[best]?.join(', ') || 'keyword match' }
}

// ─── confidencePolicy ────────────────────────────────────────────────────────
// Apply the production confidence policy:
//   ≥ 0.80 → accept (high confidence)
//   0.60–0.79 → accept + tag as low-confidence
//   < 0.60 → fall back to GENERAL
export function applyConfidencePolicy(result) {
  const { niche, confidence, source, reason } = result
  if (confidence >= 0.80) {
    return { niche, confidence, source, reason, tier: 'high' }
  }
  if (confidence >= 0.60) {
    return { niche, confidence, source, reason, tier: 'low' }
  }
  return { niche: 'GENERAL', confidence: Math.max(confidence, 0.3), source, reason: `${reason} (below threshold, fallback GENERAL)`, tier: 'fallback' }
}

// ─── detectNiche ─────────────────────────────────────────────────────────────
// The production niche resolver. Returns a full detection result:
//   { niche, confidence, source, reason, tier }
//
// Resolution order:
//   1. Explicit category on the article (normalized)
//   2. LLM classification (if llm function provided)
//   3. Heuristic keyword scoring
//   4. GENERAL fallback
export async function detectNiche({ text, category, llm } = {}) {
  // 1. Explicit category — highest confidence
  if (category) {
    const norm = normalize(category)
    if (norm) {
      return applyConfidencePolicy({
        niche: norm, confidence: 0.99, source: 'explicit', reason: `article.category = "${category}"`,
      })
    }
  }

  // 2. LLM classification
  if (llm) {
    try {
      const raw = await llm(String(text || ''))
      const norm = normalize(raw)
      if (norm) {
        return applyConfidencePolicy({
          niche: norm, confidence: 0.88, source: 'ai', reason: `LLM classified as "${raw}"`,
        })
      }
    } catch { /* fall through to heuristic */ }
  }

  // 3. Heuristic keyword scoring
  const heuristic = heuristicScore(text)
  return applyConfidencePolicy({ ...heuristic, source: 'heuristic' })
}

// ─── ProductionContext ────────────────────────────────────────────────────────
// Build the normalized production context that every downstream stage consumes.
export function buildProductionContext({ article, nicheResult, videoId, assets = {} }) {
  return {
    articleId: article?.id || article?.headline?.slice(0, 40) || `run-${Date.now()}`,
    niche: {
      key: nicheResult.niche,
      source: nicheResult.source,
      confidence: nicheResult.confidence,
      tier: nicheResult.tier,
      reason: nicheResult.reason,
    },
    assets: {
      cover: assets.cover || null,
      thumbnail: assets.thumbnail || null,
      video: assets.video || null,
    },
    publishing: {
      youtube: {
        uploaded: false,
        thumbnailUploaded: false,
        videoId: videoId || null,
      },
    },
  }
}
