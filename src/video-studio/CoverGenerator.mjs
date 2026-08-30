import { CoverDirector } from './CoverDirector.mjs'
import { CoverComposer } from './CoverComposer.mjs'
import { CoverValidator } from './CoverValidator.mjs'
import { ThumbnailIntelligence } from '../analytics/ThumbnailIntelligence.mjs'
import { SDCPPProvider } from '../thumbnail/SDCPPProvider.mjs'
import { pickDistinctPhoto } from '../../scripts/pexels.mjs'
import path from 'node:path'
import fs from 'node:fs'

const PEXELS = 'https://api.pexels.com/v1/search'
const ALGOS_USED_FILE = path.join(process.cwd(), 'data', 'algos-used.json')

function recordAlgoUsage(article, algo, heroUrl) {
  try {
    const existing = JSON.parse(fs.readFileSync(ALGOS_USED_FILE, 'utf8'))
    existing.push({
      at: Date.now(),
      algoNumber: algo?.number || 0,
      algoId: algo?.id || 'unknown',
      visual: algo?.visual?.id || '',
      tone: algo?.tone?.id || '',
      hook: algo?.hook || '',
      title: (article?.title || '').slice(0, 80),
      category: article?.category || '',
      photo: heroUrl ? (heroUrl.match(/photos\/(\d+)/)?.[1] || heroUrl) : null,
    })
    fs.writeFileSync(ALGOS_USED_FILE, JSON.stringify(existing.slice(-200)))
  } catch {
    try {
      fs.writeFileSync(ALGOS_USED_FILE, JSON.stringify([{
        at: Date.now(),
        algoNumber: algo?.number || 0,
        algoId: algo?.id || 'unknown',
        visual: algo?.visual?.id || '',
        tone: algo?.tone?.id || '',
        hook: algo?.hook || '',
        title: (article?.title || '').slice(0, 80),
        category: article?.category || '',
        photo: heroUrl ? (heroUrl.match(/photos\/(\d+)/)?.[1] || heroUrl) : null,
      }]))
    } catch {}
  }
}

export class CoverGenerator {
  constructor(aiProvider = null, options = {}) {
    this.ai = aiProvider
    this.director = new CoverDirector(aiProvider)
    this.composer = new CoverComposer()
    this.validator = new CoverValidator()
    this.cacheDir = options.cacheDir || 'cache/covers'
    // Milestone C: thumbnail performance learning. Cold start (no analytics
    // yet) is a strict no-op — every brief/variant stays byte-identical.
    this.intel = options.intelligence === undefined
      ? new ThumbnailIntelligence()
      : options.intelligence
    this.sdcpp = options.sdcpp === undefined ? new SDCPPProvider() : options.sdcpp
  }

  /**
   * 16:9 YouTube thumbnail (1280x720) — same brand system as the portrait
   * cover but laid out landscape. Deterministic for identical input.
   */
  async generateThumbnail(article, outPath, options = {}) {
    const brief = await this.director.analyzeStory(article, options.style ? { style: options.style } : {})
    const tuned = this.intel?.tuneBrief(brief) || brief
    if (options.hideBranding) tuned.hideBranding = true
    const hero = await this.resolveHero(article, tuned)
    await this.composer.composeThumbnail(tuned, hero, outPath)
    return { brief: tuned, hero, path: outPath }
  }

  async generate(article, outPath, options = {}) {
    const brief = await this.director.analyzeStory(article, options.style ? { style: options.style } : {})
    const tuned = this.intel?.tuneBrief(brief) || brief
    if (options.hideBranding) tuned.hideBranding = true
    const hero = await this.resolveHero(article, tuned)
    await this.composer.compose(tuned, hero, outPath)
    const validation = await this.validator.validate(outPath, tuned)
    return { brief: tuned, hero, path: outPath, validation }
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
    const preferred = this.intel?.styleOrder(options.styles || ['breaking', 'cinematic', 'minimal', 'reaction', 'data'])
    const styles = preferred || options.styles || ['breaking', 'cinematic', 'minimal', 'reaction', 'data']
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
    const algoN = brief.algorithm?.number || 0
    const seed = brief.algorithm?.seed || hashCode(article.title || '')
    for (const term of terms.slice(0, 3)) {
      const url = await this.searchPexels(term, seed, algoN)
      if (url) {
        recordAlgoUsage(article, brief.algorithm, url)
        return url
      }
    }
    // Fallback 2: local AI hero via stable-diffusion.cpp (free, offline)
    const sdHero = article?.sdcpp === false ? null : await this.resolveSDCPP(article, brief)
    if (sdHero) return sdHero
    // Fallback 3: use the article's own image if NewsAPI provided one
    if (article?.imageUrl || article?.urlToImage) {
      return article.imageUrl || article.urlToImage
    }
    // Fallback 4: generate a hero image with FAL_KEY when Pexels unavailable
    if (process.env.FAL_KEY && brief.hero_prompt) {
      const url = await this.generateWithFal(brief.hero_prompt)
      if (url) return url
    }
    return null
  }

  /** Local SD hero (deterministic seed from title) when sd-cli + model exist. */
  resolveSDCPP(article, brief) {
    try {
      if (!this.sdcpp?.available()) return null
      const prompt = brief.hero_prompt || brief.visual_style || (brief.subject ? `cinematic news scene about ${brief.subject}` : '')
      if (!prompt) return null
      const seed = (() => { let h = 0; const s = article.title || 'newsm'; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0; return Math.abs(h) })()
      const result = this.sdcpp.generate({
        prompt: `${prompt}, cinematic editorial photography, dramatic lighting, high detail, 8k`,
        negative: 'blurry, low quality, watermark, text, logo, deformed, extra fingers, duplicate',
        width: 1024, height: 576, steps: 20, cfg: 7.0, seed,
        outPath: path.join(this.cacheDir, `sd-hero-${seed}.png`),
      })
      return result?.path || null
    } catch { return null }
  }

  async generateWithFal(prompt) {
    try {
      const resp = await fetch('https://fal.run/fal-ai/fast-sdxl', {
        method: 'POST',
        headers: { Authorization: `Key ${process.env.FAL_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt, image_size: 'landscape_16_9', num_inference_steps: 25, guidance_scale: 7.5 }),
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

  async searchPexels(query, seed = 0, algoN = 0) {
    const key = process.env.PEXELS_API_KEY
    if (!key) return null
    try {
      // Visual diversity: 20 candidates, slot-shuffled, rejects photos used in
      // the last 48h via the shared pickDistinctPhoto — covers used to take
      // photos[0] of the first keyword, so similar stories got identical covers.
      // + 48-algorithm engine: page + index derived from the algo seed so two
      // different stories never pull the same candidate photo.
      const page = (seed % 10) + 1
      const res = await fetch(`${PEXELS}?query=${encodeURIComponent(query)}&per_page=20&page=${page}&orientation=landscape`, {
        headers: { Authorization: key },
        signal: AbortSignal.timeout(5000),
      })
      if (!res.ok) return null
      const data = await res.json()
      const photos = (data.photos || [])
      const slot = pickDistinctPhoto(photos)
      const photo = slot || photos[(seed + algoN * 7) % Math.max(1, photos.length)]
      return photo?.src?.large2x || photo?.src?.large || null
    } catch { return null }
  }
}

function hashCode(s) {
  let h = 0
  const str = s || ''
  for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) >>> 0
  return h
}
