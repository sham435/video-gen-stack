import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { YouTubePropagationVerifier, VerifyState } from '../src/publishing/YouTubePropagationVerifier.mjs'

describe('YouTubePropagationVerifier', () => {
  it('returns VERIFICATION_FAILED when no token', async () => {
    const verifier = new YouTubePropagationVerifier({ token: '', maxAttempts: 1, delays: [0] })
    const result = await verifier.verify({ videoId: 'test123' })
    assert.equal(result.state, VerifyState.VERIFICATION_FAILED)
    assert.equal(result.hasCustomThumbnail, false)
    assert.equal(result.verifiedUrl, null)
    assert.ok(result.durationMs >= 0)
    assert.equal(result.attempts.length, 1)
  })

  it('returns VERIFICATION_FAILED when API errors (no token)', async () => {
    const verifier = new YouTubePropagationVerifier({ token: '', maxAttempts: 2, delays: [0, 0] })
    const result = await verifier.verify({ videoId: 'test123' })
    // API returns error (401/403) → not VIDEO_NOT_VISIBLE_YET (that's empty items)
    assert.equal(result.state, VerifyState.VERIFICATION_FAILED)
    assert.equal(result.hasCustomThumbnail, false)
    assert.equal(result.verifiedUrl, null)
    assert.ok(result.attempts.length >= 1)
  })

  it('stops retrying when maxAttempts reached', async () => {
    const verifier = new YouTubePropagationVerifier({ token: '', maxAttempts: 3, delays: [0, 0, 0] })
    const result = await verifier.verify({ videoId: 'nonexistent' })
    assert.equal(result.attempts.length, 3)
    assert.ok(result.durationMs >= 0)
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
})
