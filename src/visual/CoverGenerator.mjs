import { CoverConceptEngine } from './CoverConceptEngine.mjs'
import { CoverRenderer } from './CoverRenderer.mjs'
import fs from 'fs'
import path from 'path'

const PEXELS = 'https://api.pexels.com/v1/search'

function hashCode(s) {
  let h = 0
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0
  return h
}

export class CoverGenerator {
  constructor(aiProvider = null, options = {}) {
    this.ai = aiProvider
    this.conceptEngine = new CoverConceptEngine(aiProvider)
    this.renderer = new CoverRenderer()
    this.cacheDir = options.cacheDir || 'cache/covers'
    this.recentFile = path.join(this.cacheDir, '_recent.json')
  }

  async generate(article, outPath, options = {}) {
    const concept = await this.conceptEngine.generate(article, options)
    const hero = await this.resolveHero(article, concept)
    return this.renderer.render({ ...concept, heroImage: hero }, article, outPath, {
      width: options.width,
      height: options.height,
    })
  }

  _loadRecent() {
    try { return JSON.parse(fs.readFileSync(this.recentFile, 'utf8')) } catch { return [] }
  }

  _saveRecent(list) {
    try {
      fs.mkdirSync(this.cacheDir, { recursive: true })
      fs.writeFileSync(this.recentFile, JSON.stringify(list.slice(-60)))
    } catch {}
  }

  async resolveHero(article, concept) {
    const recent = this._loadRecent()
    const keywords = concept.visualKeywords || [concept.subject]
    const seed = concept.algorithm ? concept.algorithm.seed : hashCode(article.title || '')
    const algoN = concept.algorithm?.number || 1
    for (const kw of keywords) {
      const url = await this.searchPexels(kw, seed, algoN, recent)
      if (url) {
        recent.push(url)
        this._saveRecent(recent)
        return url
      }
    }
    return null
  }

  async searchPexels(query, seed = 0, algoN = 1, exclude = []) {
    const key = process.env.PEXELS_API_KEY
    if (!key) return null
    try {
      // 48-algorithm diversity: page + index derived from algo seed so two
      // different stories never pull the same candidate photo.
      const page = (seed % 10) + 1
      const per = 30
      const res = await fetch(`${PEXELS}?query=${encodeURIComponent(query)}&per_page=${per}&page=${page}&orientation=portrait`, {
        headers: { Authorization: key },
        signal: AbortSignal.timeout(8000),
      })
      if (!res.ok) return null
      const data = await res.json()
      const photos = (data.photos || []).map(p => p.src?.large2x || p.src?.large).filter(Boolean)
      if (!photos.length) return null
      const idx = (seed + algoN * 7) % photos.length
      let candidate = photos[idx]
      let tries = 0
      while (exclude.includes(candidate) && tries < photos.length) {
        tries++
        candidate = photos[(idx + tries) % photos.length]
      }
      return candidate
    } catch { return null }
  }
}
