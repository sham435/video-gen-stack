import { Router } from 'express'
import { readFileSync, unlinkSync } from 'fs'

const router = Router()

router.post('/premium-render', async (req, res) => {
  const { headline, source, publishedAt, category } = req.body
  if (!headline) return res.status(400).json({ error: 'headline required' })

  try {
    const { renderWithRemotion } = await import('../services/remotion.js')
    const videoPath = await renderWithRemotion({ headline, source, publishedAt, category })
    const buffer = readFileSync(videoPath)
    const base64 = buffer.toString('base64')
    unlinkSync(videoPath)

    res.json({
      status: 'rendered',
      size: buffer.length,
      data: `data:video/mp4;base64,${base64}`,
    })
  } catch (e) {
    res.status(500).json({ error: e.message, note: 'Remotion not available on this platform. Use /api/cron/news-video for FFmpeg fallback.' })
  }
})

export default router
