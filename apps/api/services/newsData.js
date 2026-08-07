// NewsData.io provider — companion news source alongside NewsAPI.
// Reads NEWS_DATA_KEY from .env. Returns articles normalized to the same
// shape NewsAPI returns ({ title, source, url, category, description }).
//
//   newsData.latest({ category, language = 'en', country, size })   → GET /api/1/latest
//   newsData.search({ q, category, language, sentiment, fromDate, size })
//
// Base docs: https://newsdata.io/docs

const API_KEY = process.env.NEWS_DATA_KEY
const BASE = 'https://newsdata.io/api/1'

function normalize(result) {
  return {
    title: (result.title || '').trim(),
    source: result.source_name || result.source || 'NewsData',
    url: result.link || '',
    category: (result.category && result.category[0]) || 'technology',
    description: result.description || '',
    imageUrl: result.image_url || null,
    publishedAt: result.pubDate || null,
  }
}

export function isConfigured() {
  return Boolean(API_KEY)
}

async function request(path, params) {
  if (!API_KEY) throw new Error('NEWS_DATA_KEY not set in .env')
  const qs = new URLSearchParams(Object.entries(params).filter(([, v]) => v != null && v !== ''))
  qs.set('apikey', API_KEY)
  const res = await fetch(`${BASE}/${path}?${qs}`)
  if (!res.ok) {
    const err = await res.text()
    throw new Error(`NewsData error (${res.status}): ${err.slice(0, 200)}`)
  }
  const data = await res.json()

  // NewsData returns { status, totalResults, results }. NewsAPI-crypto style
  // endpoints may nest under a different key; mirror the common shape.
  const results = data.results || data.articles || []
  return results.map(normalize)
}

export async function latest({ language = 'en', country, category, domainurl, size = 10 } = {}) {
  return request('latest', {
    language,
    ...(country && { country }),
    ...(category && { category }),
    ...(domainurl && { domainurl }),
    size: String(size),
  })
}

export async function search({ query, category, sentiment, language = 'en', size = 10 } = {}) {
  return request('latest', {
    ...(query && { q: query }),
    ...(category && { category }),
    ...(sentiment && { sentiment }),
    language,
    size: String(size),
  })
}

// Shortcut: latest tech headlines (mirrors the composer default path).
export async function fetchTopHeadlines({ category = 'technology', language = 'en', country, size = 3, domain } = {}) {
  return latest({ category, language, country, domain, size })
}