import { Router } from 'express'
import { VIDEO_MODELS, getEndpoint } from '../services/models.js'
import { fetchTopHeadlines, searchNews, articlesToSummary } from '../services/news.js'

const router = Router()

const PROVIDERS = {
  'gemini': { import: () => import('../providers/gemini.js') },
  'colab': { import: () => import('../providers/colab.js') },
  'replicate': { import: () => import('../providers/replicate.js') },
  'fal.ai': { import: () => import('../providers/fal.js') },
  'huggingface': { import: () => import('../providers/huggingface.js') },
}

async function getProvider(name) {
  const p = PROVIDERS[name]
  if (!p) throw new Error(`Unknown provider: ${name}`)
  return await p.import()
}

function getConfiguredProviders() {
  const configs = {
    'gemini': !!process.env.GEMINI_API_KEY,
    'colab': !!process.env.COLAB_API_URL,
    'replicate': !!process.env.REPLICATE_API_TOKEN,
    'fal.ai': !!process.env.FAL_KEY,
    'huggingface': true,
  }
  // Mark paid providers
  const paid = ['replicate', 'fal.ai']
  return Object.entries(PROVIDERS).map(([id]) => ({
    id,
    name: id,
    configured: configs[id],
    free: !paid.includes(id),
  }))
}

router.get('/providers', (req, res) => {
  const providers = getConfiguredProviders()
  // Sort: configured free first, then configured paid, then unconfigured
  providers.sort((a, b) => {
    const score = p => (p.configured && p.free ? 0 : p.configured ? 1 : p.free ? 2 : 3)
    return score(a) - score(b)
  })
  res.json({ providers })
})

router.get('/models', (req, res) => {
  const provider = req.query.provider || 'gemini'
  res.json({
    provider,
    models: VIDEO_MODELS.map(m => ({
      id: m.id,
      name: m.name,
      provider: m.provider,
      capabilities: m.capabilities,
      speed: m.speed,
      quality: m.quality,
      openSource: m.openSource,
      freeTier: !!m.freeTier,
      supportsAspectRatios: m.supportsAspectRatios,
      availableOnProvider: !!getEndpoint(m.id, provider),
    })),
  })
})

router.post('/generate', async (req, res) => {
  const { modelId, prompt, duration, aspectRatio, imageUrl, provider } = req.body
  const activeProvider = provider || 'gemini'

  if (!modelId) return res.status(400).json({ error: 'modelId is required' })
  if (!prompt) return res.status(400).json({ error: 'prompt is required' })

  const endpoint = getEndpoint(modelId, activeProvider)
  if (!endpoint) {
    return res.status(400).json({
      error: `Model "${modelId}" not available on "${activeProvider}". Try switching providers.`,
    })
  }

  try {
    const prov = await getProvider(activeProvider)
    const result = await prov.generateVideo({
      endpoint,
      modelId,
      prompt,
      duration: duration || 5,
      aspectRatio: aspectRatio || '16:9',
      imageUrl,
    })
    res.json(result)
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

// News → Video pipeline
router.post('/news-video', async (req, res) => {
  const { topic, category, duration, aspectRatio, provider } = req.body

  try {
    let articles
    if (topic) {
      articles = await searchNews(topic, { pageSize: 5 })
    } else {
      articles = await fetchTopHeadlines({ category, pageSize: 5 })
    }
    if (!articles.length) return res.status(404).json({ error: 'No news found' })

    const newsText = articlesToSummary(articles)
    const model = VIDEO_MODELS.find(m => m.id === (req.body.modelId || 'gemini-2.0-flash'))
    const endpoint = getEndpoint(model?.id || 'gemini-2.0-flash', provider || 'gemini')

    if (!endpoint) {
      return res.json({
        articles,
        newsText,
        note: 'No video provider configured. News fetched — use a video provider to generate.',
      })
    }

    const prov = await getProvider(provider || 'gemini')
    const prompt = `Create a ${duration || 7}-second news highlights video from these headlines. Style: modern news broadcast, clean, professional.\n\n${newsText}`
    const result = await prov.generateVideo({ endpoint, modelId: model?.id, prompt, duration: duration || 7, aspectRatio: aspectRatio || '9:16' })

    res.json({ articles, prompt, video: result.videos?.[0], provider: result.provider })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

// Cron endpoint — auto-render news video and upload to YouTube (direct, simple)
router.all('/cron/news-video', async (req, res) => {
  const { category = 'technology' } = req.body || req.query
  try {
    const { fetchTopHeadlines, articlesToSummary } = await import('../services/news.js')
    const { renderNewsVideo } = await import('../services/renderer.js')
    const { uploadShort } = await import('../publishers/youtube.js')
    const { readFileSync, unlinkSync } = await import('fs')

    const articles = await fetchTopHeadlines({ category, pageSize: 5 })
    if (!articles.length) return res.json({ status: 'no_articles' })
    const article = articles[0]

    const videoPath = await renderNewsVideo(articles.slice(0, 3))
    const buffer = readFileSync(videoPath)
    const base64 = buffer.toString('base64')
    unlinkSync(videoPath)

    const title = `📰 ${article.title.slice(0, 90)}`
    const desc = `${title}\n\nSource: ${article.source?.name || 'NewsAPI'}\n\n#tech #news #AI`
    const result = await uploadShort(`data:video/mp4;base64,${base64}`, title, desc, 'public')

    console.log(`[CRON] Published: https://youtu.be/${result?.id}`)
    res.json({ status: 'published', videoId: result?.id, url: `https://youtu.be/${result?.id}` })
  } catch (e) {
    console.error(`[CRON] Error:`, e.stack)
    res.status(500).json({ error: e.message })
  }
})

// Multi-category cron — rotates through categories every run
const CATEGORIES = ['technology', 'science', 'business', 'health', 'entertainment']
let catIndex = 0
router.all('/cron/rotate', async (req, res) => {
  const category = CATEGORIES[catIndex % CATEGORIES.length]
  catIndex++
  try {
    const { NewsPipeline } = await import('../../worker/pipeline.js')
    const pipeline = new NewsPipeline()
    const result = await pipeline.run({ category, publish: true })
    res.json({ ...result, category })
  } catch (e) {
    console.error(`[CRON] Error:`, e.message)
    res.status(500).json({ error: e.message })
  }
})

export default router
