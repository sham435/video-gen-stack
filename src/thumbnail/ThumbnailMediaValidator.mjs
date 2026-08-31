// ThumbnailMediaValidator — pure-buffer PNG structural validation (no native decode).
//
// This is the "MEDIA_VALID" gate in the thumbnail production state machine:
//   GENERATED → MEDIA_VALID → POLICY_SAFE → UNIQUE → UPLOADABLE → UPLOADED → …
//
// It parses the PNG chunk structure directly from the buffer — signature, IHDR
// geometry/bit-depth/color-type, IDAT presence, IEND terminator, and (optionally)
// CRC-32 integrity on every chunk. It NEVER invokes @napi-rs/canvas / Sharp /
// any native image decoder, so a malformed or hostile PNG cannot crash the
// process (the previous native-decode SIGSEGV class). Failures are safe, pure,
// and reported with a machine-readable reason so the caller can decide whether
// to REGENERATE (invalid media) or QUARANTINE.
//
// This validator is aspect-agnostic — it only cares whether the bytes are a
// structurally valid PNG. Geometry/profile enforcement for the destination is
// a SEPARATE concern (ThumbnailProfile), which is 16:9 VIDEO (3840x2160).

const CRC_TABLE = (() => {
  const table = new Int32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    }
    table[n] = c
  }
  return table
})()

function crc32(buf, start, end) {
  let c = -1
  for (let i = start; i < end; i++) {
    c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8)
  }
  return (c ^ -1) >>> 0
}

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]

// YouTube thumbnails.set hard media-upload limit (docs: "Maximum file size: 2MB").
export const MAX_YOUTUBE_THUMBNAIL_BYTES = 2 * 1024 * 1024

// IHDR fields (bytes 8.. after signature): width(4) height(4) bitDepth(1)
// colorType(1) compression(1) filter(1) interlace(1)
const VALID_BIT_DEPTHS = new Set([1, 2, 4, 8, 16])
const VALID_COLOR_TYPES = new Set([0, 2, 3, 4, 6])

export const MediaValidationState = Object.freeze({
  VALID: 'VALID',
  INVALID_SIGNATURE: 'INVALID_SIGNATURE',
  INVALID_IHDR: 'INVALID_IHDR',
  UNSUPPORTED_BIT_DEPTH: 'UNSUPPORTED_BIT_DEPTH',
  UNSUPPORTED_COLOR_TYPE: 'UNSUPPORTED_COLOR_TYPE',
  MALFORMED_CHUNK: 'MALFORMED_CHUNK',
  CRC_MISMATCH: 'CRC_MISMATCH',
  MISSING_IDAT: 'MISSING_IDAT',
  MISSING_IEND: 'MISSING_IEND',
  TOO_LARGE: 'TOO_LARGE',
  EMPTY: 'EMPTY',
})

// An ancillary chunk allowlist is intentionally NOT enforced — PNG decoders
// must ignore unrecognized ancillary chunks. This validator only checks
// structural soundness: signature, IHDR first, IDAT present, CRC integrity,
// IEND terminator.

/**
 * Validate that a buffer is a structurally sound PNG file.
 *
 * @param {Buffer} buffer - raw file bytes
 * @param {object} [opts]
 * @param {number} [opts.maxBytes]       - optional hard size ceiling (e.g. 2 MiB upload budget)
 * @param {boolean} [opts.checkCrc=true] - verify per-chunk CRC-32
 * @returns {{ valid: boolean, state: string, reason: string,
 *             width: (number|null), height: (number|null),
 *             bitDepth: (number|null), colorType: (number|null),
 *             bytes: number, idatChunks: number }}
 */
