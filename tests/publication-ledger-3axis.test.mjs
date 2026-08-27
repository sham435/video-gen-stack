import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { PublicationLedger, resolveThumbnailUrl, UploadState, ThumbnailState, VerificationState } from '../src/publishing/PublicationLedger.mjs'
import { VerifyState } from '../src/publishing/YouTubePropagationVerifier.mjs'
import { PostPublishVerifier } from '../src/publishing/PostPublishVerifier.mjs'
import { writeFileSync, unlinkSync } from 'node:fs'

const LEDGER = '/tmp/test-publication-ledger.json'
const cleanup = () => { try { unlinkSync(LEDGER) } catch {} }

describe('PublicationLedger 3-axis state model', () => {
  it('records with three axes', () => {
    cleanup()
    const ledger = new PublicationLedger({ filePath: LEDGER })
    ledger.record({
      videoId: 'axis1',
      title: 'Test',
      uploadState: 'SUCCESS',
      thumbnailState: 'CUSTOM_THUMBNAIL_ACCEPTED',
      verificationState: 'VERIFIED',
    })
    const entry = ledger.findByVideoId('axis1')
    assert.equal(entry.uploadState, 'SUCCESS')
    assert.equal(entry.thumbnailState, 'CUSTOM_THUMBNAIL_ACCEPTED')
    assert.equal(entry.verificationState, 'VERIFIED')
    cleanup()
  })

  it('gallery includes VERIFIED entries', () => {
    cleanup()
    const ledger = new PublicationLedger({ filePath: LEDGER })
    ledger.record({ videoId: 'g1', uploadState: 'SUCCESS', verificationState: 'VERIFIED', thumbnailState: 'CUSTOM_THUMBNAIL_ACCEPTED' })
    const m = ledger.toGalleryManifest('ch')
    assert.equal(m.videos.length, 1)
    assert.equal(m.videos[0].verified, true)
    assert.equal(m.videos[0].verificationState, 'VERIFIED')
    cleanup()
  })

  it('gallery includes API_UNAVAILABLE entries', () => {
    cleanup()
    const ledger = new PublicationLedger({ filePath: LEDGER })
    ledger.record({ videoId: 'g2', uploadState: 'SUCCESS', verificationState: 'API_UNAVAILABLE' })
    const m = ledger.toGalleryManifest('ch')
    assert.equal(m.videos.length, 1)
    assert.equal(m.videos[0].verified, false)
    assert.equal(m.videos[0].verificationState, 'API_UNAVAILABLE')
    cleanup()
  })

  it('gallery excludes REJECTED entries', () => {
    cleanup()
    const ledger = new PublicationLedger({ filePath: LEDGER })
    ledger.record({ videoId: 'g3', uploadState: 'SUCCESS', verificationState: 'REJECTED' })
    const m = ledger.toGalleryManifest('ch')
    assert.equal(m.videos.length, 0)
    cleanup()
  })

  it('gallery excludes FAILED uploads', () => {
    cleanup()
    const ledger = new PublicationLedger({ filePath: LEDGER })
    ledger.record({ videoId: 'g4', uploadState: 'FAILED', verificationState: 'PENDING' })
    const m = ledger.toGalleryManifest('ch')
    assert.equal(m.videos.length, 0)
    cleanup()
  })

  it('gallery includes VIDEO_NOT_VISIBLE_YET entries (publication valid, verification pending)', () => {
    cleanup()
    const ledger = new PublicationLedger({ filePath: LEDGER })
    ledger.record({ videoId: 'g5', uploadState: 'SUCCESS', verificationState: 'VIDEO_NOT_VISIBLE_YET' })
    const m = ledger.toGalleryManifest('ch')
    assert.equal(m.videos.length, 1)
    assert.equal(m.videos[0].verified, false)
    assert.equal(m.videos[0].verificationState, 'VIDEO_NOT_VISIBLE_YET')
    cleanup()
  })

  it('VerifyState enum has errorType field', () => {
    assert.equal(VerifyState.VERIFICATION_FAILED, 'VERIFICATION_FAILED')
    assert.equal(VerifyState.VIDEO_NOT_VISIBLE_YET, 'VIDEO_NOT_VISIBLE_YET')
    assert.equal(VerifyState.CUSTOM_THUMBNAIL_ACCEPTED, 'CUSTOM_THUMBNAIL_ACCEPTED')
    assert.equal(VerifyState.CUSTOM_THUMBNAIL_REJECTED, 'CUSTOM_THUMBNAIL_REJECTED')
  })

  it('resolveThumbnailUrl returns explicit URL', () => {
    const url = resolveThumbnailUrl('id', 'https://example.com/thumb.jpg')
    assert.equal(url, 'https://example.com/thumb.jpg')
  })

  it('resolveThumbnailUrl falls back to ytimg', () => {
    const url = resolveThumbnailUrl('abc123', null)
    assert.equal(url, 'https://i.ytimg.com/vi/abc123/maxresdefault.jpg')
  })

  it('resolveThumbnailUrl uses placeholder when no videoId', () => {
    const url = resolveThumbnailUrl(null, null)
    assert.equal(url, '/assets/placeholder-thumbnail.jpg')
  })
})

describe('YouTubePropagationVerifier error classification', () => {
  it('returns AUTHORIZATION on 401', async () => {
    const { YouTubePropagationVerifier, VerifyState } = await import('../src/publishing/YouTubePropagationVerifier.mjs')
    const verifier = new YouTubePropagationVerifier({ token: '', maxAttempts: 1, delays: [0] })
    const result = await verifier.verify({ videoId: 'test' })
    // Empty token → 401 or 403 authError → should be AUTHORIZATION
    assert.equal(result.state, VerifyState.VERIFICATION_FAILED)
    assert.equal(result.errorType, 'AUTHORIZATION')
  })

  it('returns AUTHORIZATION on 403 forbidden', async () => {
    const { YouTubePropagationVerifier, VerifyState } = await import('../src/publishing/YouTubePropagationVerifier.mjs')
    const verifier = new YouTubePropagationVerifier({ token: '', maxAttempts: 1, delays: [0] })
    const result = await verifier.verify({ videoId: 'test' })
    assert.equal(result.state, VerifyState.VERIFICATION_FAILED)
    assert.ok(['AUTHORIZATION', 'QUOTA'].includes(result.errorType))
  })
})

describe('PostPublishVerifier', () => {
  it('returns check result structure', async () => {
    const verifier = new PostPublishVerifier({ youtube: {}, fallback: {} })
    const result = await verifier.verify({ videoId: 'test123', title: 'Test' })
    assert.ok(typeof result.passed === 'boolean')
    assert.ok(typeof result.verifiedAt === 'string')
    assert.ok(result.checks)
    assert.ok(Array.isArray(result.failures))
  })

  it('detects missing checks', async () => {
    const verifier = new PostPublishVerifier({ youtube: {}, fallback: {} })
    const result = await verifier.verify({ videoId: 'test123', title: 'Test' })
    assert.equal(result.passed, false)
  })
})
