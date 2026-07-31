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
    const director = CategoryDirector.getDirector(cat)
    const layout = director.getLayout(scene.type)
    const keywords = this.extractKeywords(scene, article)

    let asset = await this.tryPexels(keywords)
    if (!asset && this.falKey) {
      const prompt = this.promptEngine.imagePrompt({
        category: cat,
        sceneType: scene.type,
        keywords,
        hookStrategy: scene.hookStrategy,
      })
      asset = await this.tryFalAI(prompt)
    }
    if (!asset && article.imageUrl) {
      asset = { type: 'image', url: article.imageUrl, source: 'article' }
    }

    return {
      category: cat,
      primary: asset || { type: 'gradient', url: null, source: 'fallback' },
      keywords,
      layout,
      colors: director.getColorGrade(),
      caption: director.getCaption(),
      overlays: director.getOverlays(),
    }
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