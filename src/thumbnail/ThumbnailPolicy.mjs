// ThumbnailPolicy — deterministic rules for thumbnail production.
//
// Defines aspect ratios, minimum sizes, format constraints, and target
// dimensions for YouTube and web destinations. Every policy check is a
// pure function — no side effects, no I/O.

const TARGETS = Object.freeze({
  youtube: Object.freeze({ width: 1280, height: 720, aspectRatio: 16 / 9, format: 'png' }),
  web: Object.freeze({ width: 1280, height: 720, aspectRatio: 16 / 9, format: 'png' }),
})

const MIN_WIDTH = 640
const MIN_HEIGHT = 360
const MIN_SIZE_BYTES = 5 * 1024
const MAX_SIZE_BYTES = 10 * 1024 * 1024
const ASPECT_TOLERANCE = 0.06

export const ThumbnailPolicy = Object.freeze({
  TARGETS,

  youtube: TARGETS.youtube,
  web: TARGETS.web,

  validate(buffer, target = 'youtube') {
    const t = TARGETS[target] || TARGETS.youtube
    const errors = []

    if (!Buffer.isBuffer(buffer) || buffer.length < 24) {
      return { valid: false, errors: ['buffer too small or not a buffer'], meta: {} }
    }

    // PNG signature
    if (buffer[0] !== 0x89 || buffer[1] !== 0x50 || buffer[2] !== 0x4e || buffer[3] !== 0x47) {
      errors.push('not a valid PNG (bad header)')
    }

    const width = buffer.readUInt32BE(16)
    const height = buffer.readUInt32BE(20)
    const actualRatio = width / height
    const expectedRatio = t.aspectRatio

    if (width < MIN_WIDTH || height < MIN_HEIGHT) {
      errors.push(`resolution ${width}x${height} below minimum ${MIN_WIDTH}x${MIN_HEIGHT}`)
    }
    if (Math.abs(actualRatio - expectedRatio) / expectedRatio > ASPECT_TOLERANCE) {
      errors.push(`aspect ratio ${actualRatio.toFixed(3)} deviates from ${target} ${expectedRatio.toFixed(3)}`)
    }
    if (buffer.length < MIN_SIZE_BYTES) errors.push(`file too small: ${buffer.length} bytes`)
    if (buffer.length > MAX_SIZE_BYTES) errors.push(`file too large: ${(buffer.length / 1024 / 1024).toFixed(1)}MB`)

    return {
      valid: errors.length === 0,
      errors,
      meta: { width, height, sizeBytes: buffer.length, format: 'png', target },
    }
  },

  isYouTubeCompatible(buffer) {
    return this.validate(buffer, 'youtube').valid
  },

  isWebCompatible(buffer) {
    return this.validate(buffer, 'web').valid
  },
})
