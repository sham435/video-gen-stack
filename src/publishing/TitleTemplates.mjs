// TitleTemplates — centralized YouTube Short title formatting.
// Max 50 chars (Shorts feed tight), no branding suffix, emoji at START only.
//
// 4 pillar formulas:
//   Markets:  [Ticker] [Move] After [Trigger] - 30s Why
//   Breaking: 🚨 [What Happened] - [Impact] in 30s
//   Tech:     [Company] Just [Crazy Verb] - [Result]
//   Sports:   [Team/Player] [Score/Move] - 30s Brief

const MAX_TITLE = 50

const PILLAR_EMOJI = {
  markets:  '📈',
  breaking: '🚨',
  tech:     '⚡️',
  sports:   '⚡️',
  ai:       '🤖',
}

const PILLAR_KEYWORDS = {
  markets:  ['finance', 'stock', 'market', 'nasdaq', 's&p', 'bitcoin', 'btc', 'tesla', 'nvidia', 'earnings', 'revenue', 'ipo', 'trade', 'tariff', 'economy', 'inflation', 'interest rate', 'fed'],
  breaking: ['politics', 'government', 'election', 'president', 'congress', 'supreme court', 'executive order', 'impeach', 'democrat', 'republican'],
  tech:     ['technology', 'apple', 'google', 'microsoft', 'meta', 'amazon', 'spacex', 'tesla', 'smartphone', 'laptop', 'chip', 'software', 'hardware', 'launch'],
  sports:   ['nfl', 'nba', 'mlb', 'nhl', 'premier league', 'soccer', 'football', 'basketball', 'baseball', 'hockey', 'tennis', 'ufc', 'f1', 'formula 1', 'cricket', 'championship', 'playoff', 'super bowl', 'world cup'],
}

const AI_KEYWORDS = ['artificial intelligence', 'ai', 'llm', 'chatgpt', 'openai', 'claude', 'gemini', 'neural network', 'machine learning', 'deep learning', 'ai model', 'ai agent']

// ─── Pillar detection ──────────────────────────────────────────────────────

export function detectPillar(article = {}) {
  const text = `${(article.title || '').toLowerCase()} ${(article.description || '').toLowerCase()} ${(article.category || '').toLowerCase()}`

  // AI gets its own pillar with 🤖
  for (const kw of AI_KEYWORDS) {
    if (text.includes(kw)) return 'ai'
  }

  // Category hint: if article.category explicitly says sports/politics, respect it
  const cat = (article.category || '').toLowerCase()
  if (cat === 'sports') return 'sports'
  if (cat === 'politics') return 'breaking'
  if (cat === 'finance') return 'markets'

  let bestPillar = 'tech'
  let bestScore = 0
  for (const [pillar, keywords] of Object.entries(PILLAR_KEYWORDS)) {
    let score = 0
    for (const kw of keywords) {
      if (text.includes(kw)) score++
    }
    if (score > bestScore) { bestScore = score; bestPillar = pillar }
  }
  return bestPillar
}

// ─── Title formatting ──────────────────────────────────────────────────────

function truncate(text, max = MAX_TITLE) {
  if (text.length <= max) return text
  return text.slice(0, max - 1).trimEnd()
}

function extractNumbers(title = '') {
  const nums = title.match(/[\d.,]+[%$KMBkmb]?\b/g) || []
  return nums
}

function extractTicker(title = '') {
  const tickers = title.match(/\b([A-Z]{2,5})\b/g) || []
  const known = ['SPY', 'NASDAQ', 'DOW', 'S&P', 'BTC', 'ETH', 'TSLA', 'NVDA', 'AAPL', 'GOOGL', 'META', 'AMZN', 'MSFT', 'AMD', 'INTC', 'NFLX', 'COIN', 'TESLA', 'SPACEX', 'STARLINK', 'OPENAI']
  for (const t of tickers) {
    if (known.includes(t)) return t
  }
  // Fallback: check for known company names in title (mixed case)
  const lower = title.toLowerCase()
  const companyToTicker = { tesla: 'TSLA', spacex: 'SPACEX', apple: 'AAPL', google: 'GOOGL', microsoft: 'MSFT', meta: 'META', amazon: 'AMZN', nvidia: 'NVDA', openai: 'OPENAI' }
  for (const [name, ticker] of Object.entries(companyToTicker)) {
    if (lower.includes(name)) return ticker
  }
  return tickers[0] || ''
}

function extractCompany(title = '') {
  const companies = ['Tesla', 'SpaceX', 'Apple', 'Google', 'Microsoft', 'Meta', 'Amazon', 'Nvidia', 'Samsung', 'OpenAI', 'Nvidia', 'AMD', 'Intel', 'Netflix']
  for (const c of companies) {
    if (title.toLowerCase().includes(c.toLowerCase())) return c
  }
  return ''
}

function extractTeam(title = '') {
  const teams = ['Lakers', 'Warriors', 'Celtics', 'Chiefs', 'Eagles', 'Cowboys', 'Patriots', 'Arsenal', 'Chelsea', 'Liverpool', 'Man United', 'Barcelona', 'Real Madrid', 'Bayern', 'Dolphins', 'Bills', 'Ravens', 'Niners', 'Bucks', 'Heat', 'Nuggets', 'Mavericks']
  for (const t of teams) {
    if (title.toLowerCase().includes(t.toLowerCase())) return t
  }
  // Try NBA/NFL/Premier League patterns
  const teamMatch = title.match(/(?:NBA|NFL|MLB|NHL|Premier League)[:\s]+([A-Z][a-z]+(?:\s[A-Z][a-z]+)?)/)
  return teamMatch?.[1] || ''
}

