import { Router } from 'express'
import { NewsPipeline } from '../../worker/pipeline.js'

const router = Router()
let pipeline = null

function getPipeline() {
  if (!pipeline) pipeline = new NewsPipeline()
  return pipeline
}

router.all('/pipeline/run', async (req, res) => {
  const { category, topic, publish } = req.body || req.query
  try {
    const result = await getPipeline().run({ category, topic, publish: publish !== 'false' })
    res.json(result)
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

router.get('/pipeline/status', (req, res) => {
  const db = getPipeline().db
  const stats = {
    totalArticles: db.prepare('SELECT COUNT(*) as c FROM published_articles').get().c,
    published: db.prepare("SELECT COUNT(*) as c FROM published_articles WHERE status='published'").get().c,
    skipped: db.prepare("SELECT COUNT(*) as c FROM published_articles WHERE status='skipped_duplicate'").get().c,
    failed: db.prepare("SELECT COUNT(*) as c FROM published_articles WHERE status='failed'").get().c,
    audioAssets: db.prepare("SELECT COUNT(*) as c FROM audio_assets WHERE status='active'").get().c,
    templateVersion: getPipeline().typography.getActiveVersion('technology_news')?.version || 'v1',
    recentLogs: db.prepare('SELECT * FROM pipeline_logs ORDER BY created_at DESC LIMIT 20').all(),
  }
  res.json(stats)
})

export default router
