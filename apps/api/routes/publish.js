import { Router } from 'express'
import { requireAuth } from '../../../packages/auth/requireAuth.js'
import { readFileSync, writeFileSync } from 'fs'
import { resolve } from 'path'

const router = Router()

const ENV_PATH = resolve(process.cwd(), '.env')

function saveEnv(entries) {
  let content = ''
  try { content = readFileSync(ENV_PATH, 'utf-8') } catch {}
  const lines = content.split('\n')
  for (const [key, value] of Object.entries(entries)) {
    if (!value) continue
    const idx = lines.findIndex(l => l.startsWith(`${key}=`))
    if (idx >= 0) lines[idx] = `${key}=${value}`
    else lines.push(`${key}=${value}`)
  }
  writeFileSync(ENV_PATH, lines.join('\n').replace(/\n+$/, '') + '\n')
}

// ── TikTok Auth ──
router.get('/tiktok/auth', (req, res) => {
  res.redirect(`https://www.tiktok.com/v2/auth/authorize?client_key=${process.env.TIKTOK_CLIENT_KEY}&scope=user.info.basic,video.publish&response_type=code&redirect_uri=${encodeURIComponent(process.env.TIKTOK_REDIRECT_URI || 'http://localhost:4567/auth/tiktok/callback')}`)
})

router.get('/auth/tiktok/callback', async (req, res) => {
  const { code } = req.query
  if (!code) return res.status(400).send('No code')

  const resp = await fetch('https://open.tiktokapis.com/v2/oauth/token/', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_key: process.env.TIKTOK_CLIENT_KEY,
      client_secret: process.env.TIKTOK_CLIENT_SECRET,
      code,
      grant_type: 'authorization_code',
      redirect_uri: process.env.TIKTOK_REDIRECT_URI || 'http://localhost:4567/auth/tiktok/callback',
    }),
  })
  const data = await resp.json()
  if (!data.access_token) {
    return res.json({ success: false, error: data.error || 'tiktok auth failed' })
  }
  try {
    saveEnv({
      TIKTOK_ACCESS_TOKEN: data.access_token,
      TIKTOK_OPEN_ID: data.open_id || '',
      TIKTOK_REFRESH_TOKEN: data.refresh_token || '',
    })
    res.json({ success: true, saved: 'TikTok credentials written to .env' })
  } catch {
    res.json({ success: true, saved: false, error: 'credentials not persisted — add them to .env manually' })
  }
})

// ── YouTube Auth ──
router.get('/youtube/auth', (req, res) => {
  res.redirect(`https://accounts.google.com/o/oauth2/auth?client_id=${process.env.YOUTUBE_CLIENT_ID}&redirect_uri=${encodeURIComponent(process.env.YOUTUBE_REDIRECT_URI || 'http://localhost:4567/auth/youtube/callback')}&scope=https://www.googleapis.com/auth/youtube.upload&response_type=code&access_type=offline`)
})

router.get('/auth/youtube/callback', async (req, res) => {
  const { code } = req.query
  if (!code) return res.status(400).send('No code')

  const resp = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: process.env.YOUTUBE_CLIENT_ID,
      client_secret: process.env.YOUTUBE_CLIENT_SECRET,
      code,
      grant_type: 'authorization_code',
      redirect_uri: process.env.YOUTUBE_REDIRECT_URI || 'http://localhost:4567/auth/youtube/callback',
    }),
  })
  const data = await resp.json()
  if (!data.refresh_token) {
    return res.json({ success: false, error: data.error || 'youtube auth failed' })
  }
  try {
    saveEnv({ YOUTUBE_REFRESH_TOKEN: data.refresh_token })
    res.json({ success: true, saved: 'YouTube refresh token written to .env' })
  } catch {
    res.json({ success: true, saved: false, error: 'token not persisted — add YOUTUBE_REFRESH_TOKEN to .env manually' })
  }
})

// ── Publish Video ──
router.post('/publish', requireAuth, async (req, res) => {
  const { videoUrl, title, description, platforms } = req.body
  if (!videoUrl) return res.status(400).json({ error: 'videoUrl required' })

  const results = {}
  const targets = platforms || ['tiktok', 'youtube']

  if (targets.includes('tiktok')) {
    try {
      const { uploadVideo } = await import('../publishers/tiktok.js')
      const token = process.env.TIKTOK_ACCESS_TOKEN
      const openId = process.env.TIKTOK_OPEN_ID
      if (token && openId) {
        const r = await uploadVideo(token, openId, videoUrl, description, process.env.TIKTOK_PRIVACY)
        results.tiktok = r
      } else {
        results.tiktok = { error: 'TikTok not authenticated. Visit /api/tiktok/auth' }
      }
    } catch (e) { results.tiktok = { error: e.message } }
  }

  if (targets.includes('youtube')) {
    try {
      const { uploadShort } = await import('../publishers/youtube.js')
      if (process.env.YOUTUBE_REFRESH_TOKEN) {
        const r = await uploadShort(videoUrl, title, description, process.env.YOUTUBE_PRIVACY)
        results.youtube = r
      } else {
        results.youtube = { error: 'YouTube not authenticated. Visit /api/youtube/auth' }
      }
    } catch (e) { results.youtube = { error: e.message } }
  }

  res.json({ videoUrl, results })
})

export default router
