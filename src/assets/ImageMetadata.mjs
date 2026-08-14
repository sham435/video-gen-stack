// ImageMetadata — deterministic metadata extraction for any image buffer.
//
// Produces the index record used by ImageDatabase:
//   - sha256 : exact-content fingerprint (crypto)
//   - dHash  : 64-bit perceptual hash (difference hash) for near-duplicate
//              detection (crops, scaling, recolors)
//   - pHash  : 64-bit DCT-based perceptual hash (average-hash on low-frequency
//              DCT coefficients) — the "neural-ish" robustness the plan asks
//              for, without a CLIP dependency. A CLIP embedding can be layered
//              on later by storing `clip: float[512]` in the same record.
//   - width/height/aspect : layout metadata
//
// dHash pipeline: decode → fit to 9x8 grayscale → compare horizontal neighbor
// pixels → 64 bits. Deterministic for identical bytes; robust to resizing.
// pHash pipeline: decode → fit to 32x32 grayscale → DCT → keep the low-frequency
// 8x8 block → median-threshold to 64 bits. Stronger on recolors/compression.

import { createHash } from 'node:crypto'
import { createCanvas, loadImage } from '@napi-rs/canvas'

const HASH_SIZE_X = 9
const HASH_SIZE_Y = 8

// pHash (DCT) sizing.
const P_SIZE = 32        // DCT input: 32x32 grayscale
const P_BLOCK = 8        // low-frequency block kept after DCT (8x8 = 64 bits)

function toGrayscale8x9(canvas, ctx) {
  const { data } = ctx.getImageData(0, 0, HASH_SIZE_X, HASH_SIZE_Y)
  const g = new Uint8Array(HASH_SIZE_X * HASH_SIZE_Y)
  for (let i = 0; i < g.length; i++) {
    const r = data[i * 4], gg = data[i * 4 + 1], b = data[i * 4 + 2]
    g[i] = (r * 299 + gg * 587 + b * 114) / 1000
  }
  return g
}

function toGrayscale32(canvas, ctx) {
  const { data } = ctx.getImageData(0, 0, P_SIZE, P_SIZE)
  const g = new Float32Array(P_SIZE * P_SIZE)
  for (let i = 0; i < g.length; i++) {
    const r = data[i * 4], gg = data[i * 4 + 1], b = data[i * 4 + 2]
    g[i] = (r * 299 + gg * 587 + b * 114) / 1000
  }
  return g
}

// 2D DCT-II (separable). Normalization is irrelevant for thresholding the
// low-frequency block, so we skip the scaling factors entirely.
function dct2d(input, n) {
  const out = new Float32Array(n * n)
  for (let u = 0; u < n; u++) {
    for (let v = 0; v < n; v++) {
      let sum = 0
      for (let x = 0; x < n; x++) {
        for (let y = 0; y < n; y++) {
          sum += input[y * n + x] *
            Math.cos(((2 * x + 1) * u * Math.PI) / (2 * n)) *
            Math.cos(((2 * y + 1) * v * Math.PI) / (2 * n))
        }
      }
      out[v * n + u] = sum
    }
  }
  return out
}

function computePHash(gray) {
  const dct = dct2d(gray, P_SIZE)
  // Take the top-left P_BLOCK x P_BLOCK low-frequency coefficients.
  const low = []
  for (let v = 0; v < P_BLOCK; v++) {
    for (let u = 0; u < P_BLOCK; u++) low.push(dct[v * P_SIZE + u])
  }
  const sorted = [...low].sort((a, b) => a - b)
  const median = sorted[Math.floor(low.length / 2)]
  let hash = 0n
  for (let i = 0; i < low.length; i++) {
    if (low[i] > median) hash |= (1n << BigInt(i))
  }
  return hash.toString(16).padStart(16, '0')
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
  let pHash = ''
  try {
    const canvas = createCanvas(HASH_SIZE_X, HASH_SIZE_Y)
    const gctx = canvas.getContext('2d')
    gctx.drawImage(img, 0, 0, HASH_SIZE_X, HASH_SIZE_Y)
    dHash = computeDHash(toGrayscale8x9(canvas, gctx))

    const pcanvas = createCanvas(P_SIZE, P_SIZE)
    const pctx = pcanvas.getContext('2d')
    pctx.drawImage(img, 0, 0, P_SIZE, P_SIZE)
    pHash = computePHash(toGrayscale32(pcanvas, pctx))
  } catch (e) {
    dHash = ''
    pHash = ''
  }

  return {
    sha256,
    dHash,
    pHash,
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

/** Hamming distance between two 16-hex-char pHash strings. */
export function pHashDistance(a, b) {
  if (!a || !b) return Number.MAX_SAFE_INTEGER
  const ai = BigInt('0x' + a)
  const bi = BigInt('0x' + b)
  let x = ai ^ bi
  let dist = 0
  while (x) { dist += Number(x & 1n); x >>= 1n }
  return dist
}

/** 1.0 = identical, 0.0 = different (from pHash distance). */
export function pHashSimilarity(a, b) {
  const d = pHashDistance(a, b)
  if (d === Number.MAX_SAFE_INTEGER) return 0
  return 1 - d / 64
}
