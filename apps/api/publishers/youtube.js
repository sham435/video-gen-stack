import { existsSync, readFileSync } from 'node:fs'

const CLIENT_ID = process.env.YOUTUBE_CLIENT_ID
const CLIENT_SECRET = process.env.YOUTUBE_CLIENT_SECRET
const REFRESH_TOKEN = process.env.YOUTUBE_REFRESH_TOKEN
const REDIRECT_URI = process.env.YOUTUBE_REDIRECT_URI || 'https://video-gen-stack-production.up.railway.app/api/auth/youtube/callback'

const GOOGLE_OAUTH_BASE = 'https://accounts.google.com'
const GOOGLE_API_BASE = 'https://www.googleapis.com'
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token'

const YOUTUBE_SCOPES = [
  'https://www.googleapis.com/auth/youtube.upload',
  'https://www.googleapis.com/auth/youtube.readonly',
  'https://www.googleapis.com/auth/youtube.force-ssl',
]

const REQUEST_TIMEOUT_MS = Number(process.env.YOUTUBE_REQUEST_TIMEOUT_MS || 60_000)

const MIME_BY_EXT = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg' }

/**
 * --------------------------------------------------------------------------
 * Configuration
 * --------------------------------------------------------------------------
 */

function assertOAuthConfig() {
  const missing = []
  if (!CLIENT_ID) missing.push('YOUTUBE_CLIENT_ID')
  if (!CLIENT_SECRET) missing.push('YOUTUBE_CLIENT_SECRET')
  if (missing.length) throw new Error(`YOUTUBE_OAUTH_CONFIG_MISSING: ${missing.join(', ')}`)
}

function assertRefreshToken() {
  if (!REFRESH_TOKEN) throw new Error('YOUTUBE_REFRESH_TOKEN_NOT_SET: complete OAuth authorization first')
}

/**
 * --------------------------------------------------------------------------
 * HTTP
 * --------------------------------------------------------------------------
 */

async function fetchWithTimeout(url, options = {}, timeoutMs = REQUEST_TIMEOUT_MS) {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), timeoutMs)
  try {
    return await fetch(url, { ...options, signal: controller.signal })
  } catch (error) {
    if (error?.name === 'AbortError') throw new Error(`YOUTUBE_REQUEST_TIMEOUT: ${timeoutMs}ms`)
    throw error
  } finally {
    clearTimeout(timeout)
  }
}

async function readJson(response) {
  return response.json().catch(() => ({}))
}

function youtubeApiError(data, fallbackStatus) {
  const error = data?.error
  const message = error?.message || `HTTP ${fallbackStatus} ${error?.status || ''}`.trim() || 'unknown YouTube API error'
  const err = new Error(`YOUTUBE_API_ERROR: ${message}`)
  err.httpStatus = fallbackStatus
  err.reason = error?.errors?.[0]?.reason || error?.status || null
  err.youtubeError = error || null
  return err
}

/**
 * --------------------------------------------------------------------------
 * OAuth
 * --------------------------------------------------------------------------
 */
function buildAuthUrl() {
  const url = new URL('/o/oauth2/v2/auth', GOOGLE_OAUTH_BASE)
  url.search = new URLSearchParams({
    client_id: CLIENT_ID,
    redirect_uri: REDIRECT_URI,
    response_type: 'code',
    access_type: 'offline',
    prompt: 'consent',
    include_granted_scopes: 'true',
    scope: YOUTUBE_SCOPES.join(' '),
  }).toString()
  return url.toString()
}

export const authUrl = buildAuthUrl()

export async function exchangeCode(code) {
  assertOAuthConfig()
  if (!code) throw new Error('YOUTUBE_OAUTH_CODE_REQUIRED')

  const response = await fetchWithTimeout(GOOGLE_TOKEN_URL, {
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

  const data = await readJson(response)
  if (!response.ok) throw youtubeApiError(data, response.status)
  if (!data.access_token) throw new Error('YOUTUBE_OAUTH_ACCESS_TOKEN_MISSING')
  return data
}

export async function getAccessToken() {
  assertOAuthConfig()
  assertRefreshToken()

  const response = await fetchWithTimeout(GOOGLE_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      refresh_token: REFRESH_TOKEN,
      grant_type: 'refresh_token',
    }),
  })

  const data = await readJson(response)
  if (!response.ok) throw youtubeApiError(data, response.status)
  if (!data.access_token) throw new Error('YOUTUBE_ACCESS_TOKEN_MISSING')
  return data.access_token
}

/**
 * Validate refresh token + actual granted OAuth scopes via Google tokeninfo.
 * Separate from YouTube API authorization probing.
 */