export function validateThumbnailMedia(buffer, opts = {}) {
  const checkCrc = opts.checkCrc !== false
  const maxBytes = opts.maxBytes != null ? Number(opts.maxBytes) : null
  const bytes = buffer ? buffer.length : 0

  const fail = (state, reason) => ({
    valid: false,
    state,
    reason,
    width: null,
    height: null,
    bitDepth: null,
    colorType: null,
    bytes,
    idatChunks: 0,
  })

  if (!Buffer.isBuffer(buffer) || bytes === 0) return fail(MediaValidationState.EMPTY, 'empty or non-buffer input')
  if (maxBytes != null && bytes > maxBytes) {
    return fail(MediaValidationState.TOO_LARGE, `file ${bytes} bytes exceeds ${maxBytes} byte limit`)
  }
  for (let i = 0; i < 8; i++) {
    if (buffer[i] !== PNG_SIGNATURE[i]) {
      return fail(MediaValidationState.INVALID_SIGNATURE, `bad PNG signature byte ${i}`)
    }
  }

  // Walk chunks.
  let offset = 8
  let sawIHDR = false
  let sawIDAT = false
  let sawIEND = false
  let width = null
  let height = null
  let bitDepth = null
  let colorType = null
  let idatChunks = 0

  while (offset < bytes) {
    // Need at least 8 bytes for length + type.
    if (offset + 8 > bytes) {
      return fail(MediaValidationState.MALFORMED_CHUNK, `truncated chunk header at offset ${offset}`)
    }
    const length = buffer.readUInt32BE(offset)
    const type = buffer.toString('latin1', offset + 4, offset + 8)
    const dataStart = offset + 8
    const dataEnd = dataStart + length
    const crcStart = dataEnd
    const crcEnd = crcStart + 4

    if (dataEnd > bytes || crcEnd > bytes) {
      return fail(MediaValidationState.MALFORMED_CHUNK, `chunk '${type}' length ${length} exceeds buffer (offset ${offset})`)
    }
    if (checkCrc) {
      const expected = buffer.readUInt32BE(crcStart)
      const actual = crc32(buffer, offset + 4, dataEnd)
      if (actual !== expected) {
        return fail(MediaValidationState.CRC_MISMATCH, `CRC mismatch on chunk '${type}' (offset ${offset})`)
      }
    }

    if (type === 'IHDR') {
      if (sawIHDR) return fail(MediaValidationState.INVALID_IHDR, 'multiple IHDR chunks')
      sawIHDR = true
      if (length !== 13) return fail(MediaValidationState.INVALID_IHDR, `IHDR length ${length} != 13`)
      width = buffer.readUInt32BE(dataStart)
      height = buffer.readUInt32BE(dataStart + 4)
      bitDepth = buffer[dataStart + 8]
      colorType = buffer[dataStart + 9]
      const compression = buffer[dataStart + 10]
      const filter = buffer[dataStart + 11]
      const interlace = buffer[dataStart + 12]
      if (!width || !height) return fail(MediaValidationState.INVALID_IHDR, `zero dimension ${width}x${height}`)
      if (!VALID_BIT_DEPTHS.has(bitDepth)) return fail(MediaValidationState.UNSUPPORTED_BIT_DEPTH, `bit depth ${bitDepth} not supported`)
      if (!VALID_COLOR_TYPES.has(colorType)) return fail(MediaValidationState.UNSUPPORTED_COLOR_TYPE, `color type ${colorType} not supported`)
      if (compression !== 0) return fail(MediaValidationState.INVALID_IHDR, `unsupported compression method ${compression}`)
      if (filter !== 0) return fail(MediaValidationState.INVALID_IHDR, `unsupported filter method ${filter}`)
      if (interlace !== 0 && interlace !== 1) return fail(MediaValidationState.INVALID_IHDR, `invalid interlace method ${interlace}`)
    } else if (type === 'IDAT') {
      sawIDAT = true
      idatChunks++
    } else if (type === 'IEND') {
      if (length !== 0) return fail(MediaValidationState.MALFORMED_CHUNK, 'IEND must have zero length')
      sawIEND = true
      // IEND must be the final chunk.
      if (crcEnd !== bytes) {
        return fail(MediaValidationState.MALFORMED_CHUNK, 'trailing data after IEND')
      }
      break
    }

    offset = crcEnd
  }

  if (!sawIHDR) return fail(MediaValidationState.INVALID_IHDR, 'missing IHDR chunk')
  if (!sawIDAT) return fail(MediaValidationState.MISSING_IDAT, 'no IDAT chunk (no image data)')
  if (!sawIEND) return fail(MediaValidationState.MISSING_IEND, 'missing IEND terminator')

  return {
    valid: true,
    state: MediaValidationState.VALID,
    reason: null,
    width,
    height,
    bitDepth,
    colorType,
    bytes,
    idatChunks,
  }
}

/**
 * Validate a thumbnail file on disk (pure-buffer, safe).
 * @returns {Promise<object>} same shape as validateThumbnailMedia, but reads the file
 */
export async function validateThumbnailMediaFile(filePath, opts = {}) {
  const { readFileSync, existsSync } = await import('node:fs')
  if (!existsSync(filePath)) {
    return {
      valid: false,
      state: 'NOT_FOUND',
      reason: `file not found: ${filePath}`,
      width: null,
      height: null,
      bitDepth: null,
      colorType: null,
      bytes: 0,
      idatChunks: 0,
    }
  }
  return validateThumbnailMedia(readFileSync(filePath), opts)
}
