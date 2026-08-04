/**
 * Pexels free stock photo integration for video backgrounds.
 * API docs: https://www.pexels.com/api/documentation/
 * Free tier: 200 requests/hour, 20k images/month.
 */

const PEXELS_BASE = 'https://api.pexels.com/v1'

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
  const searchTerms = buildSearchQuery(title, keywords)
  const query = encodeURIComponent(searchTerms)

  try {
    const resp = await fetch(`${PEXELS_BASE}/search?query=${query}&per_page=5&orientation=landscape`, {
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
      // Rotate through the top-5 results so consecutive videos get fresh
      // images — index derived from the 30-minute publish slot.
      const slot = Math.floor(Date.now() / (30 * 60 * 1000))
      const photo = photos[slot % photos.length]
      console.log(`📸 Pexels: "${searchTerms}" → ${photo.src.large2x || photo.src.large} (rotation ${slot % photos.length}/${photos.length})`)
      return {
        imageUrl: photo.src.large2x || photo.src.large,
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
 */
function buildSearchQuery(title, extraKeywords = []) {
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

  if (bestTerms.length === 0) return 'technology news abstract'
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
