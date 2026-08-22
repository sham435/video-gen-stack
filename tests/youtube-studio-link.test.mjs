// YouTube Studio auto-thumbnail link — unit tests with a MOCKED transport, so
// no network / no googleapis. Mirrors the production flow: detect niche ->
// render thumbnail -> setNicheThumbnail (thumbnails.set).
import test from 'node:test'
import assert from 'node:assert/strict'
import { detectNiche, renderNicheThumbnail, KNOWN_NICHES } from '../src/youtube/nicheDetector.mjs'
import { setNicheThumbnail, getAuthUrl, SCOPES } from '../src/youtube/youtubeStudioLink.mjs'

// Mock transport — records the call, simulates a successful thumbnails.set.
function mockTransport() {
  const calls = []
  const transport = async ({ videoId, thumbnailBuffer, accessToken }) => {
    calls.push({ videoId, bytes: thumbnailBuffer?.length || 0, token: accessToken })
    return { data: { items: [{ videoId, default: { url: `https://i.ytimg.com/${videoId}/default.jpg` } }] } }
  }
  return { transport, calls }
}

test('nicheDetector — heuristic maps article text to a known niche', async () => {
  assert.equal(await detectNiche({ text: 'Tesla stock surges after record earnings call' }), 'TESLA')
  assert.equal(await detectNiche({ text: 'OpenAI launches a new GPT model for agents' }), 'AI')
  assert.equal(await detectNiche({ text: 'SpaceX starship reaches orbit on test flight' }), 'SPACE')
  assert.equal(await detectNiche({ text: 'Apple reveals the M4 MacBook Pro lineup' }), 'APPLE')
})

test('nicheDetector — falls back to TECH when nothing matches', async () => {
  assert.equal(await detectNiche({ text: 'a quiet evening walk in the park' }), 'TECH')
})

test('nicheDetector — LLM override wins, heuristic is the fallback', async () => {
  const llm = async () => ' crypto '
  assert.equal(await detectNiche({ text: 'xyz', llm }), 'CRYPTO')
  // LLM returns garbage -> heuristic/normalize fallback to TECH
  const badLlm = async () => 'not-a-real-niche'
  assert.equal(await detectNiche({ text: 'random words', llm: badLlm }), 'TECH')
})

test('nicheDetector — KNOWN_NICHES is the closed set', () => {
  assert.ok(KNOWN_NICHES.includes('TESLA') && KNOWN_NICHES.includes('AI'))
})

test('getAuthUrl — requests the youtube.upload scope (offline consent)', () => {
  const url = getAuthUrl({ clientId: 'CID', redirectUri: 'https://x/cb', state: 's1' })
  assert.ok(url.startsWith('https://accounts.google.com/o/oauth2/auth?'), 'google consent url')
  assert.ok(url.includes(encodeURIComponent(SCOPES[0])), 'upload scope present')
  assert.ok(url.includes('access_type=offline'), 'offline access for refresh token')
  assert.ok(url.includes('state=s1'), 'state echoed for CSRF protection')
})

test('setNicheThumbnail — calls transport with the PNG buffer + bearer token', async () => {
  const { transport, calls } = mockTransport()
  const buffer = Buffer.from('fake-png-bytes')
  const res = await setNicheThumbnail({
    videoId: 'ABC123',
    thumbnailBuffer: buffer,
    accessToken: 'tok-xyz',
    transport,
  })
  assert.equal(calls.length, 1, 'transport invoked once')
  assert.equal(calls[0].videoId, 'ABC123')
  assert.equal(calls[0].bytes, buffer.length)
  assert.equal(calls[0].token, 'tok-xyz')
  assert.equal(res.data.items[0].videoId, 'ABC123')
})

test('setNicheThumbnail — rejects missing inputs', async () => {
  const { transport } = mockTransport()
  await assert.rejects(() => setNicheThumbnail({ thumbnailBuffer: Buffer.from('x'), transport }), /videoId is required/)
  await assert.rejects(() => setNicheThumbnail({ videoId: 'v', transport }), /thumbnailBuffer is required/)
})

test('renderNicheThumbnail — produces a PNG buffer with the niche pill', async () => {
  const { buffer, niche } = await renderNicheThumbnail({ niche: 'TESLA', headline: 'Tesla just changed everything' })
  assert.equal(niche, 'TESLA')
  assert.ok(buffer && buffer.length > 1000, 'rendered PNG buffer returned')
  // PNG magic signature: 89 50 4E 47 ("\x89PNG")
  assert.equal(buffer[0], 0x89)
  assert.equal(buffer[1], 0x50)
  assert.equal(buffer[2], 0x4e)
  assert.equal(buffer[3], 0x47)
})
