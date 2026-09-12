import { existsSync, readFileSync } from 'node:fs'

const CLIENT_ID = process.env.YOUTUBE_CLIENT_ID
const CLIENT_SECRET = process.env.YOUTUBE_CLIENT_SECRET
// NOTE: refresh token is read at call time (envRefreshToken()) — it can be
// rotated at runtime (dashboard OAuth re-auth writes a new one into .env +
// process.env), so never freeze it into a module-level const.
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

// The video upload uses YouTube's resumable protocol: a bounded per-chunk PUT
// (see resumableUploadChunks). A 10-20MB MP4 at ~84KB/s egress takes minutes;
// the per-chunk timeout must allow a full chunk (default 4MB) to drain, so it
// is configurable via env with a 5-minute default (and at least 120s).
const UPLOAD_TIMEOUT_MS = Number(process.env.YOUTUBE_UPLOAD_TIMEOUT_MS || 300_000)

const MIME_BY_EXT = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg' }

/**
 * --------------------------------------------------------------------------
 * Access-token cache — keeps the token warm server-side so long renders /
 * scheduled uploads never hit a stale token. Google access tokens live ~1h;
 * we proactively refresh before expiry and reuse the cached token across calls.
 * --------------------------------------------------------------------------
 */
let cachedAccessToken = null
let cachedAtMs = 0
const ACCESS_TOKEN_TTL_MS = Number(process.env.YOUTUBE_ACCESS_TOKEN_TTL_MS || 3_600_000) // 1h
const REFRESH_MARGIN_MS = Number(process.env.YOUTUBE_TOKEN_REFRESH_MARGIN_MS || 10 * 60_000) // refresh 10min before expiry
const WARMUP_INTERVAL_MS = Number(process.env.YOUTUBE_TOKEN_WARMUP_INTERVAL_MS || 30 * 60_000) // every 30min
let warmupStarted = false

function envRefreshToken() {
  return process.env.YOUTUBE_REFRESH_TOKEN
}

export function cachedTokenInfo() {
  return {
    cached: !!cachedAccessToken,
    ageMs: cachedAccessToken ? Date.now() - cachedAtMs : null,
    ttlMs: ACCESS_TOKEN_TTL_MS,
    refreshMarginMs: REFRESH_MARGIN_MS,
    nextRefreshInMs: cachedAccessToken ? Math.max(0, ACCESS_TOKEN_TTL_MS - REFRESH_MARGIN_MS - (Date.now() - cachedAtMs)) : null,
  }
}

/**
 * Drop the cached access token. Call after rotating YOUTUBE_REFRESH_TOKEN at
 * runtime (e.g. dashboard OAuth re-auth) so the next getAccessToken() fetch
 * uses the new refresh token instead of serving the stale cached token.
 */
export function resetTokenCache() {
  cachedAccessToken = null
  cachedAtMs = 0
}

/**
 * Start a background timer that keeps the access token warm. Safe to call
 * multiple times — only one timer is ever created. Call from long-running
 * processes (API server, dashboard, jobs worker).
 *
 * options.onRefresh({ ok, at, error, ageMs, token }) fires on every refresh
 * attempt (initial + interval), letting hosts surface warmup activity live
 * (e.g. dashboard SSE).
 */
const warmupHistory = []
const WARMUP_HISTORY_MAX = 10

function recordWarmupEvent(entry) {
  warmupHistory.push({ at: new Date().toISOString(), ...entry })
  if (warmupHistory.length > WARMUP_HISTORY_MAX) warmupHistory.shift()
}

export function warmupHistoryInfo() {
  return [...warmupHistory]
}