export async function validateOAuthScopes() {
  try {
    const token = await getAccessToken()
    const response = await fetchWithTimeout(
      `${GOOGLE_OAUTH_BASE}/oauth2/v3/tokeninfo?access_token=${encodeURIComponent(token)}`
    )
    const data = await readJson(response)
    if (!response.ok) return { ok: false, error: data?.error_description || `HTTP ${response.status}`, httpStatus: response.status }

    const grantedScopes = new Set(String(data.scope || '').split(/\s+/).map(s => s.trim()).filter(Boolean))
    const missingScopes = YOUTUBE_SCOPES.filter(scope => !grantedScopes.has(scope))
    if (missingScopes.length) {
      return { ok: false, error: 'YOUTUBE_OAUTH_SCOPES_INCOMPLETE', missingScopes, grantedScopes: [...grantedScopes] }
    }
    return { ok: true, grantedScopes: [...grantedScopes] }
  } catch (error) {
    return { ok: false, error: error.message }
  }
}

/**
 * --------------------------------------------------------------------------
 * Thumbnail byte-signature validation (no native decoders)
 * --------------------------------------------------------------------------
 */
function validateThumbnailBytes(buffer, mimeType) {
  if (!buffer?.length) throw new Error('THUMBNAIL_EMPTY')

  if (mimeType === 'image/png') {
    const valid =
      buffer.length >= 8 &&
      buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47 &&
      buffer[4] === 0x0d && buffer[5] === 0x0a && buffer[6] === 0x1a && buffer[7] === 0x0a
    if (!valid) throw new Error('THUMBNAIL_INVALID_PNG_SIGNATURE')
    return
  }

  if (mimeType === 'image/jpeg') {
    const valid = buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff
    if (!valid) throw new Error('THUMBNAIL_INVALID_JPEG_SIGNATURE')
    return
  }

  throw new Error(`THUMBNAIL_UNSUPPORTED_MIME: ${mimeType}`)
}

