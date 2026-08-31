// ThumbnailUploadArtifact — bounded YouTube upload copy (thumbnails.set ≤ 2 MiB).
// Covers the transformation ladder with a deterministic canvas seam (no native
// decode, no flaky @napi-rs/canvas loadImage on the test path):
//   NONE / RECOMPRESSED / DOWNSCALED / THUMBNAIL_UPLOAD_COPY_TOO_LARGE
//
// Run: node --test tests/thumbnail-upload-artifact.test.mjs

import { describe, it, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  prepareUploadThumbnail,
  MAX_YOUTUBE_THUMBNAIL_BYTES,
  UploadTransformation,
  UPLOAD_COPY_MAX_EDGE,
  ThumbnailUploadError,
} from '../src/thumbnail/ThumbnailUploadArtifact.mjs'

// A PNG that decodes to a 3840x2160 image (landscape, 16:9) — the canonical
// local shape. `width`/`height`/`toBuffer` let tests fully control output
// sizes/bytes without real encoding.
function fakeImage(width, height) {
  return { width, height, srcWidth: width, srcHeight: height }
}

// Seam: { createCanvas, loadImage }. We hand-encode PNG bytes sized by the
// requested dimensions so DOWNSCALED produces smaller output than the source.
function makeSeam({ sourceBytes, srcW, srcH, byteFactor = 1 }) {
  const pngStore = []
  const createCanvas = (w, h) => {
    const canvas = {
      canvasW: w,
      canvasH: h,
      getContext: () => ({
        imageSmoothingEnabled: true,
        drawImage: () => {},
      }),
      // 2-byte PNG sig + w/h + deterministic size derived from dimensions.
      toBuffer: (fmt, opts) => {
        const size = Math.max(1, Math.round((w * h) / 20000) * byteFactor)
        const buf = Buffer.alloc(size)
        buf[0] = 0x89
        buf[1] = 0x50
        return buf
      },
    }
    pngStore.push(canvas)
    return canvas
  }
  const loadImage = async () => {
    const img = fakeImage(srcW, srcH)
    img.previewBytes = sourceBytes
    return img
  }
  return { createCanvas, loadImage }
}

describe('prepareUploadThumbnail', () => {
  let tmpDir

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'thumb-artifact-'))
  })
  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true })
  })

  it('NONE: canonical ≤ budget is uploaded unchanged', async () => {
    const path = join(tmpDir, 'small.png')
    const bytes = Buffer.alloc(1024)
    bytes[0] = 0x89
    writeFileSync(path, bytes)

    const result = await prepareUploadThumbnail({ path })
    assert.equal(result.transformation, UploadTransformation.NONE)
    assert.equal(result.path, path, 'NONE must return the canonical path unchanged')
    assert.equal(result.bytes, 1024)
    assert.equal(result.width, null)
    assert.equal(result.height, null)
    assert.equal(result.mimeType, 'image/png')
    assert.equal(result.sha256.length, 64)
  })

  it('RECOMPRESSED: oversized canonical re-encoded to fit, canonical untouched', async () => {
    const path = join(tmpDir, 'big-original.png')
    const sourceBytes = Buffer.alloc(MAX_YOUTUBE_THUMBNAIL_BYTES + 1) // just over 2 MiB
    sourceBytes[0] = 0x89
    writeFileSync(path, sourceBytes)

    // Re-encoding at same dims yields a much smaller PNG (fits budget).
    const seam = makeSeam({ srcW: 3840, srcH: 2160, byteFactor: 1 })
    const result = await prepareUploadThumbnail({ path, outDir: tmpDir, canvas: seam })

    assert.equal(result.transformation, UploadTransformation.RECOMPRESSED)
    assert.notEqual(result.path, path, 'must produce a copy, not mutate canonical')
    assert.ok(result.path.startsWith(tmpDir))
    assert.equal(result.width, 3840)
    assert.equal(result.height, 2160)
    assert.ok(result.bytes <= MAX_YOUTUBE_THUMBNAIL_BYTES, 'copy must be ≤ 2 MiB')
    // Canonical file is byte-for-byte untouched.
    assert.equal((await import('node:fs')).readFileSync(path).length, sourceBytes.length)
  })

  it('DOWNSCALED: recompress still too big → preserve aspect, longest edge 1280', async () => {
    const path = join(tmpDir, 'huge-original.png')
    const sourceBytes = Buffer.alloc(MAX_YOUTUBE_THUMBNAIL_BYTES + 5000)
    sourceBytes[0] = 0x89
    writeFileSync(path, sourceBytes)

    // Huge byte factor so even recompressed stays > budget → falls to DOWNSCALED.
    const seam = makeSeam({ srcW: 3840, srcH: 2160, byteFactor: 6000 })
    const result = await prepareUploadThumbnail({ path, outDir: tmpDir, canvas: seam })

    assert.equal(result.transformation, UploadTransformation.DOWNSCALED)
    assert.ok(result.bytes <= MAX_YOUTUBE_THUMBNAIL_BYTES, 'downscaled copy must be ≤ 2 MiB')
    // 16:9 preserved, longest edge bounded by UPLOAD_COPY_MAX_EDGE (1280x720).
    assert.equal(result.width, UPLOAD_COPY_MAX_EDGE)
    assert.ok(result.height <= UPLOAD_COPY_MAX_EDGE)
    const ratio = result.width / result.height
    assert.ok(Math.abs(ratio - 3840 / 2160) < 0.01, `aspect preserved, got ${ratio}`)
  })

  it('throws THUMBNAIL_UPLOAD_COPY_TOO_LARGE when no copy fits the budget', async () => {
    const path = join(tmpDir, 'unbounded.png')
    writeFileSync(path, Buffer.alloc(MAX_YOUTUBE_THUMBNAIL_BYTES + 100))

    // Force EVERY rung of the ladder (RECOMPRESSED 3840x2160 and DOWNSCALED
    // 1280x720) to exceed the budget so no copy fits. The byte factor is chosen
    // to keep the fabricated buffers SMALL but strictly over the 2 MiB budget
    // (DOWNSCALED 46.08×50k ≈ 2.3 MiB, RECOMPRESSED 414.72×50k ≈ 20 MiB) — an
    // enormous factor like 1e9 produced multi-hundred-GB allocations that threw
    // RangeError on constrained CI runners instead of ThumbnailUploadError.
    const seam = makeSeam({ srcW: 3840, srcH: 2160, byteFactor: 50_000 })
    await assert.rejects(
      () => prepareUploadThumbnail({ path, outDir: tmpDir, canvas: seam }),
      (err) => {
        assert.ok(err instanceof ThumbnailUploadError)
        assert.equal(err.code, 'THUMBNAIL_UPLOAD_COPY_TOO_LARGE')
        return true
      }
    )
  })

  it('throws THUMBNAIL_NOT_FOUND / THUMBNAIL_PATH_REQUIRED', async () => {
    await assert.rejects(
      () => prepareUploadThumbnail({ path: '/does/not/exist.png' }),
      (err) => err.code === 'THUMBNAIL_NOT_FOUND'
    )
    await assert.rejects(
      () => prepareUploadThumbnail({ path: null }),
      (err) => err.code === 'THUMBNAIL_PATH_REQUIRED'
    )
  })
})