export function startYouTubeTokenWarmup(options = {}) {
  if (warmupStarted) return { started: false, alreadyRunning: true, intervalMs: WARMUP_INTERVAL_MS, history: warmupHistoryInfo(), ...cachedTokenInfo() }
  warmupStarted = true
  const intervalMs = options.intervalMs || WARMUP_INTERVAL_MS
  const onRefresh = typeof options.onRefresh === 'function' ? options.onRefresh : null
  const run = async () => {
    const at = Date.now()
    try {
      await getAccessToken({ force: true })
      const info = cachedTokenInfo()
      const entry = { ok: true, error: null, ageMs: info.ageMs, tokenLength: (cachedAccessToken || '').length }
      recordWarmupEvent(entry)
      if (onRefresh) { try { onRefresh({ ok: true, at, ...entry }) } catch {} }
    } catch (e) {
      recordWarmupEvent({ ok: false, error: e?.message || String(e) })
      if (onRefresh) { try { onRefresh({ ok: false, at, error: e?.message || String(e) }) } catch {} }
      console.error(`[yt-token-warmup] refresh failed: ${e?.message || e}`)
    }
  }
  const timer = setInterval(run, intervalMs)
  if (timer.unref) timer.unref()
  // Warm immediately so the very first upload uses a fresh cached token
  run()
  console.log(`[yt-token-warmup] started — refresh every ${Math.round(intervalMs / 60_000)}min`)
  return { started: true, intervalMs, history: warmupHistoryInfo(), ...cachedTokenInfo() }
}

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
  if (!envRefreshToken()) throw new Error('YOUTUBE_REFRESH_TOKEN_NOT_SET: complete OAuth authorization first')
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
 * Classify a YouTube thumbnails.set failure.
 *
 *  - HTTP 400 invalidImage ("The provided image content is invalid.") is a media
 *    defect → THUMBNAIL_INVALID_MEDIA, action REGENERATE. It is NOT a policy
 *    violation by itself.
 *  - Explicit policy-ish rejection (e.g. adult/inappropriate in the error
 *    domain) → THUMBNAIL_POLICY_REJECTED, action QUARANTINE.
 *  - Any other/unknown 400 → THUMBNAIL_UPLOAD_FAILED, action QUARANTINE.
 */
