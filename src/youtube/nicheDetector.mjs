// Niche detection for auto thumbnails.
//
// Legacy API: detectNiche({ text, llm, allowed }) returns a string ('TESLA', ...).
// Production API: import from nicheResolver.mjs which returns
//   { niche, confidence, source, reason, tier }.
//
// renderNicheThumbnail() lives here — it depends on CoverComposer.

// Re-export the production resolver's normalize for backward compat
export { normalize } from './nicheResolver.mjs'
export const KNOWN_NICHES = [
  'TESLA', 'AI', 'APPLE', 'SPACE', 'CRYPTO', 'STOCKS', 'TECH',
  'GAMING', 'POLITICS', 'SPORTS', 'CLIMATE', 'HEALTH', 'MUSIC', 'MOVIES',
]

const NICHE_KEYWORDS = {
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

function legacyNormalize(candidate, allowed = KNOWN_NICHES) {
  if (!candidate) return null
  const up = String(candidate).trim().toUpperCase().replace(/[^A-Z0-9]/g, '')
  const direct = allowed.find((n) => n === up)
  if (direct) return direct
  const loose = allowed.find((n) => n === up.replace(/S$/, ''))
  if (loose) return loose
  const key = String(candidate).trim().toLowerCase().replace(/[^a-z]/g, '')
  if (ALIAS[key]) return ALIAS[key]
  return null
}

function heuristicScore(text, allowed = KNOWN_NICHES) {
  const lower = ` ${String(text || '').toLowerCase()} `
  for (const niche of allowed) {
    if (lower.includes(NICHE_KEYWORDS[niche][0])) return niche
  }
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

// Legacy detectNiche — returns a string, not the full result object.
// New code should use nicheResolver.mjs detectNiche() instead.
export async function detectNiche({ text, llm, allowed = KNOWN_NICHES } = {}) {
  if (llm) {
    try {
      const raw = await llm(String(text || ''))
      const norm = legacyNormalize(raw, allowed)
      if (norm) return norm
    } catch { /* fall through to heuristic */ }
  }
  return heuristicScore(text, allowed) || 'TECH'
}

// Render a 16:9 YouTube thumbnail (1280x720) with the niche shown as the red
// pill, then return the PNG as a Buffer ready for thumbnails.set. The niche is
// placed in the bottom accent badge (visible red pill) and also forwarded as
// `category` so a linked video frame inherits the same label.
//
// When a `profile` is provided (from nicheProfiles.mjs), it is passed as
// `nicheProfile` to CoverComposer so the accent color and label come from the
// production profile rather than hardcoded defaults.
export async function renderNicheThumbnail({ niche, headline = 'BREAKING NEWS', heroImage = null, outPath, profile = null } = {}) {
  const { CoverComposer } = await import('../video-studio/CoverComposer.mjs')
  const fs = await import('fs')
  const os = await import('os')
  const path = await import('path')
  const tmp = outPath || path.join(os.tmpdir(), `nm-thumb-${Date.now()}-${Math.random().toString(36).slice(2)}.png`)
  const composer = new CoverComposer()
  const brief = {
    headline,
    accent_color: profile?.accent || '#E10600',
    source_label: 'NEWS-MONSTER',
    mood: 'BREAKING',
    category: niche,
    nicheProfile: profile || { label: niche, accent: '#E10600' },
    text_overlay: { bottom: niche },
  }
  await composer.composeThumbnail(brief, heroImage, tmp)
  const buffer = fs.readFileSync(tmp)
  if (!outPath) fs.rmSync(tmp, { force: true })
  return { buffer, niche, headline }
}
