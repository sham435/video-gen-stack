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

// Upload an image (png/jpeg) and post it with commentary (colourful
// promotional post). 2026 Images API: initializeUpload → PUT bytes →
// post with content.media.id = image URN. Falls back to a text/URL share
// when the image upload fails (non-fatal for distribution).
export async function shareImage(token, memberUrn, imageUrl, commentary, linkUrl = null) {
  let buffer
  if (String(imageUrl).startsWith('data:')) {
    const m = /^data:[^;,]+;base64,(.+)$/.exec(imageUrl)
    if (!m) throw new Error('Unsupported data: URL (only base64 is supported)')
    buffer = Buffer.from(m[1], 'base64')
  } else if (/^https?:\/\//.test(imageUrl)) {
    const r = await fetch(imageUrl, { signal: AbortSignal.timeout(60000) })
    if (!r.ok) throw new Error(`Failed to fetch image: ${r.status}`)
    buffer = Buffer.from(await r.arrayBuffer())
  } else {
    // Local path
    const { readFileSync } = await import('node:fs')
    buffer = readFileSync(imageUrl)
  }
  if (!buffer.byteLength) throw new Error('Image buffer is empty')

  const owner = authorUrn(memberUrn)
  const init = await fetch(`${BASE}/rest/images?action=initializeUpload`, {
    method: 'POST',
    headers: apiHeaders(token),
    body: JSON.stringify({
      initializeUploadRequest: { owner, fileSizeBytes: buffer.byteLength, uploadCaptions: false },
    }),
  })
  const initData = await init.json()
  const value = initData?.value || {}
  const uploadUrl = value?.uploadInstructions?.[0]?.uploadUrl
  const imageUrn = value?.image || value?.asset
  if (!uploadUrl || !imageUrn) {
    throw new Error(`LinkedIn image init failed: ${JSON.stringify(initData).slice(0, 400)}`)
  }

  const up = await fetch(uploadUrl, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/octet-stream' },
    body: buffer,
  })
  if (!up.ok) throw new Error(`LinkedIn image upload failed: ${up.status} ${await up.text().catch(() => '')}`)

  const body = {
    author: owner,
    commentary: (commentary || '').slice(0, 1500),
    visibility: 'PUBLIC',
    distribution: { feedDistribution: 'MAIN_FEED', targetEntities: [], thirdPartyDistributionChannels: [] },
    lifecycleState: 'PUBLISHED',
    isReshareDisabledByAuthor: false,
    content: { media: { title: 'NEWS-MONSTER', id: imageUrn } },
  }
  if (linkUrl) {
    body.content = {
      article: {
        source: linkUrl.slice(0, 2000),
        title: 'NEWS-MONSTER',
        description: 'Watch the full story on YouTube.',
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
    throw new Error(`LinkedIn image post failed (${res.status}): ${msg}`)
  }
  const id = res.headers.get('x-restli-id') || data.id || data.urn || null
  return { id, urn: id, imageUrn, ...data }
}
// 2026 Videos API: initializeUpload → PUT bytes (capture ETag part id) →
// finalizeUpload → post with content.media.id = video URN.
export async function shareVideo(token, memberUrn, videoUrl, commentary) {
  let buffer
  if (String(videoUrl).startsWith('data:')) {
    // Node's fetch returns 0 bytes for data: URLs — decode inline.
    const m = /^data:[^;,]+;base64,(.+)$/.exec(videoUrl)
    if (!m) throw new Error('Unsupported data: URL (only base64 is supported)')
    buffer = Buffer.from(m[1], 'base64')
  } else {
    const videoResp = await fetch(videoUrl, { signal: AbortSignal.timeout(120000) })
    if (!videoResp.ok) throw new Error(`Failed to fetch video: ${videoResp.status}`)
    buffer = Buffer.from(await videoResp.arrayBuffer())
  }
  if (!buffer.byteLength) throw new Error('Video buffer is empty')

  const owner = authorUrn(memberUrn)
  const init = await fetch(`${BASE}/rest/videos?action=initializeUpload`, {
    method: 'POST',
    headers: apiHeaders(token),
    body: JSON.stringify({
      initializeUploadRequest: { owner, fileSizeBytes: buffer.byteLength, uploadCaptions: false, uploadThumbnail: false },
    }),
  })
  const initData = await init.json()
  const value = initData?.value || {}
  const instructions = value?.uploadInstructions || []
  const videoUrn = value?.video
  const uploadToken = value?.uploadToken || ''
  if (!instructions.length || !videoUrn) {
    throw new Error(`LinkedIn video init failed: ${JSON.stringify(initData).slice(0, 400)}`)
  }

  // Multi-part upload: each instruction has a byte range + uploadUrl; PUT each
  // part (sliced from the buffer) and collect the ETag response as the part id.
  const partIds = []
  for (const part of instructions) {
    const { uploadUrl, firstByte = 0, lastByte = buffer.byteLength - 1 } = part
    const slice = buffer.subarray(firstByte, lastByte + 1)
    const up = await fetch(uploadUrl, {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/octet-stream',
      },
      body: slice,
    })
    const etag = up.headers.get('etag')
    if (!up.ok || !etag) {
      throw new Error(`LinkedIn video part ${firstByte}-${lastByte} upload failed: ${up.status} (etag=${etag || 'missing'}) ${await up.text().catch(() => '')}`)
    }
    partIds.push(etag)
  }

  const fin = await fetch(`${BASE}/rest/videos?action=finalizeUpload`, {
    method: 'POST',
    headers: apiHeaders(token),
    body: JSON.stringify({ finalizeUploadRequest: { video: videoUrn, uploadToken, uploadedPartIds: partIds } }),
  })
  if (!fin.ok) {
    throw new Error(`LinkedIn video finalize failed: ${fin.status} ${await fin.text().catch(() => '')}`)
  }

  // Poll until the video is AVAILABLE (processing).
  const videoId = encodeURIComponent(videoUrn)
  let ready = false
  for (let i = 0; i < 24 && !ready; i++) {
    await new Promise(r => setTimeout(r, 5000))
    const st = await fetch(`${BASE}/rest/videos/${videoId}`, { headers: apiHeaders(token) })
    const stData = await st.json()
    const status = stData?.status
    if (status === 'AVAILABLE') ready = true
    else if (status === 'PROCESSING_FAILED') {
      throw new Error(`LinkedIn video processing failed: ${stData?.processingFailureReason || 'unknown'}`)
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

// Append the post's own feed URL to its commentary (e.g.
// "...#news-monster\n\nhttps://www.linkedin.com/feed/update/<urn>") so the
// status text carries the canonical link. Post ID must be a share/ugcPost URN.
export async function updatePostCommentary(token, postUrn, commentary) {
  const res = await fetch(`${BASE}/rest/posts/${encodeURIComponent(postUrn)}`, {
    method: 'POST',
    headers: { ...apiHeaders(token), 'X-RestLi-Method': 'PARTIAL_UPDATE' },
    body: JSON.stringify({ patch: { $set: { commentary: (commentary || '').slice(0, 1500) } } }),
  })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`LinkedIn update failed (${res.status}): ${text.slice(0, 300)}`)
  }
  return true
}

// Persisted tokens (written to .env by the callback route).
export const accessToken = () => process.env.LINKEDIN_ACCESS_TOKEN
export const refreshToken = () => process.env.LINKEDIN_REFRESH_TOKEN
export const memberUrn = () => process.env.LINKEDIN_MEMBER_URN
