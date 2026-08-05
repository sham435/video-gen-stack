/**
 * Pexels free stock photo integration for video backgrounds.
 * API docs: https://www.pexels.com/api/documentation/
 * Free tier: 200 requests/hour, 20k images/month.
 *
 * Visual Diversity — every upload should get a distinct look:
 *  - 20 candidates per query (up from 5)
 *  - candidates are shuffled with a slot-seeded PRNG so consecutive
 *    30-minute windows walk the result set in different orders
 *  - a persistent recently-used memory (data/pexels-used.json, cached across
 *    CI runs) rejects photos used in the last 48h, so no two videos within a
 *    day reuse the same hero image even for identical search terms
 *  - generic headlines rotate through themed fallback queries instead of all
 *    hitting the same "technology news abstract" result set
 */

import { readFileSync, writeFileSync, existsSync } from 'fs'
import path from 'path'

const PEXELS_BASE = 'https://api.pexels.com/v1'
const USED_FILE = path.resolve(process.cwd(), 'data', 'pexels-used.json')
const USED_TTL_MS = 48 * 60 * 60 * 1000
const USED_MAX = 400
const FALLBACK_QUERIES = [
  'technology news abstract',
  'futuristic technology city skyline',
  'artificial intelligence robot concept',
  'digital data network innovation',
  'science laboratory research',
  'business finance stock market graph',
]

function loadUsed() {
  try {
    if (existsSync(USED_FILE)) return JSON.parse(readFileSync(USED_FILE, 'utf-8'))
  } catch { /* first run */ }
  return {}
}

function saveUsed(used) {
  try { writeFileSync(USED_FILE, JSON.stringify(used, null, 2)) } catch { /* best-effort */ }
}

function pruneUsed(used) {
  const now = Date.now()
  for (const [url, ts] of Object.entries(used)) {
    if (now - ts > USED_TTL_MS) delete used[url]
  }
  const urls = Object.keys(used)
  if (urls.length > USED_MAX) {
    for (const url of urls.slice(0, urls.length - USED_MAX)) delete used[url]
  }
  return used
}

