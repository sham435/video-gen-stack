const API_KEY = process.env.NEWSAPI_KEY
if (!API_KEY) console.warn('NEWSAPI_KEY not set in .env')
const BASE = 'https://newsapi.org/v2'

export async function fetchTopHeadlines({ category, country = 'us', pageSize = 10, sources } = {}) {
  const params = new URLSearchParams({
    apiKey: API_KEY,
    pageSize: String(pageSize),
  })
  if (sources) params.set('sources', sources)
  else {
    params.set('country', country)
    if (category) params.set('category', category)
  }

  const res = await fetch(`${BASE}/top-headlines?${params}`)
  if (!res.ok) {
    const err = await res.text()
    throw new Error(`NewsAPI error (${res.status}): ${err}`)
  }
  const data = await res.json()
  return data.articles || []
}

export async function searchNews(query, { pageSize = 10, sortBy = 'publishedAt', from, to, domains } = {}) {
  const params = new URLSearchParams({
    apiKey: API_KEY,
    pageSize: String(pageSize),
    sortBy,
  })
  if (query) params.set('q', query)
  if (domains) params.set('domains', domains)
  if (from) params.set('from', from)
  if (to) params.set('to', to)

  const res = await fetch(`${BASE}/everything?${params}`)
  if (!res.ok) {
    const err = await res.text()
    throw new Error(`NewsAPI error (${res.status}): ${err}`)
  }
  const data = await res.json()
  return data.articles || []
}

export function articlesToSummary(articles) {
  return articles.map((a, i) =>
    `${i + 1}. ${a.title}${a.description ? ` — ${a.description.slice(0, 120)}` : ''}`
  ).join('\n')
}
