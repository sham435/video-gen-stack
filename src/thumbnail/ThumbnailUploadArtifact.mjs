// ThumbnailUploadArtifact — bounded upload artifact for YouTube thumbnails.set.
//
// YouTube's `thumbnails.set` API enforces a hard 2 MiB media-upload limit:
//   https://developers.google.com/youtube/v3/docs/thumbnails/set
//     - Maximum file size: 2MB
//     - badRequest (400) / invalidImage → "The provided image content is invalid."
//
// The canonical Local thumbnail (output/thumbnail.png) is 3840x2160 (16:9) and
// is NEVER mutated. When it fits under the 2 MiB budget it is uploaded as-is
// (transformation NONE). When it exceeds the budget we produce a bounded UPLOAD
// COPY (never touching the canonical) by, in order:
//   1. RECOMPRESSED — re-encode the same canvas at PNG compressionLevel 9.
//   2. DOWNSCALED   — re-encode preserving aspect ratio, longest edge 1280
//                     (16:9 → 1280x720), comfortably under 2 MiB.
// If neither produces a copy ≤ 2 MiB we fail deterministically.
//
// Conversion only runs when the fallback path actually requires it. It uses
// @napi-rs/canvas (already a dependency; the same safe canvas the thumbnail
// renderer uses) — NOT Sharp, so the previous native-decode SIGSEGV class on
// the hot upload path is not reintroduced.
//
// The upload copy is ephemeral — it is never the canonical artifact and C2PA
// remains attached to the canonical provenance artifact.

import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHash, randomUUID } from 'node:crypto'
import { createCanvas, loadImage } from '@napi-rs/canvas'

// YouTube thumbnails.set hard media-upload limit (docs: "Maximum file size: 2MB").
export const MAX_YOUTUBE_THUMBNAIL_BYTES = 2 * 1024 * 1024

export const UploadTransformation = {
  NONE: 'NONE',
  RECOMPRESSED: 'RECOMPRESSED',
  DOWNSCALED: 'DOWNSCALED',
}

// Longest-edge bound for the DOWNSCALED fallback copy. 16:9 → 1280x720.
export const UPLOAD_COPY_MAX_EDGE = 1280

export class ThumbnailUploadError extends Error {
  constructor(code, message) {
    super(message)
    this.name = 'ThumbnailUploadError'
    this.code = code
  }
}

function sha256(buffer) {
  return createHash('sha256').update(buffer).digest('hex')
}

/**
 * Produce a YouTube-uploadable rendered copy of the canonical thumbnail path.
 *
 * @param {object} opts
 * @param {string} opts.path            - canonical thumbnail path (never mutated)
 * @param {string} [opts.outDir]        - directory for the upload copy (default tmpdir())
 * @param {number} [opts.maxBytes]      - budget (default MAX_YOUTUBE_THUMBNAIL_BYTES)
 * @param {object} [opts.canvas]        - test seam: { createCanvas, loadImage }
 * @returns {Promise<{path:string, width:(number|null), height:(number|null),
 *   bytes:number, sha256:string, mimeType:string, transformation:UploadTransformation,
 *   canonicalPath:string}>}
 * @throws {ThumbnailUploadError} if the file is missing/empty, unusable, or a
 *   bounded copy cannot be produced under the budget.
 */
export async function prepareUploadThumbnail({ path, outDir, maxBytes = MAX_YOUTUBE_THUMBNAIL_BYTES, canvas = null }) {
  if (!path) throw new ThumbnailUploadError('THUMBNAIL_PATH_REQUIRED', 'thumbnail path is required')
  if (!existsSync(path)) throw new ThumbnailUploadError('THUMBNAIL_NOT_FOUND', `thumbnail not found: ${path}`)

  const canonicalBytes = readFileSync(path)
  if (!canonicalBytes.length) throw new ThumbnailUploadError('THUMBNAIL_EMPTY', `thumbnail empty: ${path}`)
  const canonicalSha = sha256(canonicalBytes)

  // Bounded by default: upload the canonical unchanged.
  if (canonicalBytes.length <= maxBytes) {
    return {
      path, width: null, height: null,
      bytes: canonicalBytes.length, sha256: canonicalSha,
      mimeType: 'image/png', transformation: UploadTransformation.NONE,
      canonicalPath: path,
    }
  }

  const { createCanvas: CC, loadImage: LI } = canvas || { createCanvas, loadImage }
  const base = join(outDir || tmpdir(), `thumb_upload_${randomUUID()}.png`)

  let image
  try {
    image = await LI(canonicalBytes)
  } catch (e) {
    throw new ThumbnailUploadError('THUMBNAIL_UNDECODABLE', `thumbnail not decodable for fallback conversion: ${e.message}`)
  }
  const srcW = image.width
  const srcH = image.height

  // 1. RECOMPRESSED — same canvas, PNG compressionLevel 9.
  let rendered = await renderToPng(image, srcW, srcH, { compressionLevel: 9, createCanvas: CC })
  if (rendered.length <= maxBytes) {
    writeFileSync(base, rendered)
    return {
      path: base, width: srcW, height: srcH,
      bytes: rendered.length, sha256: sha256(rendered),
      mimeType: 'image/png', transformation: UploadTransformation.RECOMPRESSED,
      canonicalPath: path,
    }
  }
  const recompressedBytes = rendered.length

  // 2. DOWNSCALED — preserve aspect, longest edge bound.
  const scale = UPLOAD_COPY_MAX_EDGE / Math.max(srcW, srcH)
  let outW = Math.max(1, Math.round(srcW * scale))
  let outH = Math.max(1, Math.round(srcH * scale))
  outW = outW % 2 === 0 ? outW : outW + 1
  outH = outH % 2 === 0 ? outH : outH + 1
  rendered = await renderToPng(image, outW, outH, { compressionLevel: 9, createCanvas: CC })
  if (rendered.length <= maxBytes) {
    writeFileSync(base, rendered)
    return {
      path: base, width: outW, height: outH,
      bytes: rendered.length, sha256: sha256(rendered),
      mimeType: 'image/png', transformation: UploadTransformation.DOWNSCALED,
      canonicalPath: path,
    }
  }

  throw new ThumbnailUploadError(
    'THUMBNAIL_UPLOAD_COPY_TOO_LARGE',
    `cannot produce thumbnail upload copy ≤ ${maxBytes} bytes (canonical ${canonicalBytes.length} bytes, recompressed ${recompressedBytes}, downscaled ${rendered.length})`
  )
}

async function renderToPng(image, w, h, { compressionLevel, createCanvas }) {
  const c = createCanvas(w, h)
  const ctx = c.getContext('2d')
  ctx.imageSmoothingEnabled = true
  ctx.drawImage(image, 0, 0, w, h)
  return c.toBuffer('image/png', { compressionLevel })
}
