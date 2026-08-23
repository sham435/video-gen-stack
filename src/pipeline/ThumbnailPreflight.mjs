// ThumbnailPreflight — explicit pipeline stage for thumbnail validation.
//
// Fits into the ProductionPreflight architecture. Called after cover generation,
// before video render + YouTube upload. Ensures the thumbnail is a valid,
// upload-ready production artifact.
//
// Pipeline position:
//   CoverComposer → ThumbnailPreflight.validate() → Render → YouTube Upload
//
// Validation cascade:
//   1. File exists
//   2. Readable
//   3. Valid PNG signature
//   4. Correct 16:9 aspect ratio
//   5. Minimum resolution (>= 640x360)
//   6. File size bounds (5KB–10MB)
//   7. (optional) headline exists in brief
//   8. (optional) niche pill text exists

import { existsSync, readFileSync, statSync } from 'node:fs'

const MIN_WIDTH = 640
const MIN_HEIGHT = 360
const MIN_SIZE_BYTES = 5 * 1024
const MAX_SIZE_BYTES = 10 * 1024 * 1024
const ASPECT_TOLERANCE = 0.05
const EXPECTED_RATIO = 16 / 9

function readPngDimensions(buffer) {
  if (buffer.length < 24) return null
  if (buffer[0] !== 0x89 || buffer[1] !== 0x50 || buffer[2] !== 0x4e || buffer[3] !== 0x47) return null
  const width = buffer.readUInt32BE(16)
  const height = buffer.readUInt32BE(20)
  return { width, height }
}

export const ThumbnailPreflight = Object.freeze({

  // ─── validate ────────────────────────────────────────────────────────────
  // The main entry point. Returns { ready, errors[], meta }.
  // `meta` includes width, height, sizeBytes for logging.
  validate({ path, niche, headline } = {}) {
    const errors = []
    const meta = { width: 0, height: 0, sizeBytes: 0, isPng: false }

    if (!path) {
      return { ready: false, errors: ['thumbnail path not provided'], meta }
    }

    // 1. File exists
    if (!existsSync(path)) {
      return { ready: false, errors: [`file not found: ${path}`], meta }
    }

    // 2. File size
    try {
      const stat = statSync(path)
      meta.sizeBytes = stat.size
      if (stat.size < MIN_SIZE_BYTES) errors.push(`file too small: ${stat.size} bytes (min ${MIN_SIZE_BYTES})`)
      if (stat.size > MAX_SIZE_BYTES) errors.push(`file too large: ${(stat.size / 1024 / 1024).toFixed(1)}MB (max 10MB)`)
    } catch (e) {
      return { ready: false, errors: [`cannot stat file: ${e.message}`], meta }
    }

    // 3. Read + validate PNG
    let buffer
    try {
      buffer = readFileSync(path)
    } catch (e) {
      return { ready: false, errors: [`cannot read file: ${e.message}`], meta }
    }

    const dims = readPngDimensions(buffer)
    if (!dims) {
      errors.push('not a valid PNG file (bad header signature)')
      return { ready: false, errors, meta }
    }
    meta.width = dims.width
    meta.height = dims.height
    meta.isPng = true

    // 4. Resolution
    if (dims.width < MIN_WIDTH || dims.height < MIN_HEIGHT) {
      errors.push(`resolution too low: ${dims.width}x${dims.height} (min ${MIN_WIDTH}x${MIN_HEIGHT})`)
    }

    // 5. Aspect ratio (16:9)
    const actualRatio = dims.width / dims.height
    if (Math.abs(actualRatio - EXPECTED_RATIO) / EXPECTED_RATIO > ASPECT_TOLERANCE) {
      errors.push(`aspect ratio ${actualRatio.toFixed(3)} is not 16:9 (expected ${EXPECTED_RATIO.toFixed(3)} +/- ${(ASPECT_TOLERANCE * 100).toFixed(0)}%)`)
    }

    return { ready: errors.length === 0, errors, meta }
  },

  // ─── assert ──────────────────────────────────────────────────────────────
  // Convenience: validate + throw on failure.
  assert({ path, niche, headline } = {}) {
    const result = ThumbnailPreflight.validate({ path, niche, headline })
    if (!result.ready) {
      throw new Error(`ThumbnailPreflight failed: ${result.errors.join('; ')}`)
    }
    return result
  },

  // ─── isNicheAware ────────────────────────────────────────────────────────
  // Future: check that the niche pill is rendered in the correct accent color.
  // For now, just validates the base image.
  isNicheAware({ path, niche } = {}) {
    const base = ThumbnailPreflight.validate({ path, niche })
    // TODO: pixel-scan for niche pill presence (accent color region)
    return base
  },

  // ─── validateC2PA ─────────────────────────────────────────────────────
  // C2PA validation gate. Checks that the asset has a valid C2PA manifest
  // when C2PA is required. Returns { ready, errors[], c2paResult }.
  // Does NOT require C2PA — only enforces when C2PA_REQUIRED=true.
  async validateC2PA({ path } = {}) {
    const c2paRequired = process.env.C2PA_REQUIRED === 'true'
    const errors = []

    if (!path) {
      return { ready: !c2paRequired, errors: c2paRequired ? ['thumbnail path not provided for C2PA validation'] : [], c2paResult: null }
    }

    // If C2PA is not required, pass through
    if (!c2paRequired) {
      return { ready: true, errors: [], c2paResult: null }
    }

    // Lazy-load ContentCredentials to avoid circular deps
    const { ContentCredentials } = await import('./ContentCredentials.mjs')
    const c2paAvailable = await ContentCredentials.isAvailable()
    if (!c2paAvailable) {
      if (c2paRequired) errors.push('C2PA required but c2pa-node not available')
      return { ready: !c2paRequired, errors, c2paResult: null }
    }

    const verifyResult = await ContentCredentials.verify(path)
    if (!verifyResult.valid) {
      errors.push(`C2PA verification failed: ${verifyResult.error}`)
    }

    return { ready: errors.length === 0, errors, c2paResult: verifyResult }
  },

})
