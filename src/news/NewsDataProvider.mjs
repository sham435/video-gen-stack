// NewsData.io provider with a 3-hour fetch gap.
//
// The NewsData.io free plan credits every headline request, so we never call
// the API more than once per 3 hours for a given category. Within the window
// we serve cached results (in-memory); NewsAPI remains available as a
// fallback source when NEWS_DATA_KEY is unset or a fetch fails.

import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..', '..')
const CACHE_FILE = path.join(ROOT, 'data', 'newsdata-cache.json')

const GAP_MS = 3 * 60 * 60 * 1000 // 3 hours
const BASE = 'https://newsdata.io/api/1'
const KEY = process.env.NEWS_DATA_KEY

const cache = new Map() // category → { fetchedAt, articles }
let loaded = false

function loadCache() {
  if (loaded) return
  loaded = true
  try {
    if (fs.existsSync(CACHE_FILE)) {
      const raw = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf-8'))
      for (const [k, v] of Object.entries(raw)) cache.set(k, v)
    }
  } catch { /* corrupt cache is non-fatal */ }
}

function persistCache() {
  try {
    fs.mkdirSync(path.dirname(CACHE_FILE), { recursive: true })
    fs.writeFileSync(CACHE_FILE, JSON.stringify(Object.fromEntries(cache), null, 2))
  } catch { /* non-fatal */ }
}

function normalize(result) {
  return {
    title: (result.title || '').trim(),
    source: result.source_name || result.source || 'NewsData',
    url: result.link || '',
    category: (Array.isArray(result.category) ? result.category[0] : result.category) || 'technology',
    description: result.description || '',
    imageUrl: result.image_url || null,
    publishedAt: result.pubDate || null,
  }
}

export function isConfigured() {
  return Boolean(KEY)
}

async function request(path, params) {
  if (!KEY) throw new Error('NEWS_DATA_KEY not set in .env')
  const qs = new URLSearchParams(Object.entries(params).filter(([, v]) => v != null && v !== ''))
  qs.set('apikey', KEY)
  const res = await fetch(`${BASE}/${path}?${qs}`)
  if (!res.ok) {
    const err = await res.text()
    throw new Error(`NewsData error (${res.status}): ${err.slice(0, 200)}`)
  }
  const data = await res.json()
  const results = data.results || data.articles || []
  return results.map(normalize)
}

// Fetch latest headlines for a category, honoring the 3-hour gap per category.
// When the cache is fresh it is returned without touching the API.
export async function fetchTopHeadlines({ category = 'technology', language = 'en', country, size = 3, domainurl, force = false } = {}) {
  loadCache()
  const key = `${category}:${language}:${country || ''}`
  const now = Date.now()

  if (!force) {
    const hit = cache.get(key)
    if (hit && now - hit.fetchedAt < GAP_MS) {
      return hit.articles
    }
  }

  const params = {
    language,
    ...(country && { country }),
    ...(domainurl && { domainurl }),
    size: '10',
  }
  let articles = []
  try {
    articles = await request('latest', { ...params, category })
  } catch (err) {
    // On failure, serve stale cache if we have any rather than hard-fail.
    const hit = cache.get(key)
    if (hit) return hit.articles
    throw err
  }

  const distinct = []
  const seen = new Set()
  for (const a of articles) {
    const t = a.title
    if (!t || t.length < 20 || seen.has(t)) continue
    if (/\b(remove|delete|sponsor|sponsored)\b/i.test(t)) continue
    seen.add(t)
    distinct.push(a)
  }

  const result = distinct.slice(0, size)
  cache.set(key, { fetchedAt: now, articles: result })
  persistCache()
  return result
}

export function lastFetchAt(category = 'technology') {
  loadCache()
  const hit = cache.get(`${category}:en:`)
  return hit?.fetchedAt || null
}