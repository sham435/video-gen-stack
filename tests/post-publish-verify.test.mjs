import { describe, it, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { PostPublishVerifier } from '../src/publishing/PostPublishVerifier.mjs'
import { PublicationLedger } from '../src/publishing/PublicationLedger.mjs'

describe('PostPublishVerifier', () => {
  it('returns failed result when no token available', async () => {
    const verifier = new PostPublishVerifier({ token: '' })
    const result = await verifier.verify({
      videoId: 'test123',
      expectedTitle: 'Test',
      jobId: 'job-001',
    })
    assert.equal(result.passed, false)
    assert.equal(result.videoId, 'test123')
    assert.equal(result.jobId, 'job-001')
    assert.ok(result.checks)
    assert.ok(result.durationMs >= 0)
    assert.ok(result.verifiedAt)
  })

  it('checks videoReachable fails without API access', async () => {
    const verifier = new PostPublishVerifier({ token: '' })
    const result = await verifier.verify({
      videoId: 'nonexistent',
      jobId: 'job-002',
    })
    assert.equal(result.checks.videoReachable.pass, false)
  })

  it('checks local thumbnail exists', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'verify-test-'))
    const verifier = new PostPublishVerifier({ token: '' })
    // Non-existent path
    const result = await verifier.verify({
      videoId: 'test',
      thumbnailPath: join(dir, 'missing.png'),
      jobId: 'job-003',
    })
    assert.equal(result.checks.localThumbnail.pass, false)
    rmSync(dir, { recursive: true })
  })

  it('checks local thumbnail present', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'verify-test-'))
    const { writeFileSync } = await import('node:fs')
    writeFileSync(join(dir, 'thumb.png'), 'fake-image')
    const verifier = new PostPublishVerifier({ token: '' })
    const result = await verifier.verify({
      videoId: 'test',
      thumbnailPath: join(dir, 'thumb.png'),
      jobId: 'job-004',
    })
    assert.equal(result.checks.localThumbnail.pass, true)
    assert.ok(result.checks.localThumbnail.size > 0)
    rmSync(dir, { recursive: true })
  })
})

describe('PublicationLedger', () => {
  let dir
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'ledger-test-')) })
  afterEach(() => { rmSync(dir, { recursive: true }) })

  it('starts empty', () => {
    const ledger = new PublicationLedger({ filePath: join(dir, 'ledger.json') })
    assert.equal(ledger.count(), 0)
    assert.deepEqual(ledger.all(), [])
  })

  it('records and retrieves entries', () => {
    const ledger = new PublicationLedger({ filePath: join(dir, 'ledger.json') })
    ledger.record({
      videoId: 'vid1',
      jobId: 'job-1',
      title: 'Test Video',
      category: 'technology',
      checks: { videoReachable: { pass: true } },
      publishedAt: '2026-08-26T21:00:00Z',
    })
    assert.equal(ledger.count(), 1)
    const entry = ledger.findByVideoId('vid1')
    assert.ok(entry)
    assert.equal(entry.title, 'Test Video')
    assert.equal(entry.category, 'technology')
  })

  it('updates existing entry on duplicate videoId', () => {
    const ledger = new PublicationLedger({ filePath: join(dir, 'ledger.json') })
    ledger.record({ videoId: 'vid1', title: 'V1', jobId: 'j1' })
    ledger.record({ videoId: 'vid1', title: 'V2', jobId: 'j1' })
    assert.equal(ledger.count(), 1)
    assert.equal(ledger.findByVideoId('vid1').title, 'V2')
  })

  it('generates gallery manifest', () => {
    const ledger = new PublicationLedger({ filePath: join(dir, 'ledger.json') })
    ledger.record({
      videoId: 'vid1', title: 'Test', category: 'tech',
      publishedAt: '2026-08-26T21:00:00Z', thumbnail: 'https://example.com/t.jpg',
      uploadState: 'SUCCESS', verificationState: 'VERIFIED',
    })
    const manifest = ledger.toGalleryManifest('UC123')
    assert.equal(manifest.channelId, 'UC123')
    assert.equal(manifest.source, 'publication-ledger')
    assert.equal(manifest.videos.length, 1)
    assert.equal(manifest.videos[0].verified, true)
    assert.equal(manifest.videos[0].thumbnail, 'https://example.com/t.jpg')
  })

  it('persists across instances', () => {
    const fp = join(dir, 'ledger.json')
    const ledger1 = new PublicationLedger({ filePath: fp })
    ledger1.record({ videoId: 'vid1', title: 'T', jobId: 'j1' })
    const ledger2 = new PublicationLedger({ filePath: fp })
    assert.equal(ledger2.count(), 1)
    assert.equal(ledger2.findByVideoId('vid1').title, 'T')
  })

  it('all() returns newest first', () => {
    const ledger = new PublicationLedger({ filePath: join(dir, 'ledger.json') })
    ledger.record({ videoId: 'v1', title: 'First', jobId: 'j1' })
    ledger.record({ videoId: 'v2', title: 'Second', jobId: 'j2' })
    const all = ledger.all()
    assert.equal(all[0].videoId, 'v2')
    assert.equal(all[1].videoId, 'v1')
  })
})
