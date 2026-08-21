import 'dotenv/config'
import { createRequire } from 'module'
const require = createRequire(import.meta.url)
import express from 'express'
import cors from 'cors'
import path from 'path'
import { fileURLToPath } from 'url'
import videoRoutes from './routes/video.js'
import newsRoutes from './routes/news.js'
import publishRoutes from './routes/publish.js'
import renderRoutes from './routes/render.js'
import pipelineRoutes from './routes/pipeline.js'
import premiumRoutes from './routes/premium.js'
import directRoutes from './routes/direct.js'
import cronManagerRoutes from './routes/cron-manager.js'
import aiManagerRoutes from './routes/ai-manager.js'
import youtubeThumbnailRoutes from '../youtube/youtubeThumbnailRoute.js'
import { requireAuth } from '../../packages/auth/requireAuth.js'
import { logger } from '../../packages/logger.mjs'
import { startMetricsServer, httpRequestsTotal, httpRequestDurationMs, updateJobGauges } from '../../packages/metrics.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const app = express()
const PORT = process.env.PORT || 3001

app.use(cors())
app.use(express.json({ limit: '10mb' }))

// Request logging + metrics
app.use((req, res, next) => {
  const start = process.hrtime.bigint()
  res.on('finish', () => {
    const ms = Number(process.hrtime.bigint() - start) / 1e6
    const route = req.route?.path || req.path
    httpRequestsTotal.inc({ method: req.method, route, status: String(res.statusCode) })
    httpRequestDurationMs.observe({ method: req.method, route }, ms)
    logger.info({ method: req.method, path: req.path, status: res.statusCode, ms: Math.round(ms) }, 'http')
  })
  next()
})

// Rate limits: renders are expensive — cap by IP
import rateLimit from 'express-rate-limit'
const renderLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 10,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'Rate limit exceeded: max 10 render requests per minute' },
})
app.use('/api/generate', renderLimiter)
app.use('/api/news-video', renderLimiter)

// Read-only catalog routes stay public; every mutating/admin surface is gated.
// Paid/mutating video endpoints (POST /api/generate, POST /api/news-video) are
// individually protected inside routes/video.js with requireAuth so the public
// GET catalog (/providers, /models, /jobs) and /api/health stay reachable.
app.use('/api', videoRoutes)
app.use('/api/news', newsRoutes)
app.use('/api/render-and-publish', requireAuth)
app.use('/api/pipeline', requireAuth)
app.use('/api/premium-render', requireAuth)
app.use('/api/direct-publish', requireAuth)
app.use('/api/cron-jobs', requireAuth)
app.use('/api/ai', requireAuth)
app.use('/api', publishRoutes)
app.use('/api', renderRoutes)
app.use('/api', pipelineRoutes)
app.use('/api', premiumRoutes)
app.use('/api', directRoutes)
app.use('/api', cronManagerRoutes)
app.use('/api/youtube', youtubeThumbnailRoutes)
app.use('/api/ai', aiManagerRoutes)

app.get('/api/health', (req, res) => {
  let version = 'v3.0'
  try {
    const pkg = JSON.parse(require('fs').readFileSync('./package.json', 'utf8'))
    version = pkg.version || version
  } catch {}

  // Check DB connectivity
  let dbStatus = 'healthy'
  try {
    const db = require('better-sqlite3')('./data/newsroom.db')
    db.prepare('SELECT 1').get()
    db.close()
  } catch { dbStatus = 'unavailable' }

  const uptime = process.uptime()
  const hours = Math.floor(uptime / 3600)
  const minutes = Math.floor((uptime % 3600) / 60)

  res.json({
    status: 'ok',
    version,
    uptime: `${hours}h ${minutes}m`,
    renderer: 'ready',
    queue: 'healthy',
    database: dbStatus,
    timestamp: new Date().toISOString(),
  })
})

// Detailed health — admin only. Does NOT expose which provider keys exist, cron
// schedules, or any infra, to unauthenticated callers; boolean flags stay here.
app.get('/api/health/detailed', requireAuth, (req, res) => {
  let cronJobs = []
  try {
    const db = require('better-sqlite3')('./data/newsroom.db')
    cronJobs = db.prepare('SELECT * FROM cron_jobs WHERE enabled = 1 ORDER BY name').all()
    db.close()
  } catch {}
  res.json({
    status: 'ok',
    providers: {
      gemini: !!process.env.GEMINI_API_KEY,
      colab: !!process.env.COLAB_API_URL,
      fal: !!process.env.FAL_KEY,
      replicate: !!process.env.REPLICATE_API_TOKEN,
    },
    cronSecret: !!process.env.CRON_SECRET,
    cronJobs,
  })
})

