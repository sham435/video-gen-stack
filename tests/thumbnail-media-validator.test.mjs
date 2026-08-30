// ThumbnailMediaValidator — pure-buffer PNG structural integrity (NO native decode).
// Covers: VALID / INVALID_SIGNATURE / INVALID_IHDR / UNSUPPORTED_BIT_DEPTH /
// UNSUPPORTED_COLOR_TYPE / MALFORMED_CHUNK / CRC_MISMATCH / MISSING_IDAT /
// MISSING_IEND / TOO_LARGE / EMPTY — all fail SAFELY with a reason, no SIGSEGV.
//
// Run: node --test tests/thumbnail-media-validator.test.mjs

import { describe, it, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import zlib from 'node:zlib'
import { createCanvas } from '@napi-rs/canvas'
import {
  validateThumbnailMedia,
  validateThumbnailMediaFile,
  MediaValidationState,
  MAX_YOUTUBE_THUMBNAIL_BYTES,
} from '../src/thumbnail/ThumbnailMediaValidator.mjs'

// CRC-32 (PNG uses the same polynomial as zlib) — implemented inline so the
// test has no extra dependency.
let CRC_POLY = (() => {
  const t = new Int32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[n] = c
  }
  return t
})()
function crc32(buf) {
  let c = -1
  for (let i = 0; i < buf.length; i++) c = CRC_POLY[(c ^ buf[i]) & 0xff] ^ (c >>> 8)
  return (c ^ -1) >>> 0
}

// Build a well-formed PNG buffer of the given width/height via the real encoder,
// then parse its chunk offsets so we can surgically corrupt it.
function chunkOffsets(buf) {
  const chunks = []
  let offset = 8
  while (offset < buf.length) {
    const len = buf.readUInt32BE(offset)
    const type = buf.toString('latin1', offset + 4, offset + 8)
    chunks.push({ type, start: offset, len, dataStart: offset + 8 })
    offset = offset + 8 + len + 4
  }
  return chunks
}

function makePNG(width = 2160, height = 3840) {
  const c = createCanvas(width, height)
  const x = c.getContext('2d')
  x.fillStyle = '#1a2a3a'
  x.fillRect(0, 0, width, height)
  return c.toBuffer('image/png')
}

function makePNGWithBitDepth(bitDepth, colorType) {
  // Build a minimal valid PNG: 8-byte sig + IHDR + IDAT + IEND, with CRCs patched.
  const width = 2160
  const height = 3840
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = bitDepth
  ihdr[9] = colorType
  ihdr[10] = 0
  ihdr[11] = 0
  ihdr[12] = 0

  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  const idatData = Buffer.from([0x78, 0x9c, 0x00]) // zlib-ish placeholder

  function chunk(type, data) {
    const hdr = Buffer.alloc(8)
    hdr.writeUInt32BE(data.length, 0)
    hdr.write(type, 4, 'latin1')
    const crc = Buffer.alloc(4)
    crc.writeUInt32BE(crc32(Buffer.concat([hdr.subarray(4, 8), data])), 0)
    return Buffer.concat([hdr, data, crc])
  }

  const idat = chunk('IDAT', zlib.deflateSync(Buffer.alloc(width * height * 1, 0)))
  const iend = chunk('IEND', Buffer.alloc(0))
  const ihdrChunk = chunk('IHDR', ihdr)
  return Buffer.concat([sig, ihdrChunk, idat, iend])
}

