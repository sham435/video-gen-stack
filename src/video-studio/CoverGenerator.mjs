import { CoverDirector } from './CoverDirector.mjs'
import { CoverComposer } from './CoverComposer.mjs'
import { CoverValidator } from './CoverValidator.mjs'

const PEXELS = 'https://api.pexels.com/v1/search'

export class CoverGenerator {
  constructor(aiProvider = null, options = {}) {
    this.ai = aiProvider
    this.director = new CoverDirector(aiProvider)
    this.composer = new CoverComposer()
    this.validator = new CoverValidator()
    this.cacheDir = options.cacheDir || 'cache/covers'
  }

  async generate(article, outPath, options = {}) {
    const brief = await this.director.analyzeStory(article)
    const hero = await this.resolveHero(article, brief)
    await this.composer.compose(brief, hero, outPath)
    const validation = await this.validator.validate(outPath, brief)
    return { brief, hero, path: outPath, validation }
  }

  async generateBest(article, outDir, options = {}) {
    const maxVariants = options.maxVariants || 3
    const minCtr = options.minCtr || 70
    const attempts = []
    let best = null

    for (let v = 1; v <= maxVariants; v++) {
      const outPath = `${outDir}/cover_v${v}.png`
      const result = await this.generate(article, outPath, options)
      attempts.push({ variant: v, ctr: result.validation?.checks?.ctrPrediction, ok: result.validation?.ok, path: outPath, reason: result.validation?.reason })
      if (!best || (result.validation?.checks?.ctrPrediction ?? 0) > (best.validation?.checks?.ctrPrediction ?? 0)) {
        best = result
        best.variant = v
      }
      // Stop early once above threshold
      if ((result.validation?.checks?.ctrPrediction ?? 0) >= minCtr) break
    }

    // Promote the best variant to the final path
    const finalPath = `${outDir}/cover.png`
    if (best && best.path !== finalPath) {
      const { copyFileSync, existsSync } = await import('fs')
      if (existsSync(best.path)) copyFileSync(best.path, finalPath)
    }
    return { ...best, path: finalPath, attempts }
  }

  async generateTournament(article, outDir, options = {}) {
    const styles = options.styles || ['breaking', 'cinematic', 'minimal', 'reaction', 'data']
    const variants = []
    let winner = null

    for (const style of styles) {
      const outPath = `${outDir}/cover_${style}.png`
      try {
        const result = await this.generate(article, outPath, { style })
        const ctr = result.validation?.checks?.ctrPrediction ?? 0
        variants.push({ style, ctr, ok: result.validation?.ok, path: outPath, reason: result.validation?.reason })
        if (!winner || ctr > (winner.ctr || 0)) {
          winner = { ...result, style, ctr, variantPath: outPath }
        }
      } catch (e) {
        variants.push({ style, ctr: 0, ok: false, reason: e.message })
      }
    }

    // Promote winner to cover.png
    const finalPath = `${outDir}/cover.png`
    if (winner && winner.variantPath !== finalPath) {
      const { copyFileSync, existsSync } = await import('fs')
      if (existsSync(winner.variantPath)) copyFileSync(winner.variantPath, finalPath)
    }

    return {
      winner: winner?.style || null,
      winnerCtr: winner?.ctr ?? 0,
      variants,
      path: finalPath,
      brief: winner?.brief || null,
      validation: winner?.validation || null,
    }
  }

  async resolveHero(article, brief) {
    const terms = brief.keywords || (brief.subject ? [brief.subject] : [])
    for (const term of terms.slice(0, 3)) {
      const url = await this.searchPexels(term)
      if (url) return url
    }
    // Fallback 2: use the article's own image if NewsAPI provided one
    if (article?.imageUrl || article?.urlToImage) {
      return article.imageUrl || article.urlToImage
    }
    // Fallback 3: generate a hero image with FAL_KEY when Pexels unavailable
    if (process.env.FAL_KEY && brief.hero_prompt) {
      const url = await this.generateWithFal(brief.hero_prompt)
      if (url) return url
    }
    return null
  }

  async generateWithFal(prompt) {
    try {
      const resp = await fetch('https://fal.run/fal-ai/fast-sdxl', {
        method: 'POST',
        headers: { Authorization: `Key ${process.env.FAL_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt, image_size: 'portrait_4_3', num_inference_steps: 25, guidance_scale: 7.5 }),
        signal: AbortSignal.timeout(15000),
      })
      if (!resp.ok) return null
      const data = await resp.json()
      if (data.request_id) {
        for (let i = 0; i < 20; i++) {
          const poll = await fetch(`https://fal.run/fal-ai/fast-sdxl/requests/${data.request_id}`, {
            headers: { Authorization: `Key ${process.env.FAL_KEY}` },
          })
          if (!poll.ok) return null
          const result = await poll.json()
          if (result.status === 'completed' && result.images?.[0]?.url) return result.images[0].url
          if (result.status === 'failed') return null
          await new Promise(r => setTimeout(r, 1000))
        }
      }
      return null
    } catch { return null }
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
