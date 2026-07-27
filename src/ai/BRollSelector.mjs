const PEXELS_BASE = 'https://api.pexels.com/v1'

const VISUAL_MAP = {
  apple: ['iPhone', 'Apple technology', 'Apple product'],
  ios: ['iPhone', 'Apple software'],
  iphone: ['iPhone smartphone'],
  mac: ['MacBook Apple computer'],
  samsung: ['Samsung Galaxy', 'Samsung technology'],
  galaxy: ['Samsung Galaxy smartphone'],
  google: ['Google headquarters', 'Google technology'],
  pixel: ['Google Pixel smartphone'],
  microsoft: ['Microsoft headquarters', 'Microsoft technology'],
  windows: ['Windows PC computer'],
  meta: ['Meta headquarters', 'virtual reality'],
  facebook: ['social media app'],
  tesla: ['Tesla car', 'Tesla electric vehicle'],
  twitter: ['Twitter app', 'social media X'],
  openai: ['OpenAI office', 'artificial intelligence lab'],
  chatgpt: ['ChatGPT AI app', 'artificial intelligence'],
  gpt: ['artificial intelligence neural network'],
  nvidia: ['NVIDIA GPU chip', 'NVIDIA headquarters'],
  amazon: ['Amazon headquarters', 'Amazon technology'],
  aws: ['cloud computing data center'],
  ai: ['artificial intelligence neural network', 'AI robot futuristic'],
  robot: ['robot futuristic technology'],
  crypto: ['cryptocurrency Bitcoin'],
  bitcoin: ['Bitcoin cryptocurrency'],
  quantum: ['quantum computer futuristic'],
  space: ['space rocket launch', 'space exploration'],
  cybersecurity: ['cybersecurity technology digital lock'],
  chip: ['microchip processor technology'],
  phone: ['smartphone mobile technology'],
  car: ['car futuristic electric vehicle'],
  data: ['big data technology servers'],
  code: ['computer code programming screen'],
  app: ['mobile app smartphone screen'],
}

export class BRollSelector {
  constructor(pexelsKey) {
    this.pexelsKey = pexelsKey || process.env.PEXELS_API_KEY
  }

  async selectForArticle(article, onFetchImage) {
    const title = article.title || ''
    const keywords = this.extractVisualKeywords(title)

    let imageUrl = null

    for (const term of keywords) {
      imageUrl = await this.searchImage(term)
      if (imageUrl) break
    }

    if (!imageUrl && article.url && onFetchImage) {
      try {
        imageUrl = await onFetchImage(article)
      } catch {}
    }

    return imageUrl
  }

  extractVisualKeywords(title) {
    const lower = title.toLowerCase()
    const matched = []

    for (const [key, visuals] of Object.entries(VISUAL_MAP)) {
      if (lower.includes(key)) {
        matched.push(...visuals)
      }
    }

    if (matched.length === 0) {
      matched.push('technology news abstract', 'technology futuristic', 'digital innovation')
    }

    return matched.slice(0, 3)
  }

  async searchImage(query) {
    if (!this.pexelsKey) return null
    try {
      const resp = await fetch(
        `${PEXELS_BASE}/search?query=${encodeURIComponent(query)}&per_page=1&orientation=portrait`,
        {
          headers: { Authorization: this.pexelsKey },
          signal: AbortSignal.timeout(5000),
        }
      )
      if (!resp.ok) return null
      const data = await resp.json()
      if (data.photos?.[0]) {
        return data.photos[0].src.large2x || data.photos[0].src.large
      }
    } catch {}
    return null
  }
}
