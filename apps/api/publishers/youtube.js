import { existsSync, readFileSync } from 'node:fs'

const CLIENT_ID = process.env.YOUTUBE_CLIENT_ID
const CLIENT_SECRET = process.env.YOUTUBE_CLIENT_SECRET
const REFRESH_TOKEN = process.env.YOUTUBE_REFRESH_TOKEN
const REDIRECT_URI = process.env.YOUTUBE_REDIRECT_URI || 'https://video-gen-stack-production.up.railway.app/api/auth/youtube/callback'
const BASE = 'https://www.googleapis.com'

export const authUrl = `https://accounts.google.com/o/oauth2/auth?client_id=${CLIENT_ID}&redirect_uri=${REDIRECT_URI}&scope=${encodeURIComponent('https://www.googleapis.com/auth/youtube.upload https://www.googleapis.com/auth/youtube.readonly https://www.googleapis.com/auth/youtube.force-ssl')}&response_type=code&access_type=offline`

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

// ─── publishVideo ────────────────────────────────────────────────────────────
// The production publishing contract: Video + Thumbnail → Published.
//
// NOT transactional — video and thumbnail uploads are independent. If thumbnail
// fails, the video remains published. Modelled as a state machine:
//
//   VIDEO_UPLOAD_PENDING → VIDEO_UPLOADED → THUMBNAIL_PENDING → PUBLISHED
//                         ↓ (thumbnail fails)
//                    THUMBNAIL_FAILED → Retry Queue
//
// Accepts either:
//   publishVideo({ videoUrl, thumbnailPath, metadata, niche })
//   publishVideo(videoUrl, title, description, privacy, coverPath)  // legacy
//
// Returns: PublishResult (state machine snapshot)
export async function publishVideo(inputOrUrl, titleOrOpts, description, privacy = 'public', coverPath = null) {
  let videoUrl, thumbnailPath, niche, _title, _description, _privacy
  if (typeof inputOrUrl === 'object' && inputOrUrl !== null) {
    const opts = inputOrUrl
    videoUrl = opts.videoUrl
    thumbnailPath = opts.thumbnailPath || opts.coverPath || null
    niche = opts.niche || null
    _title = opts.title || opts.metadata?.title || 'News Update'
    _description = opts.description || opts.metadata?.description || ''
    _privacy = opts.privacy || 'public'
  } else {
    videoUrl = inputOrUrl
    thumbnailPath = coverPath
    niche = null
    _title = titleOrOpts
    _description = description
    _privacy = privacy
  }

  const token = await getAccessToken()

  // State: VIDEO_UPLOAD_PENDING
  const videoResp = await fetch(videoUrl)
  if (!videoResp.ok) throw new Error(`Failed to fetch video data: ${videoResp.status} ${videoResp.statusText}`)
  const videoBuffer = await videoResp.arrayBuffer()
  console.log(`📤 Uploading to YouTube: ${(videoBuffer.byteLength / 1024 / 1024).toFixed(1)}MB`)

  const boundary = 'boundary123'
  const meta = JSON.stringify({
    snippet: { title: String(_title || 'News Update').slice(0, 100), description: String(_description || '').slice(0, 5000) },
    status: { privacyStatus: _privacy, selfDeclaredMadeForKids: false },
  })

  const body = [
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${meta}\r\n`,
    `--${boundary}\r\nContent-Type: video/mp4\r\n\r\n`,
    new Uint8Array(videoBuffer),
    `\r\n--${boundary}--\r\n`,
  ].map(b => typeof b === 'string' ? new TextEncoder().encode(b) : b)

  const combined = new Uint8Array(body.reduce((acc, b) => acc + b.length, 0))
  let offset = 0
  for (const b of body) { combined.set(b, offset); offset += b.length }

  const res = await fetch(`${BASE}/upload/youtube/v3/videos?part=snippet,status&uploadType=multipart`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': `multipart/related; boundary=${boundary}` },
    body: combined,
  })

  const data = await res.json()
  if (data.error) throw new Error(`YouTube upload failed: ${data.error.message || JSON.stringify(data.error)}`)
  if (!data.id) throw new Error('YouTube upload succeeded but no video ID returned')

  // State: VIDEO_UPLOADED
  console.log(`✅ YouTube upload complete: https://youtu.be/${data.id}`)

  // State: THUMBNAIL_PENDING → attempt thumbnail upload (independent)
  let thumbnailUploaded = false
  let thumbnailAttempts = 0
  let lastThumbnailError = null
  if (thumbnailPath) {
    thumbnailAttempts++
    try {
      await setThumbnail(token, data.id, thumbnailPath)
      thumbnailUploaded = true
    } catch (e) {
      lastThumbnailError = e.message
      console.warn(`⚠️  Thumbnail upload failed: ${e.message} (video still published, retry queued)`)
    }
  }

  // Return state machine snapshot
  return {
    videoId: data.id,
    url: `https://youtu.be/${data.id}`,
    niche: niche || null,
    // State machine fields
    videoUploaded: true,
    thumbnailUploaded,
    thumbnailAttempts,
    lastError: lastThumbnailError,
    metadata: { title: String(_title).slice(0, 100), privacy: _privacy },
  }
}

// Legacy uploadShort — kept for backward compatibility. Use publishVideo() for new code.
export async function uploadShort(videoUrl, title, description, privacy = 'public', coverPath = null) {
  return publishVideo({ videoUrl, title, description, privacy, thumbnailPath: coverPath })
}

export async function setThumbnail(token, videoId, coverPath) {
  if (!coverPath) coverPath = 'output/cover.png'
  if (!existsSync(coverPath)) {
    console.warn(`⚠️  Cover image not found at ${coverPath} — skipping thumbnail`)
    return { ok: false, reason: 'not found' }
  }

  const thumbBuffer = readFileSync(coverPath)
  if (!thumbBuffer.length) {
    console.warn(`⚠️  Cover image empty: ${coverPath} — skipping thumbnail`)
    return { ok: false, reason: 'empty file' }
  }

  const ext = coverPath.toLowerCase().split('.').pop()
  const MIME_BY_EXT = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg' }
  const mimeType = MIME_BY_EXT[ext]
  if (!mimeType) {
    console.warn(`⚠️  Unsupported thumbnail format: ${ext} — skipping thumbnail`)
    return { ok: false, reason: `unsupported format: ${ext}` }
  }

  const boundary = 'thumb_boundary'
  const parts = [
    new TextEncoder().encode(`--${boundary}\r\nContent-Type: ${mimeType}\r\n\r\n`),
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
    return { ok: false, reason: data.error.message }
  }

  console.log(`✅ YouTube thumbnail set: ${data.items?.length || 0} items (${mimeType})`)
  // Note: hasCustomThumbnail verification happens in the VERIFY stage
  // (PostPublishVerifier) — not here, because the video may not have
  // propagated to videos.list immediately after upload.
  return { ok: true, items: data.items?.length || 0, mimeType }
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

export async function deleteVideo(videoId) {
  const token = await getAccessToken()
  const res = await fetch(`${BASE}/youtube/v3/videos?id=${videoId}`, {
    method: 'DELETE',
    headers: { 'Authorization': `Bearer ${token}` },
  })
  if (!res.ok) {
    const err = await res.text()
    throw new Error(`Delete failed (${res.status}): ${err}`)
  }
  console.log(`🗑️  Deleted video ${videoId}`)
  return true
}
