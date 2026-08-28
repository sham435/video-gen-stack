// ThumbnailMetadata — immutable identity for a thumbnail file.
//
// Computes the exact-content fingerprint (sha256) plus geometry + mime type.
// This is the identity that flows into PublicationArtifact and is compared
// against the remote thumbnail YouTube actually serves.

import { readFileSync, existsSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { loadImage } from '@napi-rs/canvas'

const MIME_SIGNATURES = [
  { sig: [0x89, 0x50, 0x4e, 0x47], mime: 'image/png', ext: 'png' },
  { sig: [0xff, 0xd8, 0xff], mime: 'image/jpeg', ext: 'jpg' },
]

function detectMime(buffer) {
  for (const { sig, mime } of MIME_SIGNATURES) {
    if (sig.every((b, i) => buffer[i] === b)) return mime
  }
  return 'image/png'
}

/**
 * Inspect a thumbnail file from disk.
 * @returns {Promise<{sha256:string, mimeType:string, width:number, height:number,
 *   aspectRatio:string, bytes:number}>}
 * @throws if the file is missing or not a decodable image
 */
export async function inspectThumbnailFile(thumbnailPath) {
  if (!existsSync(thumbnailPath)) {
    throw new Error(`thumbnail not found: ${thumbnailPath}`)
  }
  const buffer = readFileSync(thumbnailPath)
  if (!buffer.length) throw new Error(`thumbnail empty: ${thumbnailPath}`)

  const sha256 = createHash('sha256').update(buffer).digest('hex')
  const mimeType = detectMime(buffer)

  let width = 0
  let height = 0
  try {
    const img = await loadImage(buffer)
    width = img.width
    height = img.height
  } catch (e) {
    throw new Error(`thumbnail not a decodable image: ${e.message}`)
  }

  return {
    sha256,
    mimeType,
    width,
    height,
    aspectRatio: height > 0 ? `${width / gcd(width, height)}:${height / gcd(width, height)}` : null,
    bytes: buffer.length,
  }
}

/** Compute sha256 of a thumbnail path (no geometry). */
export function sha256Thumbnail(thumbnailPath) {
  if (!existsSync(thumbnailPath)) return null
  return createHash('sha256').update(readFileSync(thumbnailPath)).digest('hex')
}

function gcd(a, b) {
  a = Math.abs(a); b = Math.abs(b)
  while (b) { const t = b; b = a % b; a = t }
  return a || 1
}
