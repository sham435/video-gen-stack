// YouTube Studio link — auto-sets a niche thumbnail on a published video via
// the YouTube Data API v3 `thumbnails.set` endpoint.
//
// Design notes:
//   * No `googleapis` dependency — the repo already talks to Google's OAuth +
//     Data API with raw `fetch` (see apps/api/routes/publish.js), so this keeps
//     the same convention and stays light/testable.
//   * Every network boundary is dependency-injected via the `transport` option
//     (and the token refresh via `getAccessToken`), so unit tests pass a mock
//     and never touch the network. The 270-test suite stays green offline.
//   * Token model reuses the existing flow: the dashboard writes the user's
//     refresh token to YOUTUBE_REFRESH_TOKEN in .env, so it is the default
//     source when no explicit token is passed.

const OAUTH_TOKEN_URL = 'https://oauth2.googleapis.com/token'
const THUMBNAIL_SET_URL = 'https://www.googleapis.com/upload/youtube/v3/thumbnails/set'

export const SCOPES = ['https://www.googleapis.com/auth/youtube.upload']

// Build the Google consent URL. Mirrors the existing /api/youtube/auth redirect
// so the dashboard can link Studio with the same state-protection flow.
export function getAuthUrl({
  state,
  clientId = process.env.YOUTUBE_CLIENT_ID,
  redirectUri = process.env.YOUTUBE_REDIRECT_URI,
} = {}) {
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    scope: SCOPES[0],
    response_type: 'code',
    access_type: 'offline',
    prompt: 'consent',
  })
  if (state) params.set('state', state)
  return `https://accounts.google.com/o/oauth2/auth?${params.toString()}`
}

// Exchange an authorization code for tokens (refresh_token + access_token).
export async function exchangeCode(code, {
  clientId = process.env.YOUTUBE_CLIENT_ID,
  clientSecret = process.env.YOUTUBE_CLIENT_SECRET,
  redirectUri = process.env.YOUTUBE_REDIRECT_URI,
} = {}) {
  const resp = await fetch(OAUTH_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      code,
      grant_type: 'authorization_code',
      redirect_uri: redirectUri,
    }),
    signal: AbortSignal.timeout(15000),
  })
  return resp.json()
}

// Refresh a short-lived access token from a stored refresh token.
export async function getAccessToken(refreshToken = process.env.YOUTUBE_REFRESH_TOKEN, {
  clientId = process.env.YOUTUBE_CLIENT_ID,
  clientSecret = process.env.YOUTUBE_CLIENT_SECRET,
} = {}) {
  if (!refreshToken) throw new Error('No YouTube refresh token — link Studio first (YOUTUBE_REFRESH_TOKEN)')
  const resp = await fetch(OAUTH_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    }),
    signal: AbortSignal.timeout(15000),
  })
  const data = await resp.json()
  if (!data.access_token) throw new Error(data.error || 'YouTube token refresh failed')
  return data.access_token
}

// Real upload transport: media upload (binary PNG, no multipart needed).
async function realTransport({ videoId, thumbnailBuffer, accessToken }) {
  const url = `${THUMBNAIL_SET_URL}?videoId=${encodeURIComponent(videoId)}&uploadType=media`
  const resp = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'image/png',
    },
    body: thumbnailBuffer,
    signal: AbortSignal.timeout(30000),
  })
  const data = await resp.json().catch(() => ({}))
  if (!resp.ok) {
    const err = new Error(data?.error?.message || `thumbnails.set failed (${resp.status})`)
    err.status = resp.status
    throw err
  }
  return { data }
}

// Set a niche thumbnail on a published video.
//   videoId          – the YouTube video id to update
//   thumbnailBuffer  – PNG bytes (Buffer/Uint8Array)
//   refreshToken     – optional; defaults to process.env.YOUTUBE_REFRESH_TOKEN
//   accessToken      – optional; skips the refresh round-trip (tests use this)
//   transport        – injection point; defaults to the real API call
export async function setNicheThumbnail({
  videoId,
  thumbnailBuffer,
  refreshToken,
  accessToken,
  transport = realTransport,
}) {
  if (!videoId) throw new Error('videoId is required')
  if (!thumbnailBuffer || thumbnailBuffer.length === 0) throw new Error('thumbnailBuffer is required')
  const token = accessToken || (await getAccessToken(refreshToken))
  return transport({ videoId, thumbnailBuffer, accessToken: token })
}
