import { CategoryClassifier } from './CategoryClassifier.mjs'
import { CategoryDirector } from './CategoryDirector.mjs'
import { PromptEngine } from './PromptEngine.mjs'

const PEXELS_BASE = 'https://api.pexels.com/v1'
const FAL_BASE = 'https://fal.run/fal-ai/fast-sdxl'

export class VisualReasoner {
  constructor() {
    this.classifier = new CategoryClassifier()
    this.promptEngine = new PromptEngine()
    this.pexelsKey = process.env.PEXELS_API_KEY
    this.falKey = process.env.FAL_KEY || process.env.FAL_AI_API_KEY
  }

  async select(scene, article, category) {
    const cat = category || this.classifier.classify(article).category
    const director = CategoryDirector.getDirector(cat) || {}
    const layout = director.getLayout ? director.getLayout(scene.type) : {}
    const keywords = this.extractKeywords(scene, article)

    // Resolve a set of candidate visuals (Pexels up to 3, then article image, then FAL)
    let assets = []
    try {
      assets = await this.resolveAssets(keywords, article, cat, scene) || []
    } catch {
      assets = article?.imageUrl ? [{ type: 'image', url: article.imageUrl, source: 'article' }] : []
    }
    const primary = assets[0] || { type: 'gradient', url: null, source: 'fallback' }

    return {
      category: cat,
      primary,
      images: assets.map(a => a.url).filter(Boolean), // multiple images for b-roll cycling
      keywords,
      layout,
      colors: (director.getColorGrade && director.getColorGrade()) || {},
      caption: (director.getCaption && director.getCaption()) || {},
      overlays: (director.getOverlays && director.getOverlays()) || {},
    }
  }

  async resolveAssets(keywords, article, cat, scene) {
    const assets = []
    // 1. Pexels — pull up to 3 portrait photos for b-roll variety
    if (this.pexelsKey) {
      for (const term of keywords.slice(0, 3)) {
        const url = await this._pexelsOne(term)
        if (url) assets.push({ type: 'image', url, source: 'pexels', keyword: term })
        if (assets.length >= 3) break
      }
    }
    // 2. Article image as a fallback/extra
    if (article?.imageUrl && assets.length < 3) {
      assets.push({ type: 'image', url: article.imageUrl, source: 'article' })
    }
    // 3. FAL AI generation if still thin
    if (assets.length === 0 && this.falKey) {
      const prompt = this.promptEngine.imagePrompt({
        category: cat, sceneType: scene.type, keywords, hookStrategy: scene.hookStrategy,
      })
      const ai = await this.tryFalAI(prompt)
      if (ai) assets.push(ai)
    }
    return assets
  }

  async _pexelsOne(term) {
    try {
      const res = await fetch(
        `${PEXELS_BASE}/search?query=${encodeURIComponent(term)}&per_page=3&orientation=portrait`,
        { headers: { Authorization: this.pexelsKey }, signal: AbortSignal.timeout(5000) }
      )
      if (!res.ok) return null
      const data = await res.json()
      return data.photos?.[0]?.src?.large2x || data.photos?.[0]?.src?.large || null
    } catch { return null }
  }

  extractKeywords(scene, article) {
    const title = (article.title || '').toLowerCase()
    const prompt = (scene.visual?.subject || scene.narration || '').toLowerCase()
    const words = [...new Set([...prompt.split(' '), ...title.split(' ')])]
      .filter(w => w.length > 3)
      .slice(0, 4)
    if (words.length === 0) return ['technology', 'digital', 'innovation']
    return words
  }

  async tryPexels(keywords) {
    if (!this.pexelsKey) return null
    for (const term of keywords) {
      try {
        const res = await fetch(
          `${PEXELS_BASE}/search?query=${encodeURIComponent(term)}&per_page=1&orientation=portrait`,
          { headers: { Authorization: this.pexelsKey }, signal: AbortSignal.timeout(5000) }
        )
        if (!res.ok) continue
        const data = await res.json()
        const url = data.photos?.[0]?.src?.large2x || data.photos?.[0]?.src?.large
        if (url) return { type: 'image', url, source: 'pexels' }
      } catch { continue }
    }
    return null
  }

  async tryFalAI(prompt) {
    try {
      const resp = await fetch(FAL_BASE, {
        method: 'POST',
        headers: { Authorization: `Key ${this.falKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt, image_size: 'portrait_16_9', num_inference_steps: 25, guidance_scale: 7.5 }),
        signal: AbortSignal.timeout(15000),
      })
      if (!resp.ok) return null
      const data = await resp.json()
      const requestId = data.request_id
      if (!requestId) return null
      for (let i = 0; i < 20; i++) {
        const poll = await fetch(`https://fal.run/fal-ai/fast-sdxl/requests/${requestId}`, {
          headers: { Authorization: `Key ${this.falKey}` },
        })
        if (!poll.ok) return null
        const result = await poll.json()
        if (result.status === 'completed' && result.images?.[0]?.url)
          return { type: 'ai_image', url: result.images[0].url, source: 'fal' }
        if (result.status === 'failed') return null
        await new Promise(r => setTimeout(r, 2000))
      }
    } catch { return null }
    return null
  }
}