/**
 * --------------------------------------------------------------------------
 * YouTube video upload
 * --------------------------------------------------------------------------
 */
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

  if (!videoUrl) throw new Error('YOUTUBE_VIDEO_URL_REQUIRED')
  if (!['public', 'private', 'unlisted'].includes(_privacy)) throw new Error(`YOUTUBE_INVALID_PRIVACY_STATUS: ${_privacy}`)

  const token = await getAccessToken()

  // State: VIDEO_UPLOAD_PENDING
  console.log(`[YOUTUBE_VIDEO_UPLOAD] START`)
  const videoResponse = await fetchWithTimeout(videoUrl)
  if (!videoResponse.ok) throw new Error(`VIDEO_SOURCE_FETCH_FAILED: ${videoResponse.status} ${videoResponse.statusText}`)
  const videoBuffer = await videoResponse.arrayBuffer()
  if (!videoBuffer.byteLength) throw new Error('VIDEO_SOURCE_EMPTY')
  console.log(`[YOUTUBE_VIDEO_UPLOAD] bytes=${videoBuffer.byteLength} sizeMB=${(videoBuffer.byteLength / 1024 / 1024).toFixed(1)}`)

  const boundary = `youtube-${Date.now()}-${Math.random().toString(16).slice(2)}`
  const meta = JSON.stringify({
    snippet: { title: String(_title || 'News Update').slice(0, 100), description: String(_description || '').slice(0, 5000) },
    status: { privacyStatus: _privacy, selfDeclaredMadeForKids: false },
  })

  const parts = [
    Buffer.from(`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${meta}\r\n`),
    Buffer.from(`--${boundary}\r\nContent-Type: video/mp4\r\n\r\n`),
    Buffer.from(videoBuffer),
    Buffer.from(`\r\n--${boundary}--\r\n`),
  ]
  const requestBody = Buffer.concat(parts)

  const response = await fetchWithTimeout(
    `${GOOGLE_API_BASE}/upload/youtube/v3/videos?part=snippet,status&uploadType=multipart`,
    {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': `multipart/related; boundary=${boundary}` },
      body: requestBody,
    },
    Math.max(REQUEST_TIMEOUT_MS, 120_000)
  )

  const data = await readJson(response)
  if (!response.ok || data.error) throw youtubeApiError(data, response.status)
  if (!data.id) throw new Error('YOUTUBE_VIDEO_UPLOAD_SUCCEEDED_WITHOUT_VIDEO_ID')

  const videoId = data.id
  console.log(`[YOUTUBE_VIDEO_UPLOAD] success videoId=${videoId} url=https://youtu.be/${videoId}`)

  // State: THUMBNAIL_PENDING → attempt thumbnail upload (independent).
  // thumbnailUploaded means only thumbnails.set succeeded — NOT that YouTube
  // propagated the thumbnail. The propagation verifier owns that truth.
  let thumbnailUploaded = false
  let thumbnailAttempts = 0
  let lastThumbnailError = null
  if (thumbnailPath) {
    thumbnailAttempts = 1
    try {
      await setThumbnail(token, videoId, thumbnailPath)
      thumbnailUploaded = true
    } catch (e) {
      lastThumbnailError = e.message
      console.warn(`[YOUTUBE_THUMBNAIL] upload failed videoId=${videoId} error=${e.message} (video still published)`)
    }
  }

  return {
    videoId,
    url: `https://youtu.be/${videoId}`,
    niche: niche || null,
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

/**
 * Upload a custom thumbnail for a video.
 *
 * SSOT: the canonical LOCAL thumbnail artifact (2160x3840 PNG) is the only
 * source uploaded here. NEVER pass a C2PA-signed PNG — C2PA PNGs carry embedded
 * manifest data YouTube's thumbnail API cannot render; always the original
 * canonical artifact.
 *
 * thumbnails.set is a MEDIA UPLOAD endpoint — the raw image bytes are the POST
 * body (Content-Type: image/png), NOT multipart. No native image decoding (a
 * decoder crash on the hot upload path is unacceptable); only byte-signature
 * validation + SHA-256 preflight.
 *
 * A 2xx response is NOT authoritative acceptance. Propagation is confirmed by
 * YouTubePropagationVerifier (hasCustomThumbnail + remote 9:16 geometry).
 */
export async function setThumbnail(token, videoId, thumbnailPath) {
  if (!token) throw new Error('YOUTUBE_ACCESS_TOKEN_REQUIRED')
  if (!videoId) throw new Error('YOUTUBE_VIDEO_ID_REQUIRED')
  if (!thumbnailPath) throw new Error('THUMBNAIL_PATH_REQUIRED')
  if (!existsSync(thumbnailPath)) throw new Error(`THUMBNAIL_NOT_FOUND: ${thumbnailPath}`)

  const thumbnailBuffer = readFileSync(thumbnailPath)
  if (!thumbnailBuffer.length) throw new Error(`THUMBNAIL_EMPTY: ${thumbnailPath}`)

  const ext = thumbnailPath.toLowerCase().split('.').pop()
  const mimeType = MIME_BY_EXT[ext]
  if (!mimeType) throw new Error(`THUMBNAIL_UNSUPPORTED_FORMAT: ${ext}`)

  validateThumbnailBytes(thumbnailBuffer, mimeType)

  const { sha256Thumbnail } = await import('../../../src/thumbnail/ThumbnailMetadata.mjs')
  const thumbnailSha256 = sha256Thumbnail(thumbnailPath)

  console.log(`[YOUTUBE_THUMBNAIL] videoId=${videoId} source=${thumbnailPath} mime=${mimeType} bytes=${thumbnailBuffer.length} sha256=${thumbnailSha256 ? thumbnailSha256.slice(0, 12) + '…' : 'unknown'} uploadMode=simple-media`)
  console.log(`[YOUTUBE_THUMBNAIL_UPLOAD] START videoId=${videoId}`)

  const response = await fetchWithTimeout(
    `${GOOGLE_API_BASE}/upload/youtube/v3/thumbnails/set?videoId=${encodeURIComponent(videoId)}`,
    {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': mimeType },
      body: thumbnailBuffer,
    },
  )

  const data = await readJson(response)
  if (!response.ok || data.error) {
    const error = youtubeApiError(data, response.status)
    console.warn(`[YOUTUBE_THUMBNAIL_UPLOAD] FAIL videoId=${videoId} http=${response.status} error=${error.message}`)
    throw new Error(`YOUTUBE_THUMBNAIL_UPLOAD_FAILED: ${error.message}`)
  }

  const items = data.items?.length || 0
  const remoteThumbnail = data.items?.[0]?.snippet?.thumbnails?.maxres
    || data.items?.[0]?.snippet?.thumbnails?.standard
    || data.items?.[0]?.snippet?.thumbnails?.high
    || null

  console.log(`[YOUTUBE_THUMBNAIL_UPLOAD] SUCCESS videoId=${videoId} http=${response.status} items=${items} mime=${mimeType} bytes=${thumbnailBuffer.length} responseThumbnailUrl=${remoteThumbnail?.url || 'none'}`)

  // Diagnostic only — never determines acceptance. Propagation verifier is authoritative.
  try {
    await verifyThumbnailRepresentation(token, videoId)
  } catch (error) {
    console.warn(`[YOUTUBE_THUMBNAIL_VERIFY] diagnostic failed: ${error.message}`)
  }

  return { ok: true, videoId, items, mimeType, bytes: thumbnailBuffer.length, sha256: thumbnailSha256 }
}

/** Diagnostic representation check — authoritative propagation is YouTubePropagationVerifier's job. */
async function verifyThumbnailRepresentation(token, videoId) {
  const response = await fetchWithTimeout(
    `${GOOGLE_API_BASE}/youtube/v3/videos?part=contentDetails,snippet&id=${encodeURIComponent(videoId)}`,
    { headers: { 'Authorization': `Bearer ${token}` } },
  )
  const data = await readJson(response)
  if (!response.ok) throw youtubeApiError(data, response.status)

  const video = data.items?.[0]
  if (!video) throw new Error(`YOUTUBE_VIDEO_NOT_VISIBLE: ${videoId}`)

  const hasCustomThumbnail = video.contentDetails?.hasCustomThumbnail === true
  const thumbnails = video.snippet?.thumbnails || {}
  const remote = thumbnails.maxres || thumbnails.standard || thumbnails.high || thumbnails.medium || null
  const remoteType = remote ? (Object.entries(thumbnails).find(([, v]) => v === remote)?.[0] || 'unknown') : 'none'
  const width = remote?.width ?? null
  const height = remote?.height ?? null

  console.log(`[YOUTUBE_THUMBNAIL_VERIFY] videoId=${videoId} hasCustomThumbnail=${hasCustomThumbnail} remoteSource=${remoteType} remoteUrl=${remote?.url || 'none'} remoteWidth=${width} remoteHeight=${height} remoteAspectRatio=${width && height ? `${width}:${height}` : 'n/a'} apiStatus=${response.status}`)

  return { hasCustomThumbnail, remote }
}

/**
 * --------------------------------------------------------------------------
 * Comments
 * --------------------------------------------------------------------------
 */
async function findOwnTopLevelComment(token, videoId) {
  const videoResponse = await fetchWithTimeout(
    `${GOOGLE_API_BASE}/youtube/v3/videos?part=snippet&id=${encodeURIComponent(videoId)}`,
    { headers: { 'Authorization': `Bearer ${token}` } },
  )
  const videoData = await readJson(videoResponse)
  if (!videoResponse.ok) throw youtubeApiError(videoData, videoResponse.status)
  const channelId = videoData.items?.[0]?.snippet?.channelId
  if (!channelId) return null

  const response = await fetchWithTimeout(
    `${GOOGLE_API_BASE}/youtube/v3/commentThreads?part=snippet&videoId=${encodeURIComponent(videoId)}&maxResults=20`,
    { headers: { 'Authorization': `Bearer ${token}` } },
  )
  const data = await readJson(response)
  if (!response.ok) throw youtubeApiError(data, response.status)
  const ownComment = (data.items || []).find(
    t => t.snippet?.topLevelComment?.snippet?.authorChannelId?.value === channelId
  )
  return ownComment?.snippet?.topLevelComment?.id || null
}

/**
 * Post a CTA as a reply to the channel's own existing comment.
 * YOUTUBE_PARENT_COMMENT_ID should normally be configured for deterministic
 * behavior. A missing parent is an explicit state (PARENT_COMMENT_NOT_FOUND),
 * never an attempt at an unsupported top-level comment.
 */
export async function postComment(videoId, text) {
  if (!videoId || !text) return null

  const token = await getAccessToken()
  let parentId = process.env.YOUTUBE_PARENT_COMMENT_ID || null

  if (!parentId) {
    try {
      parentId = await findOwnTopLevelComment(token, videoId)
    } catch (error) {
      console.warn(`[YOUTUBE_COMMENT] parent lookup failed: ${error.message}`)
    }
  }

  if (!parentId) {
    console.warn(`[YOUTUBE_COMMENT] skipped: no parent comment found videoId=${videoId}`)
    return { ok: false, skipped: true, reason: 'PARENT_COMMENT_NOT_FOUND' }
  }

  const snippet = { videoId, parentId, textOriginal: String(text).slice(0, 500) }

  const response = await fetchWithTimeout(
    `${GOOGLE_API_BASE}/youtube/v3/comments?part=snippet`,
    {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ snippet }),
    },
  )

  const data = await readJson(response)
  if (!response.ok || data.error) {
    const error = youtubeApiError(data, response.status)
    console.warn(`[YOUTUBE_COMMENT] FAIL videoId=${videoId} error=${error.message}`)
    return { ok: false, skipped: false, error: error.message }
  }

  console.log(`[YOUTUBE_COMMENT] reply posted videoId=${videoId} commentId=${data.id || 'unknown'}`)
  return data
}

export async function deleteVideo(videoId) {
  if (!videoId) throw new Error('YOUTUBE_VIDEO_ID_REQUIRED')
  const token = await getAccessToken()
  const response = await fetchWithTimeout(
    `${GOOGLE_API_BASE}/youtube/v3/videos?id=${encodeURIComponent(videoId)}`,
    { method: 'DELETE', headers: { 'Authorization': `Bearer ${token}` } },
  )
  if (!response.ok) {
    const data = await readJson(response)
    throw youtubeApiError(data, response.status)
  }
  console.log(`[YOUTUBE_DELETE] deleted videoId=${videoId}`)
  return true
}
