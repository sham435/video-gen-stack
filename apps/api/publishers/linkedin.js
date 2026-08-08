const CLIENT_ID = process.env.LINKEDIN_CLIENT_ID
const CLIENT_SECRET = process.env.LINKEDIN_CLIENT_SECRET
const ORG_ID = process.env.LINKEDIN_ORG_ID
const REDIRECT_URI = process.env.LINKEDIN_REDIRECT_URI || 'https://video-gen-stack-production.up.railway.app/api/auth/linkedin/callback'
const BASE = 'https://api.linkedin.com'
const OAUTH = 'https://www.linkedin.com/oauth/v2'
const API_VERSION = process.env.LINKEDIN_API_VERSION || '202605'

// w_organization_social requires app verification by LinkedIn; it's included in
// the consent URL only when explicitly enabled (verified apps) via env so the
// unverified flow never fails on an unapproved scope.
const ORG_SCOPE = process.env.LINKEDIN_ORG_SOCIAL === '1' ? ' w_organization_social' : ''
const SCOPES = `openid profile email w_member_social${ORG_SCOPE}`

export const authUrl =
  `${OAUTH}/authorization?response_type=code&client_id=${CLIENT_ID}` +
  `&redirect_uri=${encodeURIComponent(REDIRECT_URI)}&scope=${encodeURIComponent(SCOPES)}`

function apiHeaders(token, opts = {}) {
  return {
    Authorization: `Bearer ${token}`,
    'X-Restli-Protocol-Version': '2.0.0',
    'LinkedIn-Version': API_VERSION,
    'Content-Type': 'application/json',
    ...opts,
  }
}

export async function exchangeCode(code) {
  const res = await fetch(`${OAUTH}/accessToken`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      code,
      grant_type: 'authorization_code',
      redirect_uri: REDIRECT_URI,
    }),
    signal: AbortSignal.timeout(15000),
  })
  return res.json()
}

export async function refreshAccessToken(refreshToken) {
  const res = await fetch(`${OAUTH}/accessToken`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
    }),
    signal: AbortSignal.timeout(15000),
  })
  return res.json()
}

// OpenID Connect userinfo → sub = member id (use with openid scope).
export async function getMemberUrn(token) {
  const res = await fetch(`${BASE}/v2/userinfo`, { headers: apiHeaders(token) })
  const data = await res.json()
  if (!data.sub) throw new Error(`userinfo failed: ${JSON.stringify(data).slice(0, 300)}`)
  return `urn:li:person:${data.sub}`
}

export function authorUrn(memberUrn) {
  return ORG_ID && process.env.LINKEDIN_ORG_SOCIAL === '1'
    ? `urn:li:organization:${ORG_ID}`
    : memberUrn
}

// Share a text/URL post to the authorized member (or org when verified).
// 2026 Posts API: requires lifecycleState + distribution; article posts need
// content.article with explicit title/description/thumbnail (URL scraping is
// not supported), so a bare link stays as text-only commentary.
export async function sharePost(token, memberUrn, commentary, linkUrl = null) {
  const body = {
    author: authorUrn(memberUrn),
    commentary: (commentary || '').slice(0, 1500),
    visibility: 'PUBLIC',
    distribution: {
      feedDistribution: 'MAIN_FEED',
      targetEntities: [],
      thirdPartyDistributionChannels: [],
    },
    lifecycleState: 'PUBLISHED',
    isReshareDisabledByAuthor: false,
  }
  if (linkUrl) {
    body.content = {
      article: {
        source: linkUrl.slice(0, 2000),
        title: 'NEWS-MONSTER — Automated AI Breaking News',
        description: 'Breaking news, AI, science, sports & future tech — AI-generated video shorts every 30 minutes.',
      },
    }
  }
  const res = await fetch(`${BASE}/rest/posts`, {
    method: 'POST',
    headers: apiHeaders(token),
    body: JSON.stringify(body),
  })
  const text = await res.text()
  const data = text ? JSON.parse(text).catch(() => ({})) : {}
  if (!res.ok) {
    const msg = data.message || data.serviceErrorCode || text.slice(0, 300)
    throw new Error(`LinkedIn share failed (${res.status}): ${msg}`)
  }
  const id = res.headers.get('x-restli-id') || data.id || data.urn || null
  return { id, urn: id, ...data }
}

// Upload a video (mp4) and post it. Returns the created post id/urn.
export async function shareVideo(token, memberUrn, videoUrl, commentary) {
  const videoResp = await fetch(videoUrl, { signal: AbortSignal.timeout(120000) })
  if (!videoResp.ok) throw new Error(`Failed to fetch video: ${videoResp.status}`)
  const buffer = Buffer.from(await videoResp.arrayBuffer())

  const owner = authorUrn(memberUrn)
  const init = await fetch(`${BASE}/rest/videos?action=initializeUpload`, {
    method: 'POST',
    headers: apiHeaders(token),
    body: JSON.stringify({ initializeUploadRequest: { owner, fileSizeBytes: buffer.byteLength } }),
  })
  const initData = await init.json()
  const uploadUrl = initData?.value?.uploadUrl
  const videoUrn = initData?.value?.video
  if (!uploadUrl || !videoUrn) {
    throw new Error(`LinkedIn video init failed: ${JSON.stringify(initData).slice(0, 300)}`)
  }

  const up = await fetch(uploadUrl, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: buffer,
  })
  if (!up.ok) throw new Error(`LinkedIn video upload failed: ${up.status} ${await up.text().catch(() => '')}`)

  // Poll until the video is READY (processing).
  const videoId = videoUrn.split(':').pop()
  let ready = false
  for (let i = 0; i < 20 && !ready; i++) {
    await new Promise(r => setTimeout(r, 5000))
    const st = await fetch(`${BASE}/rest/videos/${videoId}`, { headers: apiHeaders(token) })
    const stData = await st.json()
    const status = stData?.status
    if (status === 'READY') ready = true
    else if (status === 'FAILED' || status === 'CANCELED') {
      throw new Error(`LinkedIn video processing ${status}`)
    }
  }
  if (!ready) throw new Error('LinkedIn video processing timed out')

  const res = await fetch(`${BASE}/rest/posts`, {
    method: 'POST',
    headers: apiHeaders(token),
    body: JSON.stringify({
      author: owner,
      commentary: (commentary || '').slice(0, 1500),
      visibility: 'PUBLIC',
      distribution: {
        feedDistribution: 'MAIN_FEED',
        targetEntities: [],
        thirdPartyDistributionChannels: [],
      },
      lifecycleState: 'PUBLISHED',
      isReshareDisabledByAuthor: false,
      content: { media: { title: 'NEWS-MONSTER', id: videoUrn } },
    }),
  })
  const text = await res.text()
  const data = text ? JSON.parse(text).catch(() => ({})) : {}
  if (!res.ok) {
    const msg = data.message || text.slice(0, 300)
    throw new Error(`LinkedIn video post failed (${res.status}): ${msg}`)
  }
  const id = res.headers.get('x-restli-id') || data.id || data.urn || null
  return { id, urn: videoUrn, ...data }
}

// Persisted tokens (written to .env by the callback route).
export const accessToken = () => process.env.LINKEDIN_ACCESS_TOKEN
export const refreshToken = () => process.env.LINKEDIN_REFRESH_TOKEN
export const memberUrn = () => process.env.LINKEDIN_MEMBER_URN