// ─── Pillar-specific formatters ────────────────────────────────────────────

function formatMarkets(article) {
  const title = article.title || ''
  const ticker = extractTicker(title)
  const nums = extractNumbers(title)
  const move = nums.find(n => /[%$]/.test(n)) || nums[0] || ''

  // Formula: [Ticker] [Move] After [Trigger] - 30s Why
  if (ticker && move) {
    return truncate(`${ticker} ${move} After The Latest - 30s Why`)
  }
  // Fallback: just the move
  if (move) {
    return truncate(`Markets ${move} - Why It Matters in 30s`)
  }
  // Last resort: use title directly
  return truncate(`${title} - 30s Why`)
}

function formatBreaking(article) {
  const title = article.title || ''
  const emoji = PILLAR_EMOJI.breaking

  // Formula: 🚨 [What Happened] - [Impact] in 30s
  const cleaned = title
    .replace(/^(breaking|urgent|just in|developing)[:\s-]*/i, '')
    .replace(/\s*[-–—]\s*(latest|update|details|report|news).*/i, '')
    .trim()

  return truncate(`${emoji} ${cleaned} - What It Means`)
}

function formatTech(article) {
  const title = article.title || ''
  const company = extractCompany(title)
  const emoji = PILLAR_EMOJI.tech

  // Formula: [Company] Just [Crazy Verb] - [Result]
  if (company) {
    const after = title.split(new RegExp(company, 'i')).pop()?.trim() || ''
    const cleaned = after.replace(/^\s*(just|has|is|are|did| reportedly)\s*/i, '').trim()
    if (cleaned) {
      return truncate(`${company} ${cleaned} - Explained`)
    }
    return truncate(`${emoji} ${company} Made Moves - Explained`)
  }

  // Fallback: ⚡️ [Headline] - Explained
  return truncate(`${emoji} ${title} - Explained`)
}

function formatSports(article) {
  const title = article.title || ''
  const team = extractTeam(title)
  const emoji = PILLAR_EMOJI.sports

  // Formula: [Team/Player] [Score/Move] - 30s Brief
  if (team) {
    return truncate(`${emoji} ${team} - ${title.replace(/.*?:\s*/i, '').slice(0, 30)} - 30s Brief`)
  }

  return truncate(`${emoji} ${title} - 30s Brief`)
}

function formatAI(article) {
  const title = article.title || ''
  const emoji = PILLAR_EMOJI.ai

  // Formula: [Company] Just [Crazy Verb] - [Result] (reuse tech format with 🤖)
  const company = extractCompany(title)
  if (company) {
    const after = title.split(new RegExp(company, 'i')).pop()?.trim() || ''
    const cleaned = after.replace(/^\s*(just|has|is|are|did| reportedly)\s*/i, '').trim()
    if (cleaned) {
      return truncate(`${company} ${cleaned} - Explained`)
    }
  }

  return truncate(`${emoji} ${title} - Explained`)
}

// ─── Public API ────────────────────────────────────────────────────────────

const FORMATTERS = {
  markets: formatMarkets,
  breaking: formatBreaking,
  tech: formatTech,
  sports: formatSports,
  ai: formatAI,
}

/**
 * Format an article title into a YouTube Short title.
 * @param {object} article - { title, category, description }
 * @param {object} opts - { pillar } override (skip auto-detect)
 * @returns {string} max 50 chars, no branding suffix
 */
export function formatTitle(article, opts = {}) {
  const pillar = opts.pillar || detectPillar(article)
  const formatter = FORMATTERS[pillar] || FORMATTERS.tech
  const formatted = formatter(article)

  // Final guard: strip any accidental branding suffix
  return formatted
    .replace(/\|\s*(NEWS-MONSTER|NM|NEWS-MONS).*$/i, '')
    .replace(/NEWS-MONSTER/gi, '')
    .trim()
    .slice(0, MAX_TITLE)
}

/**
 * Get the emoji for a pillar.
 */
export function pillarEmoji(pillar) {
  return PILLAR_EMOJI[pillar] || PILLAR_EMOJI.tech
}

/**
 * Get the bar color for a pillar (used in thumbnail overlay).
 */
export function pillarColor(pillar) {
  const COLORS = {
    markets:  '#00C853',  // green
    breaking: '#E10600',  // red
    tech:     '#2979FF',  // blue
    sports:   '#FFD600',  // yellow
    ai:       '#2979FF',  // blue (same as tech)
  }
  return COLORS[pillar] || COLORS.tech
}

/**
 * Get the bar label for a pillar (used in thumbnail top tag).
 */
export function pillarLabel(pillar, article = {}) {
  const LABELS = {
    markets:  () => extractTicker(article.title) || 'MARKETS',
    breaking: () => 'BREAKING',
    tech:     () => extractCompany(article.title) || 'TECH',
    sports:   () => extractTeam(article.title) || (article.category || 'SPORTS').toUpperCase(),
    ai:       () => extractCompany(article.title) || 'AI',
  }
  const fn = LABELS[pillar] || LABELS.tech
  return fn().toUpperCase()
}

export { PILLAR_EMOJI, PILLAR_KEYWORDS, MAX_TITLE }