export function classifyThumbnailUploadError(error, httpStatus) {
  const status = Number(httpStatus || error?.httpStatus || 0)
  const reason = String(error?.reason || '')
  const message = String(error?.message || '')
  const body = JSON.stringify(error?.youtubeError || '')

  if (status === 400) {
    const invalidImage =
      /invalidImage|invalid image|not a valid image|image content is invalid|badImageData|mediaTypeNotSupported/i.test(reason + ' ' + body)
    const policyRejected =
      /adult|sexual|inappropriate|policy|misleading|impersonat/i.test(reason + ' ' + message)
    if (invalidImage) {
      return { class: 'THUMBNAIL_INVALID_MEDIA', action: 'REGENERATE', reason: 'image not valid/decodable media' }
    }
    if (policyRejected) {
      return { class: 'THUMBNAIL_POLICY_REJECTED', action: 'QUARANTINE', reason: 'policy-related rejection' }
    }
    return { class: 'THUMBNAIL_UPLOAD_FAILED', action: 'QUARANTINE', reason: 'unknown 400' }
  }

  // Non-400 (network, quota, auth, etc.) → quarantine for diagnosis.
  return { class: 'THUMBNAIL_UPLOAD_FAILED', action: 'QUARANTINE', reason: `http ${status}` }
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

export async function getAccessToken(options = {}) {
  assertOAuthConfig()
  assertRefreshToken()

  // Serve from cache when still far from expiry (unless force requested).
  if (!options.force && cachedAccessToken && Date.now() - cachedAtMs < ACCESS_TOKEN_TTL_MS - REFRESH_MARGIN_MS) {
    return cachedAccessToken
  }

  const response = await fetchWithTimeout(GOOGLE_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      refresh_token: envRefreshToken(),
      grant_type: 'refresh_token',
    }),
  })

  const data = await readJson(response)
  if (!response.ok) throw youtubeApiError(data, response.status)
  if (!data.access_token) throw new Error('YOUTUBE_ACCESS_TOKEN_MISSING')
  cachedAccessToken = data.access_token
  cachedAtMs = Date.now()
  return cachedAccessToken
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
 * YouTube resumable upload (uploadType=resumable).
 *
 * Why this exists: the old single-POST multipart upload aborts any video
 * larger than what the connection can push inside one timeout window.
 * Measured ~84KB/s egress locally → a 13.7MB render exceeds a fixed 120s
 * ceiling, so every publish retried and failed. This flow splits the file
 * into bounded chunks and PUTs each one independently:
 *
 *   POST /upload/youtube/v3/videos?uploadType=resumable&part=snippet,status
 *     (body = JSON metadata)            → Location header = session URI
 *   PUT  <session> with `Content-Range: bytes S-E/TOTAL` per chunk
 *     200/201 → complete (body is the video resource)
 *     308     → incomplete; `Range: bytes=0-N` header = resume point
 *
 * A failed/timed-out chunk is re-sent in isolation (bounded retries with
 * backoff); a 308 resume rewinds to exactly the byte the server acknowledged.
 * This is also the network primitive the LinkedIn native-video job reuses
 * (it PUTs an MP4 to LinkedIn's own uploadUrl the same way).
 *
 * When the init response has NO Location header (test doubles, or a server
 * that completed synchronously) the init response is treated as the upload
 * result — preserving the legacy single-response contract.
 */
async function resumableUploadChunks({ token, videoBuffer, metaJson }) {
  const total = videoBuffer.length
  const chunkSize = Math.max(1, Number(process.env.YOUTUBE_UPLOAD_CHUNK_SIZE || 4 * 1024 * 1024))
  const maxRetries = Math.max(0, Number(process.env.YOUTUBE_UPLOAD_CHUNK_RETRIES || 3))
  const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

  const initRes = await fetchWithTimeout(
    `${GOOGLE_API_BASE}/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status`,
    {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
        'X-Upload-Content-Type': 'video/mp4',
        'X-Upload-Content-Length': String(total),
      },
      body: metaJson,
    },
    REQUEST_TIMEOUT_MS
  )

  const location = initRes.headers?.get?.('location') ?? null
  if (!location) {
    const data = await readJson(initRes)
    if (!initRes.ok || data.error) throw youtubeApiError(data, initRes.status)
    return data
  }

  let start = 0
  let result = null

  while (start < total) {
    const end = Math.min(start + chunkSize, total) - 1
    const bytes = videoBuffer.subarray(start, end + 1)

    let attempt = 0
    let res = null
    for (;;) {
      try {
        res = await fetchWithTimeout(
          location,
          {
            method: 'PUT',
            headers: {
              'Authorization': `Bearer ${token}`,
              'Content-Range': `bytes ${start}-${end}/${total}`,
              'Content-Length': String(bytes.length),
            },
            body: bytes,
          },
          Math.max(REQUEST_TIMEOUT_MS, UPLOAD_TIMEOUT_MS)
        )
      } catch (err) {
        // Network failure / per-chunk timeout — re-send only this chunk.
        if (attempt >= maxRetries) throw err
        attempt++
        await delay(Math.min(500 * 2 ** attempt, 3000))
        continue
      }

      if (res.status === 308) {
        // Incomplete: server reports what it holds via Range: bytes=0-N.
        const range = res.headers?.get?.('range') ?? null
        const received = range ? parseInt(String(range).split('-')[1] ?? '', 10) : NaN
        start = Number.isFinite(received) && received >= start ? received + 1 : end + 1
        break
      }
      if (res.status === 200 || res.status === 201) {
        result = await readJson(res)
        start = total
        break
      }

      const data = await readJson(res)
      if (res.status >= 500 && attempt < maxRetries) {
        attempt++
        await delay(Math.min(500 * 2 ** attempt, 3000))
        continue
      }
      throw youtubeApiError(data, res.status)
    }
    if (result) break
  }

  return result || {}
}

/**
 * --------------------------------------------------------------------------
 * YouTube video upload
 * --------------------------------------------------------------------------
 */