app.listen(PORT, () => {
  logger.info({ port: PORT }, 'api server listening')
  console.log(`🍿 Video Gen Stack running at http://localhost:${PORT}`)
  if (!process.env.GEMINI_API_KEY) {
    console.log('📋 Get a FREE Gemini API key (no CC): https://aistudio.google.com/apikey')
    console.log('   Then add to .env: GEMINI_API_KEY=your_key_here')
  }
  if (process.env.GEMINI_API_KEY) {
    console.log('✅ Gemini free provider ready!')
  }
})

startMetricsServer(parseInt(process.env.METRICS_PORT) || 9100, { log: logger })

// Keep job gauges fresh in the API process too (worker keeps its own).
setInterval(() => {
  try {
    const { jobDb } = require('../../packages/database/jobs.mjs')
    updateJobGauges(jobDb())
  } catch {}
}, 15000)

// Debug: check deployed file — admin only (leaks source line content)
app.get('/api/debug/pipeline', requireAuth, (req, res) => {
  import('fs').then(fs => {
    const code = fs.readFileSync('./apps/worker/pipeline.js', 'utf8');
    const lines = code.split('\n');
    const relevant = lines.filter((l, i) => 
      l.includes('articleId') || 
      l.includes('logValidation') || 
      l.includes('contentId') ||
      i > 96 && i < 105
    );
    res.json({ 
      totalLines: lines.length,
      importPath: lines[0]?.slice(0, 80),
      relevantLines: relevant.slice(0, 20)
    });
  });
});

// Latest uploads for the public landing page — proxied from the channel RSS
// feed (no API key required, cached 60s so the feed isn't hammered).
const channelFeedCache = { at: 0, json: null }
const decodeHtml = (s = '') => s
  .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
  .replace(/&quot;/g, '"').replace(/&#39;/g, "'")

app.get('/api/channel/videos', async (req, res) => {
  if (Date.now() - channelFeedCache.at < 60_000 && channelFeedCache.json) {
    return res.json(channelFeedCache.json)
  }
  try {
    const channelId = process.env.YOUTUBE_CHANNEL_ID || 'UC4UC7z16EtqtI-TJzeGZKjQ'
    const feed = await fetch(`https://www.youtube.com/feeds/videos.xml?channel_id=${channelId}`, {
      headers: { 'user-agent': 'Mozilla/5.0 (compatible; NEWS-MONSTER/1.0)' },
      signal: AbortSignal.timeout(8000),
    })
    if (!feed.ok) return res.status(feed.status).json({ error: 'feed unavailable' })
    const xml = await feed.text()
    const entries = [...xml.matchAll(/<entry>([\s\S]*?)<\/entry>/g)]
    const videos = entries.map(m => {
      const e = m[1] || ''
      const id = /yt:video:([A-Za-z0-9_-]+)/.exec(e)?.[1] || null
      const title = decodeHtml(/<title>([\s\S]*?)<\/title>/.exec(e)?.[1] || '')
      const published = /<published>([\s\S]*?)<\/published>/.exec(e)?.[1] || null
      const thumb = /<media:thumbnail[^>]*url="([^"]+)"/.exec(e)?.[1] || null
      return {
        id,
        title,
        published: published ? new Date(published).toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '',
        thumbnail: thumb || (id ? `https://i.ytimg.com/vi/${id}/hqdefault.jpg` : null),
      }
    }).filter(v => v.id)
    const json = { channelId, videos }
    channelFeedCache.at = Date.now()
    channelFeedCache.json = json
    res.json(json)
  } catch (e) {
    res.status(502).json({ error: e.message })
  }
});

// Admin console (packages/dashboard) mounted LAST so the core API routes above
// (incl. /api/health) stay public. Non-authed visitors to / get sent to
// /login; header or httpOnly session cookie gets the full control center. The
// public landing page lives on GitHub Pages (sham435.github.io/video-gen-stack).
import dashboardApp from '../../packages/dashboard/index.mjs'
import { isAuthed } from '../../packages/auth/requireAuth.js'
app.get('/', (req, res, next) => {
  if (isAuthed(req)) return next()
  return res.redirect('/login')
})
app.use(dashboardApp)
