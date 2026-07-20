const CLIENT_KEY = process.env.TIKTOK_CLIENT_KEY
const CLIENT_SECRET = process.env.TIKTOK_CLIENT_SECRET
const REDIRECT_URI = process.env.TIKTOK_REDIRECT_URI || 'http://localhost:4567/auth/tiktok/callback'
const BASE = 'https://open.tiktokapis.com/v2'

export const authUrl = `https://www.tiktok.com/v2/auth/authorize?client_key=${CLIENT_KEY}&scope=user.info.basic,video.publish&response_type=code&redirect_uri=${encodeURIComponent(REDIRECT_URI)}`

export async function exchangeCode(code) {
  const res = await fetch(`${BASE}/oauth/token/`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_key: CLIENT_KEY,
      client_secret: CLIENT_SECRET,
      code,
      grant_type: 'authorization_code',
      redirect_uri: REDIRECT_URI,
    }),
  })
  return res.json()
}

export async function refreshToken(refreshToken) {
  const res = await fetch(`${BASE}/oauth/token/`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_key: CLIENT_KEY,
      client_secret: CLIENT_SECRET,
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
    }),
  })
  return res.json()
}

export async function uploadVideo(accessToken, openId, videoUrl, description, privacy = 'PUBLIC') {
  // Step 1: Initialize upload
  const initRes = await fetch(`${BASE}/video/upload/init/`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ source: 'FILE', size: 0 }),
  })

  const initData = await initRes.json()
  const uploadUrl = initData?.data?.upload_url
  if (!uploadUrl) throw new Error(`TikTok init failed: ${JSON.stringify(initData)}`)

  // Step 2: Upload video file
  const videoResp = await fetch(videoUrl)
  const videoBuffer = await videoResp.arrayBuffer()

  await fetch(uploadUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'video/mp4', 'Content-Length': videoBuffer.byteLength },
    body: videoBuffer,
  })

  // Step 3: Publish
  const pubRes = await fetch(`${BASE}/video/publish/`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      open_id: openId,
      access_token: accessToken,
      post_info: { title: description.slice(0, 150), privacy_level: privacy, disable_duet: false, disable_stitch: false, disable_comment: false },
      source_info: { source: 'FILE', video_size: videoBuffer.byteLength, chunk_size: videoBuffer.byteLength, total_chunk_count: 1 },
    }),
  })

  return pubRes.json()
}
