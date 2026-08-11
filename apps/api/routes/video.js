import { Router } from 'express'
import { createHash } from 'crypto'
import { requireAuth } from '../../../packages/auth/requireAuth.js'
import { validateBody, generateSchema, newsVideoSchema } from '../../../packages/validation/schemas.mjs'
import { VIDEO_MODELS, getEndpoint } from '../services/models.js'
import { fetchTopHeadlines, searchNews, articlesToSummary } from '../services/news.js'
import { jobDb, enqueue, getJob, listJobs } from '../../../packages/database/jobs.mjs'

const router = Router()

// Only providers with a real implementation in this deployment are loadable.
// local is backed by services/local.js (free ffmpeg renders, default);
// gemini by services/gemini.js (free-tier image frames); huggingface by
// services/gradio.js (Pyramid Flow free Space, slow cold start);
// fal.ai by services/fal.js (paid video, account must have balance).
const PROVIDERS = {
  'local': { import: () => import('../services/local.js') },
  'gemini': { import: () => import('../services/gemini.js') },
  'colab': null,
  'replicate': null,
  'fal.ai': { import: () => import('../services/fal.js') },
  'huggingface': { import: () => import('../services/gradio.js') },
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

// Paid/provider-burning endpoints are admin-gated (requireAuth fails closed if
// ADMIN_API_KEY unset). Read-only catalog routes above stay public.
router.post('/generate', requireAuth, validateBody(generateSchema), (req, res) => {
  const { modelId, prompt, duration, aspectRatio, imageUrl, provider, segments, segmentDuration } = req.body
  const activeProvider = provider || 'local'

  if (!modelId) return res.status(400).json({ error: 'modelId is required' })
  if (!prompt) return res.status(400).json({ error: 'prompt is required' })

  const endpoint = getEndpoint(modelId, activeProvider)
  if (!endpoint && activeProvider !== 'local') {
    return res.status(400).json({
      error: `Model "${modelId}" not available on "${activeProvider}". Try switching providers.`,
    })
  }

  const payload = { modelId, prompt, duration: duration || 5, aspectRatio: aspectRatio || '16:9', imageUrl, provider: activeProvider, segments, segmentDuration, endpoint }
  const contentHash = createHash('sha256').update(JSON.stringify(payload)).digest('hex')
  const job = enqueue(jobDb(), { type: 'video_generate', payload, contentHash })
  res.json({ jobId: job.id, status: job.status })
})

// News → Video pipeline
router.post('/news-video', requireAuth, validateBody(newsVideoSchema), (req, res) => {
  const { topic, category, duration, aspectRatio, provider } = req.body

  const payload = { topic, category: category || 'technology', duration: duration || 10, aspectRatio: aspectRatio || '16:9', provider: provider || 'local' }
  const contentHash = createHash('sha256').update(JSON.stringify(payload)).digest('hex')
  const job = enqueue(jobDb(), { type: 'news_video', payload, contentHash })
  res.json({ jobId: job.id, status: job.status })
})

// Job queue — poll for status / results
router.get('/jobs/:id', (req, res) => {
  const job = getJob(jobDb(), req.params.id)
  if (!job) return res.status(404).json({ error: 'Job not found' })
  const { payload, result, ...meta } = job
  res.json(meta)
})

router.get('/jobs', (req, res) => {
  const { status, type, limit } = req.query
  const jobs = listJobs(jobDb(), { status, type, limit: Math.min(parseInt(limit) || 50, 200) })
  res.json({ jobs: jobs.map(({ payload, ...meta }) => meta) })
})

function validateCronToken(req) {
  const token = (req.body || req.query).token
  const secret = process.env.CRON_SECRET
  if (secret && token !== secret) {
    throw new Error('Unauthorized: invalid or missing cron token')
  }
}

// Cron endpoint — auto-render news video and upload to YouTube (direct, simple)
router.all('/cron/news-video', async (req, res) => {
  try { validateCronToken(req) } catch (e) { return res.status(401).json({ error: e.message }) }
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
