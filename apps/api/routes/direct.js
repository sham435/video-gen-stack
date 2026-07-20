import { Router } from 'express'

const router = Router()

router.all('/direct-publish', async (req, res) => {
  const { category = 'technology' } = req.body || req.query
  try {
    const { fetchTopHeadlines, articlesToSummary } = await import('../services/news.js')
    const { renderNewsVideo } = await import('../services/renderer.js')
    const { uploadShort } = await import('../publishers/youtube.js')
    const { readFileSync, unlinkSync } = await import('fs')

    // 1. Fetch
    const articles = await fetchTopHeadlines({ category, pageSize: 5 })
    if (!articles.length) return res.json({ status: 'no_articles' })
    const article = articles[0]
    
    // 2. Render
    const videoPath = await renderNewsVideo(articles.slice(0, 3))
    const buffer = readFileSync(videoPath)
    const base64 = buffer.toString('base64')
    unlinkSync(videoPath)

    // 3. Upload
    const title = `📰 ${article.title.slice(0, 90)}`
    const desc = `${title}\n\nSource: ${article.source?.name || 'NewsAPI'}\n\n#tech #news #AI`
    const result = await uploadShort(`data:video/mp4;base64,${base64}`, title, desc, 'public')

    res.json({ status: 'published', videoId: result?.id, url: `https://youtu.be/${result?.id}` })
  } catch (e) {
    res.status(500).json({ error: e.message, stack: e.stack?.slice(0, 300) })
  }
})

export default router
