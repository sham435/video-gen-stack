import { BRollSelector } from './BRollSelector.mjs'

const FAL_BASE = 'https://fal.run/fal-ai/fast-sdxl'

export class VisualPlanner {
  constructor() {
    this.bRoll = new BRollSelector()
  }

  async resolveScenes(scenes, article) {
    const resolved = []
    for (const scene of scenes) {
      const asset = await this.resolveSceneVisual(scene, article)
      resolved.push({ ...scene, visual: { ...scene.visual, ...asset } })
    }
    return resolved
  }

  async resolveSceneVisual(scene, article) {
    const assets = []

    if (scene.type === 'close') {
      return { type: 'brand', path: null, source: 'brand' }
    }

    const pexelsUrl = await this.tryPexels(scene, article)
    if (pexelsUrl) {
      assets.push({ type: 'image', path: pexelsUrl, source: 'pexels' })
    }

    const falKey = process.env.FAL_KEY || process.env.FAL_AI_API_KEY
    if (falKey && scene.visual?.prompt) {
      const aiUrl = await this.tryFalAI(scene.visual.prompt, falKey)
      if (aiUrl) {
        assets.push({ type: 'ai_image', path: aiUrl, source: 'fal' })
      }
    }

    if (assets.length === 0 && article.imageUrl) {
      assets.push({ type: 'image', path: article.imageUrl, source: 'article' })
    }

    return {
      assets: assets.length > 0 ? assets : [{ type: 'gradient', path: null, source: 'fallback' }],
      primary: assets[0] || { type: 'gradient', path: null, source: 'fallback' },
    }
  }

  async tryPexels(scene, article) {
    const keywords = this.sceneKeywords(scene, article)
    for (const term of keywords) {
      const url = await this.searchPexels(term)
      if (url) return url
    }
    return null
  }

  sceneKeywords(scene, article) {
    const prompt = (scene.visual?.prompt || '').toLowerCase()
    const title = (article.title || '').toLowerCase()
    const words = [...new Set([...prompt.split(' '), ...title.split(' ')])]
      .filter(w => w.length > 4)
      .slice(0, 4)
    if (words.length === 0) return ['technology', 'digital', 'innovation']
    return words
  }

  async searchPexels(query) {
    const key = process.env.PEXELS_API_KEY
    if (!key) return null
    try {
      const res = await fetch(
        `https://api.pexels.com/v1/search?query=${encodeURIComponent(query)}&per_page=1&orientation=portrait`,
        { headers: { Authorization: key }, signal: AbortSignal.timeout(5000) }
      )
      if (!res.ok) return null
      const data = await res.json()
      return data.photos?.[0]?.src?.large2x || data.photos?.[0]?.src?.large || null
    } catch { return null }
  }

  async tryFalAI(prompt, apiKey) {
    try {
      const resp = await fetch(FAL_BASE, {
        method: 'POST',
        headers: { Authorization: `Key ${apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt,
          image_size: 'portrait_16_9',
          num_inference_steps: 25,
          guidance_scale: 7.5,
        }),
        signal: AbortSignal.timeout(15000),
      })
      if (!resp.ok) return null
      const data = await resp.json()
      const requestId = data.request_id
      if (!requestId) return null
      for (let i = 0; i < 20; i++) {
        const poll = await fetch(`https://fal.run/fal-ai/fast-sdxl/requests/${requestId}`, {
          headers: { Authorization: `Key ${apiKey}` },
        })
        if (!poll.ok) return null
        const result = await poll.json()
        if (result.status === 'completed' && result.images?.[0]?.url) return result.images[0].url
        if (result.status === 'failed') return null
        await new Promise(r => setTimeout(r, 2000))
      }
    } catch { return null }
    return null
  }
}
