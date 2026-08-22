// Thumbnail validation preflight — ensures output/cover.png is a valid,
// upload-ready production artifact before touching the YouTube API.
//
// Validation checks:
//   1. File exists
//   2. Readable
//   3. Valid PNG signature (89 50 4E 47)
//   4. Correct 16:9 aspect ratio (1280x720 or 1920x1080)
//   5. Minimum resolution (≥ 640x360)
//   6. File size within bounds (> 5KB, < 10MB)
//
// Returns { ok, errors[], width, height, sizeBytes }

import { existsSync, readFileSync, statSync } from 'node:fs'

const MIN_WIDTH = 640
const MIN_HEIGHT = 360
const MIN_SIZE_BYTES = 5 * 1024         // 5 KB
const MAX_SIZE_BYTES = 10 * 1024 * 1024 // 10 MB
const ASPECT_TOLERANCE = 0.05           // ±5% tolerance on 16:9

// PNG header dimensions are at bytes 16-23 (width: 4 bytes BE, height: 4 bytes BE)
function readPngDimensions(buffer) {
  if (buffer.length < 24) return null
  // PNG signature: 89 50 4E 47 0D 0A 1A 0A
  if (buffer[0] !== 0x89 || buffer[1] !== 0x50 || buffer[2] !== 0x4e || buffer[3] !== 0x47) return null
  // IHDR chunk starts at offset 8; width at 16, height at 20
  const width = buffer.readUInt32BE(16)
  const height = buffer.readUInt32BE(20)
  return { width, height }
}

export function validateThumbnail(filePath) {
  const errors = []
  let width = 0, height = 0, sizeBytes = 0

  // 1. Exists
  if (!existsSync(filePath)) {
    return { ok: false, errors: [`file not found: ${filePath}`], width, height, sizeBytes }
  }

  // 2. Size
  try {
    const stat = statSync(filePath)
    sizeBytes = stat.size
    if (sizeBytes < MIN_SIZE_BYTES) errors.push(`file too small: ${sizeBytes} bytes (min ${MIN_SIZE_BYTES})`)
    if (sizeBytes > MAX_SIZE_BYTES) errors.push(`file too large: ${(sizeBytes / 1024 / 1024).toFixed(1)}MB (max 10MB)`)
  } catch (e) {
    return { ok: false, errors: [`cannot stat file: ${e.message}`], width, height, sizeBytes }
  }

  // 3. Read + validate PNG
  let buffer
  try {
    buffer = readFileSync(filePath)
  } catch (e) {
    return { ok: false, errors: [`cannot read file: ${e.message}`], width, height, sizeBytes }
  }

  const dims = readPngDimensions(buffer)
  if (!dims) {
    errors.push('not a valid PNG file (bad header signature)')
    return { ok: false, errors, width, height, sizeBytes }
  }
  width = dims.width
  height = dims.height

  // 4. Resolution
  if (width < MIN_WIDTH || height < MIN_HEIGHT) {
    errors.push(`resolution too low: ${width}x${height} (min ${MIN_WIDTH}x${MIN_HEIGHT})`)
  }

  // 5. Aspect ratio (16:9)
  const actualRatio = width / height
  const expectedRatio = 16 / 9
  if (Math.abs(actualRatio - expectedRatio) / expectedRatio > ASPECT_TOLERANCE) {
    errors.push(`aspect ratio ${actualRatio.toFixed(3)} is not 16:9 (expected ${(16/9).toFixed(3)} ± ${(ASPECT_TOLERANCE * 100).toFixed(0)}%)`)
  }

  return {
    ok: errors.length === 0,
    errors,
    width,
    height,
    sizeBytes,
    aspectRatio: actualRatio,
    isPng: true,
  }
}

// Convenience: assert or throw
export function assertValidThumbnail(filePath) {
  const result = validateThumbnail(filePath)
  if (!result.ok) {
    throw new Error(`Thumbnail validation failed: ${result.errors.join('; ')}`)
  }
  return result
}
