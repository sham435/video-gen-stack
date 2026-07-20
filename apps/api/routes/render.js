import { Router } from 'express'
import { readFileSync, unlinkSync } from 'fs'
import { renderNewsVideo } from '../services/renderer.js'
import { fetchTopHeadlines, searchNews, articlesToSummary } from '../services/news.js'

const router = Router()

router.post('/render-and-publish', async (req, res) => {
  const { topic, category, musicUrl } = req.body

  try {
    // 1. Fetch news
    const articles = topic
      ? await searchNews(topic, { pageSize: 5 })
      : await fetchTopHeadlines({ category: category || 'technology', pageSize: 5 })

    if (!articles.length) return res.status(404).json({ error: 'No news found' })

    // 2. Render video with FFmpeg (text overlays + music)
    const videoPath = await renderNewsVideo(articles, { musicUrl })
    const videoBuffer = readFileSync(videoPath)
    const base64 = videoBuffer.toString('base64')
    unlinkSync(videoPath)

    // 3. Upload to YouTube
    const { uploadShort } = await import('../publishers/youtube.js')
    const youtubeResult = await uploadShort(
      `data:video/mp4;base64,${base64}`,
      `📰 ${articles[0]?.title?.slice(0, 90) || 'News Update'}`,
      `Latest tech news from vedio_genspack\n\n${articlesToSummary(articles)}`,
      process.env.YOUTUBE_PRIVACY || 'public'
    )

    res.json({
      success: true,
      youtube: youtubeResult,
      headline: articles[0]?.title,
      videoId: youtubeResult?.id,
    })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

export default router
