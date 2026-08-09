import { existsSync, readFileSync } from 'node:fs'

const CLIENT_ID = process.env.YOUTUBE_CLIENT_ID
const CLIENT_SECRET = process.env.YOUTUBE_CLIENT_SECRET
const REFRESH_TOKEN = process.env.YOUTUBE_REFRESH_TOKEN
const REDIRECT_URI = process.env.YOUTUBE_REDIRECT_URI || 'https://video-gen-stack-production.up.railway.app/api/auth/youtube/callback'
const BASE = 'https://www.googleapis.com'

export const authUrl = `https://accounts.google.com/o/oauth2/auth?client_id=${CLIENT_ID}&redirect_uri=${REDIRECT_URI}&scope=${encodeURIComponent('https://www.googleapis.com/auth/youtube.upload https://www.googleapis.com/auth/youtube.force-ssl')}&response_type=code&access_type=offline`

export async function exchangeCode(code) {
  const res = await fetch(`${BASE}/oauth2/v4/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      code,
      grant_type: 'authorization_code',
      redirect_uri: REDIRECT_URI,
    }),
  })
  return res.json()
}

export async function getAccessToken() {
  if (!REFRESH_TOKEN) throw new Error('YOUTUBE_REFRESH_TOKEN not set. Complete OAuth first.')
  const res = await fetch(`${BASE}/oauth2/v4/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      refresh_token: REFRESH_TOKEN,
      grant_type: 'refresh_token',
    }),
  })
  const data = await res.json()
  return data.access_token
}

export async function uploadShort(videoUrl, title, description, privacy = 'public', coverPath = null) {
  const token = await getAccessToken()

  const videoResp = await fetch(videoUrl)
  if (!videoResp.ok) {
    throw new Error(`Failed to fetch video data: ${videoResp.status} ${videoResp.statusText}`)
  }
  const videoBuffer = await videoResp.arrayBuffer()
  console.log(`📤 Uploading to YouTube: ${(videoBuffer.byteLength / 1024 / 1024).toFixed(1)}MB`)

  // YouTube uses multipart upload
  const boundary = 'boundary123'
  const metadata = JSON.stringify({
    snippet: { title: title.slice(0, 100), description: description.slice(0, 5000) },
    status: { privacyStatus: privacy, selfDeclaredMadeForKids: false },
  })

  const body = [
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${metadata}\r\n`,
    `--${boundary}\r\nContent-Type: video/mp4\r\n\r\n`,
    new Uint8Array(videoBuffer),
    `\r\n--${boundary}--\r\n`,
  ].map(b => typeof b === 'string' ? new TextEncoder().encode(b) : b)

  const combined = new Uint8Array(body.reduce((acc, b) => acc + b.length, 0))
  let offset = 0
  for (const b of body) { combined.set(b, offset); offset += b.length }

  const res = await fetch(`${BASE}/upload/youtube/v3/videos?part=snippet,status&uploadType=multipart`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': `multipart/related; boundary=${boundary}`,
    },
    body: combined,
  })

  const data = await res.json()

  if (data.error) {
    console.error('❌ YouTube API error:', data.error.message || JSON.stringify(data.error))
    throw new Error(`YouTube upload failed: ${data.error.message || JSON.stringify(data.error)}`)
  }

  if (!data.id) {
    console.error('❌ YouTube response missing video ID:', JSON.stringify(data).slice(0, 500))
    throw new Error('YouTube upload succeeded but no video ID returned')
  }

  console.log(`✅ YouTube upload complete: https://youtu.be/${data.id}`)

  // Upload thumbnail if provided
  if (data.id) {
    try {
      await setThumbnail(token, data.id, coverPath)
    } catch (e) {
      console.warn(`⚠️  Thumbnail upload skipped: ${e.message}`)
    }
  }

  return data
}

export async function setThumbnail(token, videoId, coverPath) {
  if (!coverPath) coverPath = 'output/cover.png'
  if (!existsSync(coverPath)) {
    console.warn(`⚠️  Cover image not found at ${coverPath} — skipping thumbnail`)
    return
  }

  const thumbBuffer = readFileSync(coverPath)

  const boundary = 'thumb_boundary'
  const parts = [
    new TextEncoder().encode(`--${boundary}\r\nContent-Type: image/png\r\n\r\n`),
    thumbBuffer,
    new TextEncoder().encode(`\r\n--${boundary}--\r\n`),
  ]
  const body = new Uint8Array(parts.reduce((acc, b) => acc + b.length, 0))
  let offset = 0
  for (const b of parts) { body.set(b, offset); offset += b.length }

  const res = await fetch(
    `https://www.googleapis.com/upload/youtube/v3/thumbnails/set?videoId=${videoId}`,
    {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': `multipart/related; boundary=${boundary}`,
      },
      body,
    }
  )

  const data = await res.json()
  if (data.error) {
    console.warn(`⚠️  YouTube thumbnail upload failed: ${data.error.message}`)
  } else {
    console.log(`✅ YouTube thumbnail set: ${data.items?.length || 0} items`)
  }
}

// Find the channel's own top-level comment on a video (e.g. manually pinned
// in Studio) — used as the parent for API comment replies.
async function findOwnTopLevelComment(token, videoId) {
  const vres = await fetch(`${BASE}/youtube/v3/videos?part=snippet&id=${videoId}`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  const vdata = await vres.json()
  const channelId = vdata.items?.[0]?.snippet?.channelId
  if (!channelId) return null

  const tres = await fetch(`${BASE}/youtube/v3/commentThreads?part=snippet&videoId=${videoId}&maxResults=20`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  const tdata = await tres.json()
  const own = (tdata.items || []).find(
    (t) => t.snippet?.topLevelComment?.snippet?.authorChannelId?.value === channelId
  )
  return own?.snippet?.topLevelComment?.id || null
}

// Post a comment on a published video (best-effort). YouTube's public API no
// longer creates top-level comments, so the CTA is posted as a REPLY to the
// channel's own comment — discovered automatically, or via
// YOUTUBE_PARENT_COMMENT_ID (the pinned comment's ID in Studio).
export async function postComment(videoId, text) {
  if (!videoId || !text) return null
  const token = await getAccessToken()
  let parentId = process.env.YOUTUBE_PARENT_COMMENT_ID
  if (!parentId) {
    try { parentId = await findOwnTopLevelComment(token, videoId) } catch { parentId = null }
  }
  const snippet = { videoId, textOriginal: text.slice(0, 500) }
  if (parentId) snippet.parentId = parentId

  const res = await fetch(`${BASE}/youtube/v3/comments?part=snippet`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ snippet }),
  })
  const data = await res.json()
  if (data.error) {
    if (String(data.error.message).includes('parentId')) {
      console.warn('⚠️  Comment post failed: YouTube no longer allows API top-level comments. Pin one manually in Studio (https://support.google.com/youtube/answer/171664?hl=en), then set YOUTUBE_PARENT_COMMENT_ID to that comment\'s ID so the pipeline replies to it.')
    } else {
      console.warn(`⚠️  Comment post failed: ${data.error.message}`)
    }
    return null
  }
  console.log(`${parentId ? '✅ Comment reply posted' : '✅ Comment posted'}: ${data.snippet?.textOriginal?.slice(0, 60)}...`)
  return data
}
