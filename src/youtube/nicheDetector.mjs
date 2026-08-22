// Niche detection for auto thumbnails.
//
// Maps an article into a 1-word niche category that becomes the red pill in the
// generated thumbnail (e.g. TESLA, AI, APPLE, SPACE). Two modes:
//   * LLM mode  — pass `llm(text) => Promise<string>` to classify free-form.
//   * Heuristic — keyword scoring, zero dependencies, always available offline.
// The heuristic is also the normalizer/fallback for LLM output so the result is
// always one of `allowed` (uppercased) or 'TECH'.

export const KNOWN_NICHES = [
  'TESLA', 'AI', 'APPLE', 'SPACE', 'CRYPTO', 'STOCKS', 'TECH',
  'GAMING', 'POLITICS', 'SPORTS', 'CLIMATE', 'HEALTH', 'MUSIC', 'MOVIES',
]

const NICHE_KEYWORDS = {
  // First keyword is the CANONICAL entity — an exact mention short-circuits to
  // that niche so generic terms ("stock", "earnings") never override a real
  // subject ("Tesla stock ..." -> TESLA, not STOCKS).
  TESLA: ['tesla', 'elon musk', 'cybertruck', 'model s', 'model 3', 'model y', 'gigafactory', 'fsd'],
  AI: ['artificial intelligence', 'openai', 'chatgpt', 'gpt', 'llm', 'anthropic', 'machine learning', 'neural', 'gemini', 'claude'],
  APPLE: ['apple', 'iphone', 'ipad', 'macbook', 'macos', 'vision pro', 'tim cook', 'm_series', 'm1', 'm2', 'm3', 'm4'],
  SPACE: ['spacex', 'nasa', 'rocket', 'orbit', 'mars', 'moon', 'satellite', 'starship', 'blue origin'],
  CRYPTO: ['bitcoin', 'crypto', 'ethereum', 'btc', 'eth', 'solana', 'blockchain', 'defi', 'nft', 'stablecoin'],
  STOCKS: ['stock market', 'stocks', 's&p', 'nasdaq', 'dow jones', 'earnings', 'shares', 'equity', 'fed', 'interest rate'],
  GAMING: ['playstation', 'xbox', 'ps5', 'nintendo', 'switch 2', 'steam', 'gpu', 'rtx', 'gaming', 'game'],
  POLITICS: ['election', 'senate', 'congress', 'president', 'parliament', 'policy', 'bill', 'vote', 'government'],
  SPORTS: ['nfl', 'nba', 'fifa', 'world cup', 'championship', 'playoff', 'super bowl', 'premier league', 'match'],
  CLIMATE: ['climate', 'global warming', 'emissions', 'carbon', 'wildfire', 'hurricane', 'heatwave', 'extreme weather'],
  HEALTH: ['fda', 'covid', 'vaccine', 'virus', 'disease', 'drug', 'clinical', 'medical', 'health'],
  MUSIC: ['spotify', 'album', 'tour', 'billboard', 'single', 'concert', 'artist', 'band'],
  MOVIES: ['marvel', 'movie', 'film', 'box office', 'dc', 'netflix', 'disney', 'trailer', 'sequel'],
  TECH: ['technology', 'tech', 'software', 'startup', 'app', 'gadget', 'internet', 'chip', 'semiconductor'],
}

const ALIAS = {
  tesla: 'TESLA', artificialintelligence: 'AI', apple: 'APPLE', space: 'SPACE',
  crypto: 'CRYPTO', stocks: 'STOCKS', gaming: 'GAMING', politics: 'POLITICS',
  sports: 'SPORTS', climate: 'CLIMATE', health: 'HEALTH', music: 'MUSIC', movies: 'MOVIES',
  technology: 'TECH', tech: 'TECH',
}

function normalize(candidate, allowed = KNOWN_NICHES) {
  if (!candidate) return null
  const up = String(candidate).trim().toUpperCase().replace(/[^A-Z0-9]/g, '')
  const direct = allowed.find((n) => n === up)
  if (direct) return direct
  // tolerate a trailing plural / minor variance by stripping trailing S
  const loose = allowed.find((n) => n === up.replace(/S$/, ''))
  if (loose) return loose
  // keyword alias map (e.g. "artificialintelligence" -> AI)
  const key = String(candidate).trim().toLowerCase().replace(/[^a-z]/g, '')
  if (ALIAS[key]) return ALIAS[key]
  return null
}

function heuristicScore(text, allowed = KNOWN_NICHES) {
  const lower = ` ${String(text || '').toLowerCase()} `
  // 1) Canonical entity mention wins outright (specific subject over generic).
  for (const niche of allowed) {
    if (lower.includes(NICHE_KEYWORDS[niche][0])) return niche
  }
  // 2) Weighted keyword scoring fallback.
  const scores = {}
  for (const niche of allowed) {
    for (const kw of NICHE_KEYWORDS[niche] || []) {
      if (lower.includes(kw)) scores[niche] = (scores[niche] || 0) + (kw.length > 6 ? 2 : 1)
    }
  }
  let best = null, bestScore = 0
  for (const [n, s] of Object.entries(scores)) {
    if (s > bestScore) { bestScore = s; best = n }
  }
  return best
}

// detectNiche({ text, llm, allowed }) -> Promise<'TESLA' | ... | 'TECH'>
export async function detectNiche({ text, llm, allowed = KNOWN_NICHES } = {}) {
  if (llm) {
    try {
      const raw = await llm(String(text || ''))
      const norm = normalize(raw, allowed)
      if (norm) return norm
    } catch { /* fall through to heuristic */ }
  }
  return heuristicScore(text, allowed) || 'TECH'
}

// Render a 16:9 YouTube thumbnail (1280x720) with the niche shown as the red
// pill, then return the PNG as a Buffer ready for thumbnails.set. The niche is
// placed in the bottom accent badge (visible red pill) and also forwarded as
// `category` so a linked video frame inherits the same label.
export async function renderNicheThumbnail({ niche, headline = 'BREAKING NEWS', heroImage = null, outPath } = {}) {
  const { CoverComposer } = await import('../video-studio/CoverComposer.mjs')
  const fs = await import('fs')
  const os = await import('os')
  const path = await import('path')
  const tmp = outPath || path.join(os.tmpdir(), `nm-thumb-${Date.now()}-${Math.random().toString(36).slice(2)}.png`)
  const composer = new CoverComposer()
  await composer.composeThumbnail(
    {
      headline,
      accent_color: '#E10600',
      source_label: 'NEWS-MONSTER',
      mood: 'BREAKING',
      category: niche,
      text_overlay: { bottom: niche },
    },
    heroImage,
    tmp,
  )
  const buffer = fs.readFileSync(tmp)
  if (!outPath) fs.rmSync(tmp, { force: true })
  return { buffer, niche, headline }
}
