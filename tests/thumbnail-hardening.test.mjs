import { describe, it, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createCanvas } from '@napi-rs/canvas'

function makePng(dir, file, w, h) {
  const canvas = createCanvas(w, h)
  const ctx = canvas.getContext('2d')
  ctx.fillStyle = '#E10600'
  ctx.fillRect(0, 0, w, h)
  const path = join(dir, file)
  writeFileSync(path, canvas.toBuffer('image/png'))
  return path
}

describe('ThumbnailProfile', () => {
  let mod, ThumbnailProfile, enforceThumbnailProfile, resolveThumbnailProfile, ThumbnailValidationError

  before(async () => {
    mod = await import('../src/thumbnail/ThumbnailProfile.mjs')
    ThumbnailProfile = mod.ThumbnailProfile
    enforceThumbnailProfile = mod.enforceThumbnailProfile
    resolveThumbnailProfile = mod.resolveThumbnailProfile
    ThumbnailValidationError = mod.ThumbnailValidationError
  })

  it('exposes SHORT 1080x1920 9:16 and VIDEO 1280x720 16:9 profiles', () => {
    assert.deepEqual(ThumbnailProfile.SHORT, { width: 1080, height: 1920, aspectRatio: '9:16', mediaType: 'short' })
    assert.deepEqual(ThumbnailProfile.VIDEO, { width: 1280, height: 720, aspectRatio: '16:9', mediaType: 'video' })
  })

  it('resolves SHORT for vertical media / aspectRatio 9:16', () => {
    assert.equal(resolveThumbnailProfile({ width: 1080, height: 1920 }).mediaType, 'short')
    assert.equal(resolveThumbnailProfile({ aspectRatio: '9:16' }).mediaType, 'short')
    assert.equal(resolveThumbnailProfile({ type: 'short' }).mediaType, 'short')
  })

  it('enforces correct 9:16 thumbnail passes', () => {
    const profile = enforceThumbnailProfile({ width: 1080, height: 1920 }, { width: 1080, height: 1920 })
    assert.equal(profile.aspectRatio, '9:16')
  })

  it('throws THUMBNAIL_PROFILE_MISMATCH on stale 16:9 asset for a Short', () => {
    assert.throws(
      () => enforceThumbnailProfile({ width: 1080, height: 1920 }, { width: 1280, height: 720 }),
      (e) => e instanceof ThumbnailValidationError && e.code === 'THUMBNAIL_PROFILE_MISMATCH'
    )
  })

  it('throws THUMBNAIL_METADATA_MISSING when geometry unavailable', () => {
    assert.throws(
      () => enforceThumbnailProfile({ width: 1080, height: 1920 }, { width: null, height: null }),
      (e) => e instanceof ThumbnailValidationError && e.code === 'THUMBNAIL_METADATA_MISSING'
    )
  })
})

describe('ThumbnailMetadata', () => {
  let mod, inspectThumbnailFile, sha256Thumbnail
  let dir

  before(async () => {
    mod = await import('../src/thumbnail/ThumbnailMetadata.mjs')
    inspectThumbnailFile = mod.inspectThumbnailFile
    sha256Thumbnail = mod.sha256Thumbnail
  })

  it('extracts sha256 + dimensions + mimeType from a PNG', async () => {
    dir = mkdtempSync(join(tmpdir(), 'thumb-meta-'))
    const path = makePng(dir, 'thumb.png', 1080, 1920)
    const meta = await inspectThumbnailFile(path)
    assert.equal(meta.width, 1080)
    assert.equal(meta.height, 1920)
    assert.equal(meta.mimeType, 'image/png')
    assert.equal(meta.aspectRatio, '9:16')
    assert.match(meta.sha256, /^[a-f0-9]{64}$/)
    assert.equal(meta.bytes > 0, true)
    rmSync(dir, { recursive: true })
  })

  it('sha256Thumbnail returns stable fingerprint and null for missing file', () => {
    dir = mkdtempSync(join(tmpdir(), 'thumb-meta2-'))
    const path = makePng(dir, 'thumb.png', 1080, 1920)
    assert.equal(sha256Thumbnail(path), sha256Thumbnail(path))
    assert.equal(sha256Thumbnail(join(dir, 'missing.png')), null)
    rmSync(dir, { recursive: true })
  })
})

describe('PublicationArtifact blessDestinations', () => {
  let PublicationArtifact

  before(async () => {
    ({ PublicationArtifact } = await import('../src/distribution/PublicationArtifact.mjs'))
  })

  it('propagates canonical thumbnail identity into youtube destinations', () => {
    const a = new PublicationArtifact({
      artifactId: 'abc',
      thumbnailSha256: 'deadbeef'.repeat(8),
      thumbnailWidth: 1080,
      thumbnailHeight: 1920,
      thumbnailMimeType: 'image/png',
      thumbnailAspectRatio: '9:16',
    })
    assert.equal(a.destinations.youtube.thumbnail.sha256, null)
    a.blessDestinations()
    assert.equal(a.destinations.youtube.thumbnail.sha256, 'deadbeef'.repeat(8))
    assert.equal(a.destinations.youtube.thumbnail.width, 1080)
    assert.equal(a.destinations.youtube.thumbnail.height, 1920)
    assert.equal(a.destinations.youtube.thumbnail.mimeType, 'image/png')
    const json = a.toJSON()
    assert.equal(json.destinations.youtube.thumbnail.sha256, 'deadbeef'.repeat(8))
  })
})

