// Real-Time News Data provider (RapidAPI) — fallback between NewsData.io
// and NewsAPI. Budget: 3 req/day, 100 req/month enforced locally before
// any HTTP request is made. 429 responses are silently downgraded.

const BASE = 'https://real-time-news-data.p.rapidapi.com'
const KEY = process.env.RAPIDAPI_KEY
const TOPIC_ALIASES = {
  technology: 'TECHNOLOGY',
  business: 'BUSINESS',
  sports: 'SPORTS',
  science: 'SCIENCE',
  health: 'HEALTH',
  entertainment: 'ENTERTAINMENT',
  politics: 'WORLD',
  finance: 'BUSINESS',
  general: 'WORLD',
}

function normalize(result, category) {
  return {
    title: (result.title || '').trim(),
    source: result.source_name || result.source || 'Real-Time News',
    url: result.link || '',
    category: category || 'technology',
    description: result.snippet || '',
    imageUrl: result.photo_url || result.thumbnail_url || null,
    publishedAt: result.published_datetime_utc || null,
  }
}

export function isConfigured() {
  return Boolean(KEY)
}

export async function fetchTopHeadlines({ category = 'technology', country = 'US', lang = 'en', size = 3 } = {}) {
  if (!KEY) throw new Error('RAPIDAPI_KEY not set in .env')

  // Budget gate — skip before HTTP if daily/monthly exhausted
  const { canFetch, reserve } = await import('./RapidNewsBudget.mjs')
  const budget = canFetch()
  if (!budget.allowed) {
    return { articles: [], skipped: true, reason: budget.reason }
  }

  const topic = TOPIC_ALIASES[category] || 'TECHNOLOGY'
  const qs = new URLSearchParams({ topic, limit: String(Math.max(size, 5)), country, lang })
  const res = await fetch(`${BASE}/topic-headlines?${qs}`, {
    headers: {
      'x-rapidapi-key': KEY,
      'x-rapidapi-host': 'real-time-news-data.p.rapidapi.com',
    },
    signal: AbortSignal.timeout(10000),
  })
  if (res.status === 429) {
    return { articles: [], skipped: true, reason: 'PROVIDER_RATE_LIMIT' }
  }
  if (!res.ok) {
    const err = await res.text()
    throw new Error(`RapidNews error (${res.status}): ${err.slice(0, 200)}`)
  }
  reserve()
  const data = await res.json()
  const payload = data?.data
  const results = Array.isArray(payload) ? payload : (payload?.all_articles || [])
  return { articles: results.map(a => normalize(a, category)).slice(0, size) }
}