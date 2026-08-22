// YouTube Studio auto-thumbnail route.
//
//   POST /api/youtube/set-thumbnail
//     body: { videoId, headline?, article?, niche?, heroImage? }
//     1. resolve the niche (explicit > article text via detectNiche)
//     2. render the 16:9 thumbnail with the niche pill (CoverComposer)
//     3. upload it via thumbnails.set using the stored refresh token
//   GET  /api/youtube/set-thumbnail/help  — shows what to wire on the frontend
//
// Auth mirrors the rest of the API: requireAuth (the dashboard owner only).
import { Router } from 'express'
import { requireAuth } from '../../packages/auth/requireAuth.js'
import { resolveNicheSync } from '../pipeline/NicheResolver.mjs'
import { getProfile } from '../production/CategoryProductionProfiles.mjs'
import { renderNicheThumbnail } from '../youtube/nicheDetector.mjs'
import { setNicheThumbnail } from '../youtube/youtubeStudioLink.mjs'

const router = Router()

router.get('/set-thumbnail/help', (_req, res) => {
  res.json({
    message: 'Link your stack to YouTube Studio, then POST here to auto-set a niche thumbnail.',
    post: {
      url: '/api/youtube/set-thumbnail',
      body: { videoId: 'Ys8u...', headline: 'Tesla stock surges', article: 'Tesla ...', niche: 'TESLA (optional)', heroImage: 'path or url (optional)' },
    },
    link: '/api/youtube/auth',
    scope: 'https://www.googleapis.com/auth/youtube.upload',
  })
})

router.post('/set-thumbnail', requireAuth, async (req, res) => {
  const { videoId, headline, article, niche, heroImage } = req.body || {}
  if (!videoId) return res.status(400).json({ success: false, error: 'videoId is required' })

  try {
    const { normalize } = await import('../youtube/nicheResolver.mjs')
    const nicheInput = niche || normalize(article || headline || '') || null
    const decision = resolveNicheSync(article || headline || '', nicheInput)
    const profile = getProfile(decision.key)
    const { buffer } = await renderNicheThumbnail({
      niche: decision.key,
      headline: headline || 'BREAKING NEWS',
      heroImage: heroImage || null,
      profile,
    })
    const result = await setNicheThumbnail({
      videoId,
      thumbnailBuffer: buffer,
      refreshToken: process.env.YOUTUBE_REFRESH_TOKEN,
    })
    res.json({ success: true, niche: decision.key, confidence: decision.confidence, source: decision.source, videoId, youtube: result.data })
  } catch (e) {
    res.status(502).json({ success: false, error: e.message, niche: niche || null })
  }
})

export default router
