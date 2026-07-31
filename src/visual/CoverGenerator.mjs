import { CoverConceptEngine } from './CoverConceptEngine.mjs'
import { CoverRenderer } from './CoverRenderer.mjs'

const PEXELS = 'https://api.pexels.com/v1/search'

export class CoverGenerator {
  constructor(aiProvider = null, options = {}) {
    this.ai = aiProvider
    this.conceptEngine = new CoverConceptEngine(aiProvider)
    this.renderer = new CoverRenderer()
    this.cacheDir = options.cacheDir || 'cache/covers'
  }

  async generate(article, outPath, options = {}) {
    const concept = await this.conceptEngine.generate(article, options)
    const heroImage = await this.resolveHero(article, concept)
    return this.renderer.render({ ...concept, heroImage }, article, outPath)
  }

  async resolveHero(article, concept) {
    const category = (article.category || 'technology').toLowerCase()
    const keywords = concept.visualKeywords || [concept.subject]

    // Category-strategy: gaming/product → stock photo of the subject
    for (const kw of keywords) {
      const url = await this.searchPexels(kw)
      if (url) return url
    }
    return null
  }

  async searchPexels(query) {
    const key = process.env.PEXELS_API_KEY
    if (!key) return null
    try {
      const res = await fetch(`${PEXELS}?query=${encodeURIComponent(query)}&per_page=3&orientation=portrait`, {
        headers: { Authorization: key },
        signal: AbortSignal.timeout(5000),
      })
      if (!res.ok) return null
      const data = await res.json()
      return data.photos?.[0]?.src?.large2x || data.photos?.[0]?.src?.large || null
    } catch { return null }
  }
}