describe('VerifyState new states', () => {
  let VerifyState

  before(async () => {
    ({ VerifyState } = await import('../src/publishing/YouTubePropagationVerifier.mjs'))
  })

  it('exposes MISMATCH, PENDING, UNKNOWN states', () => {
    assert.equal(VerifyState.CUSTOM_THUMBNAIL_MISMATCH, 'CUSTOM_THUMBNAIL_MISMATCH')
    assert.equal(VerifyState.CUSTOM_THUMBNAIL_PENDING, 'CUSTOM_THUMBNAIL_PENDING')
    assert.equal(VerifyState.CUSTOM_THUMBNAIL_UNKNOWN, 'CUSTOM_THUMBNAIL_UNKNOWN')
    assert.equal(VerifyState.CUSTOM_THUMBNAIL_ACCEPTED, 'CUSTOM_THUMBNAIL_ACCEPTED')
  })
})

describe('YouTubePropagationVerifier identity comparison', () => {
  let YouTubePropagationVerifier, VerifyState
  const realFetch = globalThis.fetch

  before(async () => {
    ({ YouTubePropagationVerifier, VerifyState } = await import('../src/publishing/YouTubePropagationVerifier.mjs'))
  })
  after(() => { globalThis.fetch = realFetch })

  function stubYouTube({ thumbnailUrl, remoteBytes, hasCustom }) {
    globalThis.fetch = async (url) => {
      if (String(url).includes('googleapis.com/youtube/v3/videos')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            items: [{
              contentDetails: { hasCustomThumbnail: hasCustom },
              snippet: { thumbnails: { maxres: { url: thumbnailUrl, width: 1080, height: 1920 } } },
            }],
          }),
        }
      }
      // thumbnail image download
      if (String(url) === thumbnailUrl) {
        return { ok: true, status: 200, arrayBuffer: async () => remoteBytes }
      }
      return { ok: false, status: 404, arrayBuffer: async () => new Uint8Array(0) }
    }
  }

  async function sha(buffer) {
    const { createHash } = await import('node:crypto')
    return createHash('sha256').update(Buffer.from(buffer)).digest('hex')
  }

  it('returns CUSTOM_THUMBNAIL_ACCEPTED when remote sha matches artifact', async () => {
    const bytes = new Uint8Array([1, 2, 3, 4])
    const sha256 = await sha(bytes)
    stubYouTube({ thumbnailUrl: 'https://i.ytimg.com/vi/x/maxres.jpg', remoteBytes: bytes, hasCustom: true })
    const v = new YouTubePropagationVerifier({ token: 't', maxAttempts: 1, delays: [0], sha256Fn: (b) => sha(b) })
    const r = await v.verify({ videoId: 'x', sha256 })
    assert.equal(r.state, VerifyState.CUSTOM_THUMBNAIL_ACCEPTED)
    assert.equal(r.thumbnailMatches, true)
  })

  it('returns CUSTOM_THUMBNAIL_MISMATCH when remote sha differs', async () => {
    stubYouTube({
      thumbnailUrl: 'https://i.ytimg.com/vi/x/maxres.jpg',
      remoteBytes: new Uint8Array([9, 9, 9, 9]),
      hasCustom: true,
    })
    const v = new YouTubePropagationVerifier({ token: 't', maxAttempts: 1, delays: [0], sha256Fn: (b) => sha(b) })
    const r = await v.verify({ videoId: 'x', sha256: 'a'.repeat(64) })
    assert.equal(r.state, VerifyState.CUSTOM_THUMBNAIL_MISMATCH)
    assert.equal(r.thumbnailMatches, false)
    assert.ok(r.remoteSha256)
  })

  it('returns CUSTOM_THUMBNAIL_REJECTED when no custom thumbnail', async () => {
    stubYouTube({
      thumbnailUrl: 'https://i.ytimg.com/vi/x/maxres.jpg',
      remoteBytes: new Uint8Array([1, 2, 3]),
      hasCustom: false,
    })
    const v = new YouTubePropagationVerifier({ token: 't', maxAttempts: 1, delays: [0], sha256Fn: (b) => sha(b) })
    const r = await v.verify({ videoId: 'x', sha256: 'a'.repeat(64) })
    assert.equal(r.state, VerifyState.CUSTOM_THUMBNAIL_REJECTED)
  })
})
