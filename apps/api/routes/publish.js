import { randomBytes, randomUUID } from 'crypto'
import { Router } from 'express'
import { requireAuth } from '../../../packages/auth/requireAuth.js'
import { validateBody, publishSchema } from '../../../packages/validation/schemas.mjs'
import { readFileSync, renameSync, writeFileSync } from 'fs'
import { dirname, resolve } from 'path'

const router = Router()

const ENV_PATH = resolve(process.cwd(), '.env')

// OAuth `state` protection: an attacker can never complete their own OAuth
// dance against this deployment because the callback must echo the state that
// the (authenticated) /auth redirect endpoint issued. States are single-use
// and expire after 10 minutes.
const OAUTH_PURPOSES = new Set(['tiktok', 'youtube', 'linkedin'])
let oauthStates = new Map() // state -> { purpose, expiresAt }
let nextStateGc = 0
function gcOAuthStates() {
  const now = Date.now()
  if (nextStateGc > now) return
  for (const [token, s] of oauthStates) if (s.expiresAt <= now) oauthStates.delete(token)
  nextStateGc = now + 60_000
}
function issueOAuthState(purpose) {
  gcOAuthStates()
  const state = randomUUID() + randomBytes(16).toString('hex')
  oauthStates.set(state, { purpose, expiresAt: Date.now() + 10 * 60_000 })
  return state
}
function consumeOAuthState(state, purpose) {
  gcOAuthStates()
  const s = oauthStates.get(state)
  if (!s) return false
  oauthStates.delete(state)
  return s.purpose === purpose && s.expiresAt > Date.now()
}

// Atomic, crash-safe .env write (tmp + rename). Never leaves a half-written
// .env that would drop every other credential.
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
  const tmp = resolve(dirname(ENV_PATH), `.env.tmp-${randomBytes(6).toString('hex')}`)
  writeFileSync(tmp, lines.join('\n').replace(/\n+$/, '') + '\n')
  renameSync(tmp, ENV_PATH)
}

// ── TikTok Auth ──
router.get('/tiktok/auth', requireAuth, (req, res) => {
  const state = issueOAuthState('tiktok')
  res.redirect(`https://www.tiktok.com/v2/auth/authorize?client_key=${process.env.TIKTOK_CLIENT_KEY}&scope=user.info.basic,video.publish&response_type=code&state=${encodeURIComponent(state)}&redirect_uri=${encodeURIComponent(process.env.TIKTOK_REDIRECT_URI || 'http://localhost:4567/auth/tiktok/callback')}`)
})

router.get('/auth/tiktok/callback', async (req, res) => {
  const { code, state } = req.query
  if (!code) return res.status(400).send('No code')
  if (!consumeOAuthState(state, 'tiktok')) {
    return res.status(403).json({ success: false, error: 'invalid or expired OAuth state — re-authenticate from the dashboard' })
  }

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
    signal: AbortSignal.timeout(15000),
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
router.get('/youtube/auth', requireAuth, (req, res) => {
  const state = issueOAuthState('youtube')
  res.redirect(`https://accounts.google.com/o/oauth2/auth?client_id=${process.env.YOUTUBE_CLIENT_ID}&redirect_uri=${encodeURIComponent(process.env.YOUTUBE_REDIRECT_URI || 'http://localhost:4567/auth/youtube/callback')}&scope=https://www.googleapis.com/auth/youtube.upload&response_type=code&access_type=offline&state=${encodeURIComponent(state)}`)
})

router.get('/auth/youtube/callback', async (req, res) => {
  const { code, state } = req.query
  if (!code) return res.status(400).send('No code')
  if (!consumeOAuthState(state, 'youtube')) {
    return res.status(403).json({ success: false, error: 'invalid or expired OAuth state — re-authenticate from the dashboard' })
  }

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
    signal: AbortSignal.timeout(15000),
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

// ── LinkedIn Auth ──
router.get('/linkedin/auth', requireAuth, async (req, res) => {
  const state = issueOAuthState('linkedin')
  const { authUrl } = await useLinkedIn()
  res.redirect(`${authUrl}&state=${encodeURIComponent(state)}`)
})

router.get('/auth/linkedin/callback', async (req, res) => {
  const { code, state } = req.query
  if (!code) return res.status(400).send('No code')
  if (!consumeOAuthState(state, 'linkedin')) {
    return res.status(403).json({ success: false, error: 'invalid or expired OAuth state — re-authenticate from the dashboard' })
  }
  try {
    const { exchangeCode, getMemberUrn } = await useLinkedIn()
    const data = await exchangeCode(code)
    if (!data.access_token) {
      return res.json({ success: false, error: data.error_description || data.error || 'linkedin auth failed' })
    }
    const urn = await getMemberUrn(data.access_token)
    saveEnv({
      LINKEDIN_ACCESS_TOKEN: data.access_token,
      LINKEDIN_REFRESH_TOKEN: data.refresh_token || '',
      LINKEDIN_MEMBER_URN: urn,
      LINKEDIN_TOKEN_EXPIRES_AT: String(Date.now() + (data.expires_in || 5184000) * 1000),
    })
    res.json({ success: true, urn, saved: 'LinkedIn credentials written to .env' })
  } catch (e) {
    res.json({ success: false, saved: false, error: `credentials not persisted — add LINKEDIN_ACCESS_TOKEN to .env manually (${e.message})` })
  }
})

// Lazy dynamic import keeps the publisher module's process.env reads fresh
// after the callback rewrites .env (dotenv is loaded once at server boot).
async function useLinkedIn() {
  return import('../publishers/linkedin.js')
}

// ── Publish Video ──
router.post('/publish', requireAuth, validateBody(publishSchema), async (req, res) => {
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

  if (targets.includes('linkedin')) {
    try {
      const mod = await useLinkedIn()
      const token = mod.accessToken()
      const urn = mod.memberUrn()
      if (token && urn) {
        const r = await mod.shareVideo(token, urn, videoUrl, description || title || '')
        results.linkedin = r
      } else {
        results.linkedin = { error: 'LinkedIn not authenticated. Visit /api/linkedin/auth' }
      }
    } catch (e) { results.linkedin = { error: e.message } }
  }

  res.json({ videoUrl, results })
})

export default router
