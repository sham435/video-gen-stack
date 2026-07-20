import 'dotenv/config'
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

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const app = express()
const PORT = process.env.PORT || 3001

app.use(cors())
app.use(express.json({ limit: '10mb' }))
app.use(express.static(path.join(__dirname, '..', 'dashboard', 'public')))

// Also serve root dashboard path
app.use(express.static(path.join(__dirname, '..', '..', 'public')))

app.use('/api', videoRoutes)
app.use('/api/news', newsRoutes)
app.use('/api', publishRoutes)
app.use('/api', renderRoutes)
app.use('/api', pipelineRoutes)
app.use('/api', premiumRoutes)
app.use('/api', directRoutes)

app.get('/api/health', (req, res) => {
  // Detect renderer version from package.json
  let version = 'v3.0'
  try {
    const pkg = JSON.parse(require('fs').readFileSync('./package.json', 'utf8'))
    version = pkg.version || version
  } catch {}

  res.json({
    status: 'ok',
    version,
    renderer: 'ready',
    queue: 'healthy',
    timestamp: new Date().toISOString(),
    providers: {
      gemini: !!process.env.GEMINI_API_KEY,
      colab: !!process.env.COLAB_API_URL,
      fal: !!process.env.FAL_KEY,
      replicate: !!process.env.REPLICATE_API_TOKEN,
    },
    cronJobs: {
      technology: '/api/cron/news-video?category=technology',
      security: !!process.env.CRON_SECRET,
    },
  })
})

app.listen(PORT, () => {
  console.log(`🍿 Video Gen Stack running at http://localhost:${PORT}`)
  if (!process.env.GEMINI_API_KEY) {
    console.log('📋 Get a FREE Gemini API key (no CC): https://aistudio.google.com/apikey')
    console.log('   Then add to .env: GEMINI_API_KEY=your_key_here')
  }
  if (process.env.GEMINI_API_KEY) {
    console.log('✅ Gemini free provider ready!')
  }
})

// Debug: check deployed file
app.get('/api/debug/pipeline', (req, res) => {
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
