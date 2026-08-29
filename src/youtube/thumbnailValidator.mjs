// Thumbnail validation preflight — ensures the canonical thumbnail artifact is
// a valid, upload-ready production asset before touching the YouTube API.
//
// SINGLE SOURCE OF TRUTH: the canonical geometry comes from ThumbnailProfile
// (SHORT = 2160x3840 9:16 — the production default; VIDEO = 3840x2160 16:9).
// This validator mirrors enforceThumbnailProfile, NOT the legacy 16:9-only
// desktop contract. A Short thumbnail MUST match 2160x3840 exactly.
//
// Checks:
//   1. File exists
//   2. Readable
//   3. Valid PNG signature
//   4. Exact canonical dimensions (2160x3840 for short / 3840x2160 for video)
//   5. File size within bounds
//
// Returns { ok, errors[], width, height, sizeBytes, aspectRatio }

import { existsSync, readFileSync, statSync } from 'node:fs'

import { ThumbnailProfile, MAX_THUMBNAIL_BYTES } from '../thumbnail/ThumbnailProfile.mjs'

const MIN_SIZE_BYTES = 5 * 1024 // 5 KB

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

/**
 * Validate a thumbnail against the canonical profile.
 * @param {string} filePath
 * @param {object} [opts] - { mediaType: 'short'|'video' } selects the profile.
 */
export function validateThumbnail(filePath, opts = {}) {
  const profile = opts.mediaType === 'video' ? ThumbnailProfile.VIDEO : ThumbnailProfile.SHORT
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
    if (sizeBytes > MAX_THUMBNAIL_BYTES) errors.push(`file too large: ${(sizeBytes / 1024 / 1024).toFixed(1)}MB (max ${(MAX_THUMBNAIL_BYTES / 1024 / 1024).toFixed(0)}MB)`)
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

  // 4. Exact canonical geometry.
  if (width !== profile.width || height !== profile.height) {
    errors.push(`dimensions ${width}x${height} do not match canonical ${profile.mediaType} profile ${profile.width}x${profile.height} (${profile.aspectRatio})`)
  }

  return {
    ok: errors.length === 0,
    errors,
    width,
    height,
    sizeBytes,
    aspectRatio: width && height ? width / height : null,
    isPng: true,
  }
}

// Convenience: assert or throw
export function assertValidThumbnail(filePath, opts) {
  const result = validateThumbnail(filePath, opts)
  if (!result.ok) {
    throw new Error(`Thumbnail validation failed: ${result.errors.join('; ')}`)
  }
  return result
}
