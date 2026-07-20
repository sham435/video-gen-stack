const API_KEY = process.env.NEWSAPI_KEY
if (!API_KEY) console.warn('NEWSAPI_KEY not set in .env')
const BASE = 'https://newsapi.org/v2'

export async function fetchTopHeadlines({ category, country = 'us', pageSize = 10 } = {}) {
  const params = new URLSearchParams({
    apiKey: API_KEY,
    country,
    pageSize: String(pageSize),
  })
  if (category) params.set('category', category)

  const res = await fetch(`${BASE}/top-headlines?${params}`)
  if (!res.ok) {
    const err = await res.text()
    throw new Error(`NewsAPI error (${res.status}): ${err}`)
  }
  const data = await res.json()
  return data.articles || []
}

export async function searchNews(query, { pageSize = 10, sortBy = 'publishedAt' } = {}) {
  const params = new URLSearchParams({
    apiKey: API_KEY,
    q: query,
    pageSize: String(pageSize),
    sortBy,
  })

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
