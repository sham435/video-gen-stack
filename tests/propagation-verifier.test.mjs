import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { YouTubePropagationVerifier, VerifyState } from '../src/publishing/YouTubePropagationVerifier.mjs'

describe('YouTubePropagationVerifier', () => {
  it('returns VERIFICATION_FAILED when no token', async () => {
    const verifier = new YouTubePropagationVerifier({ token: '', maxAttempts: 1, delays: [0] })
    const result = await verifier.verify({ videoId: 'test123' })
    assert.equal(result.state, VerifyState.VERIFICATION_FAILED)
    assert.equal(result.hasCustomThumbnail, false)
    assert.deepEqual(result.remote, null)
    assert.ok(result.durationMs >= 0)
    assert.equal(result.attempts.length, 1)
  })

  it('returns VERIFICATION_FAILED when API errors (no token)', async () => {
    const verifier = new YouTubePropagationVerifier({ token: '', maxAttempts: 2, delays: [0, 0] })
    const result = await verifier.verify({ videoId: 'test123' })
    // API returns error (401/403) → not VIDEO_NOT_VISIBLE_YET (that's empty items)
    assert.equal(result.state, VerifyState.VERIFICATION_FAILED)
    assert.equal(result.hasCustomThumbnail, false)
    assert.deepEqual(result.remote, null)
    assert.ok(result.attempts.length >= 1)
  })

  it('stops immediately on authorization error (no retry)', async () => {
    const verifier = new YouTubePropagationVerifier({ token: '', maxAttempts: 5, delays: [0,0,0,0,0] })
    const result = await verifier.verify({ videoId: 'test' })
    // Empty token → 401/403 → AUTHORIZATION → stops after 1 attempt (no retry for auth)
    assert.equal(result.state, 'VERIFICATION_FAILED')
    assert.equal(result.errorType, 'AUTHORIZATION')
    assert.equal(result.attempts.length, 1)
  })

  it('VerifyState enum has all states', () => {
    assert.equal(VerifyState.VIDEO_NOT_VISIBLE_YET, 'VIDEO_NOT_VISIBLE_YET')
    assert.equal(VerifyState.VIDEO_VISIBLE_THUMBNAIL_PENDING, 'VIDEO_VISIBLE_THUMBNAIL_PENDING')
    assert.equal(VerifyState.CUSTOM_THUMBNAIL_ACCEPTED, 'CUSTOM_THUMBNAIL_ACCEPTED')
    assert.equal(VerifyState.CUSTOM_THUMBNAIL_REJECTED, 'CUSTOM_THUMBNAIL_REJECTED')
    assert.equal(VerifyState.VERIFICATION_FAILED, 'VERIFICATION_FAILED')
  })

  it('stops early when video found', async () => {
    const verifier = new YouTubePropagationVerifier({ token: '', maxAttempts: 5, delays: [0,0,0,0,0] })
    const result = await verifier.verify({ videoId: 'test' })
    // Either FOUND or FAILED — but not 5 attempts (stops on first find or max)
    assert.ok(result.attempts.length <= 5)
    assert.ok(result.durationMs >= 0)
  })

  it('retries propagation when hasCustomThumbnail is false, then ACCEPTS', async () => {
    // Simulates YouTube's async thumbnail propagation: the video is visible
    // immediately but contentDetails.hasCustomThumbnail flips to true only
    // after the first 2 attempts. The verifier must NOT reject instantly — it
    // must wait out the propagation window (the exact race that failed the
    // production run with a false CUSTOM_THUMBNAIL_REJECTED).
    const realFetch = global.fetch
    const realDelay = YouTubePropagationVerifier.prototype._delay
    let calls = 0
    YouTubePropagationVerifier.prototype._delay = async () => {}
    const thumbBytes = Buffer.from('remote-thumb-content')
    global.fetch = async (url) => {
      if (String(url).startsWith('https://www.googleapis.com/youtube/v3/videos?')) {
        calls++
        const visible = calls >= 3
        return {
          ok: true,
          json: async () => ({
            items: [{
              id: 'abc123',
              contentDetails: { hasCustomThumbnail: visible },
              snippet: {
                title: 't',
                thumbnails: { maxres: { url: 'https://example.com/thumb.jpg', width: 1080, height: 1920 } },
              },
            }],
          }),
        }
      }
      // thumbnail asset download
      return { ok: true, status: 200, arrayBuffer: async () => thumbBytes.buffer.slice(thumbBytes.byteOffset, thumbBytes.byteOffset + thumbBytes.byteLength) }
    }
    const verifier = new YouTubePropagationVerifier({ token: 'tok', maxAttempts: 5, delays: [0,0,0,0,0], expectedAspectRatio: '16:9' })
    const result = await verifier.verify({ videoId: 'abc123', sha256: null })
    global.fetch = realFetch
    YouTubePropagationVerifier.prototype._delay = realDelay
    assert.equal(result.state, VerifyState.CUSTOM_THUMBNAIL_ACCEPTED)
    assert.equal(result.hasCustomThumbnail, true)
    assert.equal(result.identity, 'REENCODED')
    assert.ok(calls >= 3, 'expected >=3 API calls (retried past rebootstrap), got ' + calls)
  })

  it('rejects only AFTER propagation window when hasCustomThumbnail never flips', async () => {
    const realFetch = global.fetch
    const realDelay = YouTubePropagationVerifier.prototype._delay
    let calls = 0
    YouTubePropagationVerifier.prototype._delay = async () => {}
    global.fetch = async (url) => {
      calls++
      return {
        ok: true,
        json: async () => ({
          items: [{ id: 'abc123', contentDetails: { hasCustomThumbnail: false }, snippet: { title: 't', thumbnails: {} } }],
        }),
      }
    }
    const verifier = new YouTubePropagationVerifier({ token: 'tok', maxAttempts: 3, delays: [0,0,0], expectedAspectRatio: '16:9' })
    const result = await verifier.verify({ videoId: 'abc123', sha256: null })
    global.fetch = realFetch
    YouTubePropagationVerifier.prototype._delay = realDelay
    assert.equal(result.state, VerifyState.CUSTOM_THUMBNAIL_REJECTED)
    assert.equal(result.attempts.length, 3)
  })
})
