const CLIENT_ID = process.env.YOUTUBE_CLIENT_ID
const CLIENT_SECRET = process.env.YOUTUBE_CLIENT_SECRET
const REFRESH_TOKEN = process.env.YOUTUBE_REFRESH_TOKEN
const BASE = 'https://www.googleapis.com'

export const authUrl = `https://accounts.google.com/o/oauth2/auth?client_id=${CLIENT_ID}&redirect_uri=http://localhost:4567/auth/youtube/callback&scope=https://www.googleapis.com/auth/youtube.upload&response_type=code&access_type=offline`

export async function exchangeCode(code) {
  const res = await fetch(`${BASE}/oauth2/v4/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      code,
      grant_type: 'authorization_code',
      redirect_uri: 'http://localhost:4567/auth/youtube/callback',
    }),
  })
  return res.json()
}

async function getAccessToken() {
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

export async function uploadShort(videoUrl, title, description, privacy = 'public') {
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
  return data
}