// Deterministic shuffle (mulberry32 seeded PRNG) — same slot always yields the
// same order, different slots yield different orders. This breaks the old
// `slot % length` pattern where consecutive videos stepped predictably.
function seededShuffle(arr, seed) {
  let s = (seed >>> 0) || 1
  const rnd = () => {
    s = (s + 0x6D2B79F5) >>> 0
    let t = s
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
  const a = [...arr]
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

function photoUrl(photo) {
  return photo?.src?.large2x || photo?.src?.large || photo?.src?.original || photo?.url || ''
}

/**
 * Shared visual-diversity selector — used by the video hero AND the cover
 * generator so every upload gets a distinct photo:
 *  1. candidates are shuffled with a slot-seeded PRNG
 *  2. any photo used in the last 48h (data/pexels-used.json) is rejected
 *  3. the pick is recorded so the NEXT upload skips it too
 * Returns the selected photo object or null when the pool is empty.
 */
export function pickDistinctPhoto(photos, slot = Math.floor(Date.now() / (30 * 60 * 1000))) {
  if (!photos?.length) return null
  const ordered = seededShuffle(photos, slot)
  const used = loadUsed()
  const pool = ordered.filter(p => !used[photoUrl(p)])
  const photo = (pool.length ? pool : ordered)[0]
  pruneUsed(used)
  used[photoUrl(photo)] = Date.now()
  saveUsed(used)
  return photo
}

/**
 * Fetch a relevant stock photo based on article title keywords.
 * Returns { imageUrl, photographer, pexelsUrl } or null.
 */
export async function fetchPexelsImage(title, keywords = []) {
  const apiKey = process.env.PEXELS_API_KEY
  if (!apiKey) {
    console.log('ℹ️  No PEXELS_API_KEY set, skipping stock photo')
    return null
  }

  // Build search query from title keywords + fallback terms
  const slot = Math.floor(Date.now() / (30 * 60 * 1000))
  const searchTerms = buildSearchQuery(title, keywords, slot)
  const query = encodeURIComponent(searchTerms)

  try {
    const resp = await fetch(`${PEXELS_BASE}/search?query=${query}&per_page=20&orientation=landscape`, {
      headers: { 'Authorization': apiKey },
      signal: AbortSignal.timeout(8000),
    })
    if (!resp.ok) {
      console.log(`⚠️  Pexels API error (${resp.status})`)
      return null
    }
    const data = await resp.json()
    const photos = data.photos || []
    if (photos.length) {
      const photo = pickDistinctPhoto(photos)
      if (!photo) {
        console.log(`📭 No Pexels result for: "${searchTerms}"`)
        return null
      }
      const url = photoUrl(photo)
      console.log(`📸 Pexels: "${searchTerms}" → ${url} (shuffle ${slot % 7}/${photos.length})`)
      return {
        imageUrl: url,
        photographer: photo.photographer,
        pexelsUrl: photo.url,
      }
    }
    console.log(`📭 No Pexels result for: "${searchTerms}"`)
    return null
  } catch (e) {
    console.log(`⚠️  Pexels fetch error: ${e.message}`)
    return null
  }
}

/**
 * Extract meaningful search keywords from article title.
 * Strips stop words, keeps brand names and key terms.
 * Fallback queries rotate by 30-minute slot so generic headlines don't all
 * reuse the identical "technology news abstract" result set.
 */
function buildSearchQuery(title, extraKeywords = [], slot = 0) {
  const stopWords = new Set([
    'the', 'a', 'an', 'is', 'are', 'was', 'were', 'to', 'of', 'in',
    'for', 'on', 'and', 'or', 'but', 'this', 'that', 'with', 'from',
    'its', 'has', 'had', 'have', 'not', 'will', 'new', 'how', 'why',
  ])

  // Extract meaningful words from title
  const words = title
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length > 3 && !stopWords.has(w))

  // Brand/keyword detection for better search results
  const brandMap = {
    apple: 'iPhone technology',
    ios: 'iPhone technology',
    samsung: 'Galaxy smartphone',
    galaxy: 'Galaxy smartphone',
    google: 'Google technology',
    microsoft: 'Microsoft technology',
    meta: 'Meta technology',
    tesla: 'Tesla car electric',
    twitter: 'social media app',
    xbox: 'Xbox gaming console',
    playstation: 'PlayStation gaming console',
    nintendo: 'Nintendo gaming',
    ai: 'artificial intelligence technology',
    crypto: 'cryptocurrency Bitcoin',
    bitcoin: 'cryptocurrency Bitcoin',
    iphone: 'iPhone smartphone',
    pixel: 'Google Pixel smartphone',
  }

  for (const [brand, mapped] of Object.entries(brandMap)) {
    if (words.includes(brand)) {
      const brandIdx = words.indexOf(brand)
      // Replace brand word with mapped terms
      words.splice(brandIdx, 1, ...mapped.split(' '))
      break
    }
  }

  // Take top 3-4 meaningful keywords + extra
  const allKeywords = [...new Set([...words, ...extraKeywords])]
  const bestTerms = allKeywords.slice(0, 4)

  if (bestTerms.length === 0) return FALLBACK_QUERIES[slot % FALLBACK_QUERIES.length]
  return bestTerms.join(' ')
}

/**
 * Try Pexels first, then fall back to OG image scraper.
 */
export async function fetchBestImage(article) {
  // 1. Try Pexels if we have an API key
  if (process.env.PEXELS_API_KEY) {
    const pexels = await fetchPexelsImage(article.title || '', [article.source || ''])
    if (pexels?.imageUrl) {
      article.imageUrl = pexels.imageUrl
      article.imageCredit = `📸 ${pexels.photographer} (Pexels)`
      article.imageSource = 'pexels'
      return true
    }
  }

  // 2. Try OG image from article URL
  if (article.url) {
    try {
      const { result } = await (
        await import('open-graph-scraper')
      ).default({ url: article.url, timeout: 8000, headers: { 'user-agent': 'Mozilla/5.0' } })
      if (result.ogImage?.[0]?.url) {
        article.imageUrl = result.ogImage[0].url
        article.imageSource = 'og'
        return true
      }
    } catch {}
  }

  return false
}