export async function publishVideo(inputOrUrl, titleOrOpts, description, privacy = 'public', coverPath = null) {
  let videoUrl, thumbnailPath, niche, _title, _description, _privacy, _tags, _categoryId
  if (typeof inputOrUrl === 'object' && inputOrUrl !== null) {
    const opts = inputOrUrl
    videoUrl = opts.videoUrl
    thumbnailPath = opts.thumbnailPath || opts.coverPath || null
    niche = opts.niche || null
    _title = opts.title || opts.metadata?.title || 'News Update'
    _description = opts.description || opts.metadata?.description || ''
    _privacy = opts.privacy || 'public'
    _tags = opts.tags || opts.metadata?.tags || []
    _categoryId = opts.categoryId || opts.metadata?.categoryId || null
  } else {
    videoUrl = inputOrUrl
    thumbnailPath = coverPath
    niche = null
    _title = titleOrOpts
    _description = description
    _privacy = privacy
    _tags = []
    _categoryId = null
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

  // SEO: snippet.tags[] + snippet.categoryId are what YouTube uses for search
  // discovery. We always send tags (deduped, clean, capped) and resolve a
  // categoryId (defaulting to Science & Technology when none supplied).
  const cleanTags = Array.isArray(_tags)
    ? [...new Set(_tags.map((t) => String(t).trim().replace(/^#/, '').toLowerCase()).filter((t) => t.length > 1 && t.length <= 100))]
    : []

  const snippet = {
    title: String(_title || 'News Update').slice(0, 100),
    description: String(_description || '').slice(0, 5000),
  }
  if (cleanTags.length) snippet.tags = cleanTags
  if (_categoryId) snippet.categoryId = String(_categoryId)

  const metaJson = JSON.stringify({
    snippet,
    status: { privacyStatus: _privacy, selfDeclaredMadeForKids: false },
  })

  const data = await resumableUploadChunks({
    token,
    videoBuffer: Buffer.from(videoBuffer),
    metaJson,
  })
  if (!data.id) throw new Error('YOUTUBE_VIDEO_UPLOAD_SUCCEEDED_WITHOUT_VIDEO_ID')

  const videoId = data.id
  console.log(`[YOUTUBE_VIDEO_UPLOAD] success videoId=${videoId} url=https://youtu.be/${videoId}`)

  // State: THUMBNAIL_PENDING → attempt thumbnail upload (independent).
  // thumbnailUploaded means only thumbnails.set succeeded — NOT that YouTube
  // propagated the thumbnail. The propagation verifier owns that truth.
  let thumbnailUploaded = false
  let thumbnailAttempts = 0
  let lastThumbnailError = null
  let thumbnailUpload = null
  if (thumbnailPath) {
    thumbnailAttempts = 1
    try {
      const thumbResult = await setThumbnail(token, videoId, thumbnailPath)
      thumbnailUploaded = true
      thumbnailUpload = thumbResult.upload || null
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
    thumbnailUpload,
    metadata: { title: String(_title).slice(0, 100), privacy: _privacy, tags: cleanTags, categoryId: snippet.categoryId || null },
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
 * YouTubePropagationVerifier (hasCustomThumbnail + remote 16:9 geometry).
 */
export async function setThumbnail(token, videoId, thumbnailPath, options = {}) {
  if (!token) throw new Error('YOUTUBE_ACCESS_TOKEN_REQUIRED')
  if (!videoId) throw new Error('YOUTUBE_VIDEO_ID_REQUIRED')
  if (!thumbnailPath) throw new Error('THUMBNAIL_PATH_REQUIRED')
  if (!existsSync(thumbnailPath)) throw new Error(`THUMBNAIL_NOT_FOUND: ${thumbnailPath}`)

  // The canonical artifact is never mutated. Produce a bounded UPLOAD COPY that
  // is guaranteed ≤ 2 MiB (YouTube's thumbnails.set hard limit). When the
  // canonical already fits it is used unchanged (transformation NONE).
  const { prepareUploadThumbnail, UploadTransformation } = await import('../../../src/thumbnail/ThumbnailUploadArtifact.mjs')
  const uploadArtifact = await prepareUploadThumbnail({
    path: thumbnailPath,
    outDir: options.outDir || null,
  })

  const thumbnailBuffer = readFileSync(uploadArtifact.path)
  if (!thumbnailBuffer.length) throw new Error(`THUMBNAIL_EMPTY: ${thumbnailPath}`)

  const ext = (uploadArtifact.path || thumbnailPath).toLowerCase().split('.').pop()
  const mimeType = MIME_BY_EXT[ext] || MIME_BY_EXT['png']
  if (!mimeType) throw new Error(`THUMBNAIL_UNSUPPORTED_FORMAT: ${ext}`)

  validateThumbnailBytes(thumbnailBuffer, mimeType)

  const { sha256Thumbnail } = await import('../../../src/thumbnail/ThumbnailMetadata.mjs')
  const thumbnailSha256 = uploadArtifact.sha256 || sha256Thumbnail(thumbnailPath)

  const transformation = uploadArtifact.transformation
  const uploadDims = uploadArtifact.width && uploadArtifact.height
    ? `${uploadArtifact.width}x${uploadArtifact.height}`
    : '2160x3840 (canonical)'
  console.log(`[YOUTUBE_THUMBNAIL] videoId=${videoId} source=${thumbnailPath} uploadCopy=${transformation} mime=${mimeType} bytes=${thumbnailBuffer.length} dims=${uploadDims} sha256=${(thumbnailSha256 || '').slice(0, 12)}… uploadMode=simple-media`)
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
    // Classify the failure so the orchestrator can REGENERATE vs QUARANTINE.
    // A 400 = THUMBNAIL_INVALID_MEDIA (regenerate) is a genuinely malformed/
    // unsupported image; policy-related or unknown rejections → quarantine.
    const failed = classifyThumbnailUploadError(error, response.status)
    error.thumbnailFailure = failed
    console.warn(`[YOUTUBE_THUMBNAIL_UPLOAD] FAIL videoId=${videoId} http=${response.status} class=${failed.class} action=${failed.action} error=${error.message}`)
    throw new Error(`YOUTUBE_THUMBNAIL_UPLOAD_FAILED: ${error.message}`)
  }

  const items = data.items?.length || 0
  const remoteThumbnail = data.items?.[0]?.snippet?.thumbnails?.maxres
    || data.items?.[0]?.snippet?.thumbnails?.standard
    || data.items?.[0]?.snippet?.thumbnails?.high
    || null

  console.log(`[YOUTUBE_THUMBNAIL_UPLOAD] SUCCESS videoId=${videoId} http=${response.status} items=${items} mime=${mimeType} bytes=${thumbnailBuffer.length} transformation=${transformation} responseThumbnailUrl=${remoteThumbnail?.url || 'none'}`)

  // Diagnostic only — never determines acceptance. Propagation verifier is authoritative.
  try {
    await verifyThumbnailRepresentation(token, videoId)
  } catch (error) {
    console.warn(`[YOUTUBE_THUMBNAIL_VERIFY] diagnostic failed: ${error.message}`)
  }

  return {
    ok: true, videoId, items, mimeType, bytes: thumbnailBuffer.length, sha256: thumbnailSha256,
    upload: {
      path: uploadArtifact.path,
      width: uploadArtifact.width,
      height: uploadArtifact.height,
      bytes: uploadArtifact.bytes,
      sha256: uploadArtifact.sha256,
      transformation,
      transformationKey: uploadArtifact.transformation,
    },
  }
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
 * Video snippet update (SEO backfill)
 * --------------------------------------------------------------------------
 */

/**
 * Update an ALREADY-PUBLISHED video's searchable snippet (title, description,
 * tags[], categoryId). Uses the YouTube Data API `videos.update` (PUT), which
 * REPLACES the snippet resource — so we first GET the current snippet and merge
 * only the provided fields forward to avoid wiping existing SEO.
 *
 * @param {object} opts
 * @param {string} opts.videoId          target video id
 * @param {string} [opts.title]          new title (defaults to current)
 * @param {string} [opts.description]    new description (defaults to current)
 * @param {string[]} [opts.tags]         new tags array (defaults to current)
 * @param {string} [opts.categoryId]     new YouTube categoryId (defaults to current)
 * @returns {Promise<{videoId:string, title:string, tags:string[], categoryId:string|null}>}
 */
export async function updateVideoSnippet({ videoId, title, description, tags, categoryId }) {
  const token = await getAccessToken()

  // 1. Read current snippet so PUT merges rather than wipes fields.
  const getRes = await fetchWithTimeout(
    `${GOOGLE_API_BASE}/youtube/v3/videos?part=snippet&id=${encodeURIComponent(videoId)}`,
    { headers: { 'Authorization': `Bearer ${token}` } },
  )
  const getData = await readJson(getRes)
  if (!getRes.ok) throw youtubeApiError(getData, getRes.status)
  const current = getData.items?.[0]?.snippet
  if (!current) throw new Error(`YOUTUBE_VIDEO_NOT_VISIBLE: ${videoId}`)

  // 2. Clean provided tags (same rules as upload: dedup, no '#', lowercase).
  const cleanTags = Array.isArray(tags)
    ? [...new Set(tags.map((t) => String(t).trim().replace(/^#/, '').toLowerCase()).filter((t) => t.length > 1 && t.length <= 100))]
    : (Array.isArray(current.tags) ? current.tags : [])

  const mergedSnippet = {
    title: String(title ?? current.title ?? '').slice(0, 100),
    description: String(description ?? current.description ?? '').slice(0, 5000),
  }
  if (cleanTags.length) mergedSnippet.tags = cleanTags
  if (categoryId) mergedSnippet.categoryId = String(categoryId)
  else if (current.categoryId) mergedSnippet.categoryId = String(current.categoryId)

  // 3. PUT the merged snippet back.
  const putRes = await fetchWithTimeout(
    `${GOOGLE_API_BASE}/youtube/v3/videos?part=snippet`,
    {
      method: 'PUT',
      headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: videoId, snippet: mergedSnippet }),
    },
  )
  const putData = await readJson(putRes)
  if (!putRes.ok) throw youtubeApiError(putData, putRes.status)

  const updated = putData.snippet || mergedSnippet
  console.log(`[YOUTUBE_UPDATE] videoId=${videoId} tags=${(updated.tags || []).length} categoryId=${updated.categoryId || 'n/a'}`)
  return {
    videoId,
    title: updated.title,
    tags: updated.tags || [],
    categoryId: updated.categoryId || null,
  }
}

/**
 * Verify what YouTube actually stores for a video (tags + categoryId) — used
 * by TEST_PUBLISH so we confirm the metadata mapping before touching the live
 * catalog or before running a backfill across existing videos.
 */
export async function fetchVideoSnippet({ videoId }) {
  const token = await getAccessToken()
  const getRes = await fetchWithTimeout(
    `${GOOGLE_API_BASE}/youtube/v3/videos?part=snippet,contentDetails&id=${encodeURIComponent(videoId)}`,
    { headers: { 'Authorization': `Bearer ${token}` } },
  )
  const getData = await readJson(getRes)
  if (!getRes.ok) throw youtubeApiError(getData, getRes.status)
  const item = getData.items?.[0]
  if (!item) throw new Error(`YOUTUBE_VIDEO_NOT_VISIBLE: ${videoId}`)
  const snippet = item.snippet || {}
  return {
    videoId,
    title: snippet.title || null,
    tags: Array.isArray(snippet.tags) ? snippet.tags : [],
    categoryId: snippet.categoryId ?? null,
    defaultAudioLanguage: snippet.defaultAudioLanguage || null,
    duration: item.contentDetails?.duration || null,
  }
}

/**
 * SEO-optimized update for an ALREADY-PUBLISHED video.
 *
 * Derives the full YouTube SEO bundle (tags[] + categoryId) from the article's
 * category/niche via buildYouTubeSEO — same rules as a fresh upload (Sports→17,
 * Music→10, Politics→25, etc., plus brand + category keyword tags) — then applies
 * it to the existing video with updateVideoSnippet. This is how you backfill
 * searchable hashtags onto videos published before SEO was wired in.
 *
 * @param {object} opts
 * @param {string} opts.videoId          target video id
 * @param {string|null|undefined} opts.category  pipeline category/niche key (any case)
 * @param {string[]} [opts.articleTags]  explicit article tags to fold in
 * @param {string|null} [opts.title]     optional new title (carried forward if omitted)
 * @param {string|null} [opts.description] optional new description (carried forward)
 * @param {string} [opts.brand]          brand label ("NEWS-MONSTER")
 * @returns {Promise<{videoId:string, title:string, tags:string[], categoryId:string|null, derived:{
 *            tags:string[], categoryId:string}}>}
 */
export async function updateVideoSEO({ videoId, category, articleTags = [], title, description, brand = 'NEWS-MONSTER' }) {
  const { buildYouTubeSEO } = await import('../../../src/publishing/YouTubeSEO.mjs')
  const derived = buildYouTubeSEO({ category, articleTags, brand })
  return updateVideoSnippet({
    videoId,
    title,
    description,
    tags: derived.tags,
    categoryId: derived.categoryId,
  })
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
