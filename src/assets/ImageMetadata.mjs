// ImageMetadata — deterministic metadata extraction for any image buffer.
//
// Produces the index record used by ImageDatabase:
//   - sha256 : exact-content fingerprint (crypto)
//   - dHash  : 64-bit perceptual hash (difference hash) for near-duplicate
//              detection (crops, scaling, recolors)
//   - width/height/aspect : layout metadata
//
// dHash pipeline: decode → fit to 9x8 grayscale → compare horizontal neighbor
// pixels → 64 bits. Deterministic for identical bytes; robust to resizing.

import { createHash } from 'node:crypto'
import { createCanvas, loadImage } from '@napi-rs/canvas'

const HASH_SIZE_X = 9
const HASH_SIZE_Y = 8

function toGrayscale8x9(canvas, ctx) {
  const { data } = ctx.getImageData(0, 0, HASH_SIZE_X, HASH_SIZE_Y)
  const g = new Uint8Array(HASH_SIZE_X * HASH_SIZE_Y)
  for (let i = 0; i < g.length; i++) {
    const r = data[i * 4], gg = data[i * 4 + 1], b = data[i * 4 + 2]
    g[i] = (r * 299 + gg * 587 + b * 114) / 1000
  }
  return g
}

function computeDHash(gray) {
  let hash = 0n
  let bit = 0
  for (let y = 0; y < HASH_SIZE_Y; y++) {
    for (let x = 0; x < HASH_SIZE_X - 1; x++) {
      if (gray[y * HASH_SIZE_X + x] > gray[y * HASH_SIZE_X + x + 1]) {
        hash |= (1n << BigInt(bit))
      }
      bit++
    }
  }
  return hash.toString(16).padStart(16, '0')
}

/**
 * Extract metadata from an image buffer.
 * @param {Buffer} buffer image bytes (jpeg/png/webp)
 * @param {object} [ctx] optional { url, entity, tags[], license, source }
 * @returns {Promise<{sha256:string, dHash:string, width:number, height:number,
 *   aspect:number, bytes:number, url:string|null, entity:string|null,
 *   tags:string[], license:string|null, source:string|null}>}
 * @throws if buffer is not a decodable image
 */
export async function extractImageMetadata(buffer, ctx = {}) {
  const sha256 = createHash('sha256').update(buffer).digest('hex')

  const img = await loadImage(buffer)
  let width = img.width
  let height = img.height

  let dHash = ''
  try {
    const canvas = createCanvas(HASH_SIZE_X, HASH_SIZE_Y)
    const gctx = canvas.getContext('2d')
    gctx.drawImage(img, 0, 0, HASH_SIZE_X, HASH_SIZE_Y)
    dHash = computeDHash(toGrayscale8x9(canvas, gctx))
  } catch (e) {
    dHash = ''
  }

  return {
    sha256,
    dHash,
    width,
    height,
    aspect: height > 0 ? +(width / height).toFixed(4) : 0,
    bytes: buffer.length,
    url: ctx.url || null,
    entity: ctx.entity || null,
    tags: ctx.tags || [],
    license: ctx.license || null,
    source: ctx.source || null,
  }
}

/** Hamming distance between two 16-hex-char dHash strings. */
export function dHashDistance(a, b) {
  if (!a || !b) return Number.MAX_SAFE_INTEGER
  const ai = BigInt('0x' + a)
  const bi = BigInt('0x' + b)
  let x = ai ^ bi
  let dist = 0
  while (x) { dist += Number(x & 1n); x >>= 1n }
  return dist
}

/** 1.0 = identical content, 0.0 = completely different (from dHash distance). */
export function dHashSimilarity(a, b) {
  const d = dHashDistance(a, b)
  if (d === Number.MAX_SAFE_INTEGER) return 0
  return 1 - d / 64
}