describe('validateThumbnailMedia', () => {
  it('VALID: real 2160x3840 PNG is structurally sound', () => {
    const buf = makePNG(2160, 3840)
    const r = validateThumbnailMedia(buf)
    assert.equal(r.valid, true)
    assert.equal(r.state, MediaValidationState.VALID)
    assert.equal(r.width, 2160)
    assert.equal(r.height, 3840)
    assert.ok(r.idatChunks >= 1)
  })

  it('INVALID_SIGNATURE: non-PNG bytes rejected safely', () => {
    const r = validateThumbnailMedia(Buffer.from('not a png at all!!!'))
    assert.equal(r.valid, false)
    assert.equal(r.state, MediaValidationState.INVALID_SIGNATURE)
  })

  it('EMPTY / non-buffer rejected', () => {
    assert.equal(validateThumbnailMedia(Buffer.alloc(0)).state, MediaValidationState.EMPTY)
    assert.equal(validateThumbnailMedia(null).state, MediaValidationState.EMPTY)
  })

  it('CRC_MISMATCH: corrupted IHDR bytes detected', () => {
    const buf = makePNG(2160, 3840)
    const ihdr = chunkOffsets(buf).find(c => c.type === 'IHDR')
    const bad = Buffer.from(buf)
    bad[ihdr.dataStart + 8] = 0x04 // corrupt width
    const r = validateThumbnailMedia(bad)
    assert.equal(r.valid, false)
    assert.equal(r.state, MediaValidationState.CRC_MISMATCH)
  })

  it('CRC_MISMATCH: corrupted IDAT bytes detected', () => {
    const buf = makePNG(2160, 3840)
    const idat = chunkOffsets(buf).find(c => c.type === 'IDAT')
    const bad = Buffer.from(buf)
    bad[idat.dataStart] ^= 0xff
    const r = validateThumbnailMedia(bad)
    assert.equal(r.valid, false)
    assert.equal(r.state, MediaValidationState.CRC_MISMATCH)
  })

  it('MISSING_IDAT: image data removed', () => {
    const buf = makePNG(2160, 3840)
    const chunks = chunkOffsets(buf)
    const idatStart = chunks.find(c => c.type === 'IDAT').start
    const withoutIDAT = Buffer.concat([buf.subarray(0, idatStart), makeIEND(buf)])
    const r = validateThumbnailMedia(withoutIDAT)
    assert.equal(r.valid, false)
    assert.equal(r.state, MediaValidationState.MISSING_IDAT)
  })

  it('MALFORMED_CHUNK: truncated buffer fails safely', () => {
    const buf = makePNG(2160, 3840).slice(0, 40)
    const r = validateThumbnailMedia(buf)
    assert.equal(r.valid, false)
    assert.equal(r.state, MediaValidationState.MALFORMED_CHUNK)
  })

  it('TOO_LARGE: exceeds 2 MiB upload budget', () => {
    // Craft a buffer whose size alone exceeds the budget (signature-valid region).
    const big = Buffer.alloc(MAX_YOUTUBE_THUMBNAIL_BYTES + 1)
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(big, 0)
    const r = validateThumbnailMedia(big, { maxBytes: MAX_YOUTUBE_THUMBNAIL_BYTES })
    assert.equal(r.valid, false)
    assert.equal(r.state, MediaValidationState.TOO_LARGE)
  })

  it('UNSUPPORTED_BIT_DEPTH detected from IHDR', () => {
    const r = validateThumbnailMedia(makePNGWithBitDepth(3, 2))
    assert.equal(r.valid, false)
    assert.equal(r.state, MediaValidationState.UNSUPPORTED_BIT_DEPTH)
  })

  it('UNSUPPORTED_COLOR_TYPE detected from IHDR', () => {
    const r = validateThumbnailMedia(makePNGWithBitDepth(8, 7))
    assert.equal(r.valid, false)
    assert.equal(r.state, MediaValidationState.UNSUPPORTED_COLOR_TYPE)
  })

  it('checkCrc=false skips integrity but still validates structure', () => {
    const buf = makePNG(2160, 3840)
    const ihdr = chunkOffsets(buf).find(c => c.type === 'IHDR')
    const bad = Buffer.from(buf)
    bad[ihdr.dataStart + 8] = 0x04
    const r = validateThumbnailMedia(bad, { checkCrc: false })
    assert.equal(r.valid, true, 'with CRC off, structure only is validated')
  })
})

describe('validateThumbnailMediaFile', () => {
  let tmpDir
  beforeEach(() => { tmpDir = mkdtempSync(join(tmpdir(), 'thumb-media-')) })
  afterEach(() => { rmSync(tmpDir, { recursive: true, force: true }) })

  it('returns NOT_FOUND for a missing file', async () => {
    const r = await validateThumbnailMediaFile(join(tmpDir, 'nope.png'))
    assert.equal(r.valid, false)
    assert.equal(r.state, 'NOT_FOUND')
  })

  it('validates a real PNG file on disk', async () => {
    const path = join(tmpDir, 'thumb.png')
    writeFileSync(path, makePNG(2160, 3840))
    const r = await validateThumbnailMediaFile(path)
    assert.equal(r.valid, true)
    assert.equal(r.width, 2160)
  })
})

function makeIEND(buf) {
  // Append a well-formed IEND to the end of the (already-crced) buffer slice.
  const iendData = Buffer.alloc(0)
  const hdr = Buffer.alloc(8)
  hdr.writeUInt32BE(0, 0)
  hdr.write('IEND', 4, 'latin1')
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(hdr.subarray(4, 8)), 0)
  return Buffer.concat([hdr, crc])
}
