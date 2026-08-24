// ThumbnailCompositionPreflight — validates visual composition of rendered thumbnails.
//
// This is the missing layer between ThumbnailPolicy (dimensions/format) and
// ThumbnailJudge (scoring). It rejects objectively invalid compositions
// before the judge can score them.
//
// Detects:
//   - Embedded vertical/9:16 video inside 16:9 canvas
//   - Pillarboxing (dark side bands)
//   - Excessive empty/uniform area
//   - Text overload (too many competing layers)
//   - Unsafe text placement (too close to edges)
//
// Uses @napi-rs/canvas to analyze actual pixel data of the rendered PNG.
// Called after ThumbnailRenderer, before ThumbnailJudge.

import { loadImage } from '@napi-rs/canvas'

// Thresholds — calibrated against existing CompositionJudge data
const MAX_EMPTY_AREA_RATIO = 0.35     // >35% uniform pixels = too much dead space
const MAX_PILLARBOX_RATIO = 0.18      // >18% dark side bands = embedded vertical
const MAX_VERTICAL_CENTER_RATIO = 0.85 // center column brighter than sides by this ratio = vertical video
const MIN_TEXT_DENSITY = 0.02          // <2% text-area pixels = no visible text
const MAX_TEXT_DENSITY = 0.45          // >45% text-area pixels = text overload
const SAFE_ZONE_MARGIN = 0.04         // text within 4% of edge = unsafe placement
const MIN_EDGE_CONTRAST = 0.15        // contrast between center and edges for vertical detection

export class ThumbnailCompositionPreflight {
  /**
   * Analyze a rendered thumbnail PNG for composition validity.
   *
   * @param {string} imagePath — path to rendered thumbnail PNG
   * @param {object} context — { candidate, strategy }
   * @returns {{ pass: boolean, checks: object[], errors: string[], composition: object }}
   */
  static async validate(imagePath, context = {}) {
    const checks = []
    const errors = []
    const composition = {}

    if (!imagePath) {
      return { pass: false, checks: [], errors: ['NO_IMAGE_PATH'], composition }
    }

    let canvas, ctx, width, height
    try {
      const img = await loadImage(imagePath)
      width = img.width
      height = img.height
      // Create analysis canvas (downscale for performance)
      const { createCanvas } = await import('@napi-rs/canvas')
      const SCALE = 4
      const aw = Math.floor(width / SCALE)
      const ah = Math.floor(height / SCALE)
      canvas = createCanvas(aw, ah)
      ctx = canvas.getContext('2d')
      ctx.drawImage(img, 0, 0, aw, ah)
    } catch (e) {
      return { pass: false, checks: [{ name: 'image_load', pass: false }], errors: [`IMAGE_LOAD_FAILED: ${e.message}`], composition }
    }

    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height)
    const pixels = imageData.data
    const totalPixels = canvas.width * canvas.height

    // 1. Aspect ratio check
    const aspectRatio = width / height
    const isCorrectAspect = Math.abs(aspectRatio - 16 / 9) < 0.1
    checks.push({ name: 'aspect_ratio', pass: isCorrectAspect, detail: `${width}x${height} ratio=${aspectRatio.toFixed(3)}` })
    if (!isCorrectAspect) errors.push(`INVALID_ASPECT: ${aspectRatio.toFixed(3)} (expected ~1.778)`)

    // 2. Pillarboxing detection — compare brightness of side columns vs center
    const pillarResult = ThumbnailCompositionPreflight._detectPillarboxing(pixels, canvas.width, canvas.height)
    composition.pillarboxRatio = pillarResult.ratio
    checks.push({
      name: 'pillarboxing',
      pass: pillarResult.ratio < MAX_PILLARBOX_RATIO,
      detail: `${(pillarResult.ratio * 100).toFixed(1)}% dark side bands`,
    })
    if (pillarResult.ratio >= MAX_PILLARBOX_RATIO) {
      errors.push(`PILLARBOXING: ${(pillarResult.ratio * 100).toFixed(1)}% dark sides (max ${MAX_PILLARBOX_RATIO * 100}%)`)
    }

    // 3. Embedded vertical video detection — center column significantly brighter than sides
    const verticalResult = ThumbnailCompositionPreflight._detectEmbeddedVertical(pixels, canvas.width, canvas.height)
    composition.verticalEmbedRatio = verticalResult.ratio
    checks.push({
      name: 'embedded_vertical',
      pass: verticalResult.ratio < MAX_VERTICAL_CENTER_RATIO,
      detail: `center/sides brightness ratio=${verticalResult.ratio.toFixed(3)}`,
    })
    if (verticalResult.ratio >= MAX_VERTICAL_CENTER_RATIO) {
      errors.push(`EMBEDDED_VERTICAL: center is ${verticalResult.ratio.toFixed(2)}x brighter than sides (vertical video in 16:9)`)
    }

    // 4. Empty area detection — count near-uniform pixel regions
    const emptyResult = ThumbnailCompositionPreflight._detectEmptyArea(pixels, canvas.width, canvas.height)
    composition.emptyAreaRatio = emptyResult.ratio
    checks.push({
      name: 'empty_area',
      pass: emptyResult.ratio < MAX_EMPTY_AREA_RATIO,
      detail: `${(emptyResult.ratio * 100).toFixed(1)}% uniform area`,
    })
    if (emptyResult.ratio >= MAX_EMPTY_AREA_RATIO) {
      errors.push(`EXCESSIVE_EMPTY_AREA: ${(emptyResult.ratio * 100).toFixed(1)}% uniform (max ${MAX_EMPTY_AREA_RATIO * 100}%)`)
    }

    // 5. Text/overlay density — estimate overlay coverage from accent-colored pixels
    const textResult = ThumbnailCompositionPreflight._detectTextDensity(pixels, canvas.width, canvas.height)
    composition.textDensity = textResult.ratio
    composition.textRegions = textResult.regions
    checks.push({
      name: 'text_density',
      pass: textResult.ratio >= MIN_TEXT_DENSITY && textResult.ratio <= MAX_TEXT_DENSITY,
      detail: `${(textResult.ratio * 100).toFixed(1)}% overlay, ${textResult.regions} regions`,
    })
    if (textResult.ratio < MIN_TEXT_DENSITY) {
      errors.push(`NO_TEXT_VISIBLE: ${(textResult.ratio * 100).toFixed(1)}% overlay (min ${MIN_TEXT_DENSITY * 100}%)`)
    }
    if (textResult.ratio > MAX_TEXT_DENSITY) {
      errors.push(`TEXT_OVERLOAD: ${(textResult.ratio * 100).toFixed(1)}% overlay (max ${MAX_TEXT_DENSITY * 100}%)`)
    }

    // 6. Safe zone check — text/overlays should not touch edges
    const safeResult = ThumbnailCompositionPreflight._checkSafeZones(pixels, canvas.width, canvas.height)
    composition.safeZoneViolation = safeResult.violation
    checks.push({
      name: 'safe_zones',
      pass: !safeResult.violation,
      detail: safeResult.violation ? `edge proximity ${(safeResult.edgeRatio * 100).toFixed(1)}%` : 'clear',
    })
    if (safeResult.violation) {
      errors.push(`SAFE_ZONE_VIOLATION: ${(safeResult.edgeRatio * 100).toFixed(1)}% of content within ${SAFE_ZONE_MARGIN * 100}% of edge`)
    }

    return { pass: errors.length === 0, checks, errors, composition }
  }

  // ── Pixel analysis helpers ────────────────────────────────────────────

  /**
   * Detect pillarboxing: dark bands on left/right edges.
   * Sample left 15% and right 15% of frame, compare brightness to center.
   */
  static _detectPillarboxing(pixels, w, h) {
    const bandWidth = Math.floor(w * 0.15)
    const centerStart = Math.floor(w * 0.35)
    const centerEnd = Math.floor(w * 0.65)
    let sideTotal = 0, centerTotal = 0, sideCount = 0, centerCount = 0

    for (let y = Math.floor(h * 0.2); y < Math.floor(h * 0.8); y++) {
      // Left band
      for (let x = 0; x < bandWidth; x++) {
        const i = (y * w + x) * 4
        sideTotal += (pixels[i] + pixels[i + 1] + pixels[i + 2]) / 3
        sideCount++
      }
      // Right band
      for (let x = w - bandWidth; x < w; x++) {
        const i = (y * w + x) * 4
        sideTotal += (pixels[i] + pixels[i + 1] + pixels[i + 2]) / 3
        sideCount++
      }
      // Center
      for (let x = centerStart; x < centerEnd; x++) {
        const i = (y * w + x) * 4
        centerTotal += (pixels[i] + pixels[i + 1] + pixels[i + 2]) / 3
        centerCount++
      }
    }

    const sideAvg = sideCount > 0 ? sideTotal / sideCount : 0
    const centerAvg = centerCount > 0 ? centerTotal / centerCount : 0

    // Dark band = side average significantly darker than center
    const isDarkBand = centerAvg > 30 && sideAvg < centerAvg * 0.4
    const ratio = isDarkBand ? (1 - sideAvg / Math.max(centerAvg, 1)) : 0
    return { ratio: Math.max(0, Math.min(1, ratio)), sideAvg, centerAvg }
  }

  /**
   * Detect embedded vertical video: center column much brighter than sides.
   * This is the specific pattern from the dp8SzamyN4k case.
   */
  static _detectEmbeddedVertical(pixels, w, h) {
    const leftStrip = Math.floor(w * 0.2)
    const rightStrip = Math.floor(w * 0.8)
    const centerStart = Math.floor(w * 0.3)
    const centerEnd = Math.floor(w * 0.7)
    let sideTotal = 0, centerTotal = 0, sideCount = 0, centerCount = 0

    for (let y = Math.floor(h * 0.15); y < Math.floor(h * 0.85); y++) {
      // Left strip
      for (let x = 0; x < leftStrip; x++) {
        const i = (y * w + x) * 4
        sideTotal += (pixels[i] + pixels[i + 1] + pixels[i + 2]) / 3
        sideCount++
      }
      // Right strip
      for (let x = rightStrip; x < w; x++) {
        const i = (y * w + x) * 4
        sideTotal += (pixels[i] + pixels[i + 1] + pixels[i + 2]) / 3
        sideCount++
      }
      // Center
      for (let x = centerStart; x < centerEnd; x++) {
        const i = (y * w + x) * 4
        centerTotal += (pixels[i] + pixels[i + 1] + pixels[i + 2]) / 3
        centerCount++
      }
    }

    const sideAvg = sideCount > 0 ? sideTotal / sideCount : 0
    const centerAvg = centerCount > 0 ? centerTotal / centerCount : 0

    const ratio = sideAvg > 10 ? centerAvg / sideAvg : (centerAvg > 30 ? 10 : 1)
    return { ratio, sideAvg, centerAvg }
  }

  /**
   * Detect excessive empty/uniform area.
   * Counts pixels where all RGB channels are within a tight range of neighbors.
   */
  static _detectEmptyArea(pixels, w, h) {
    const SAMPLE_STEP = 3 // sample every 3rd pixel for performance
    let uniformCount = 0
    let totalCount = 0

    for (let y = 1; y < h - 1; y += SAMPLE_STEP) {
      for (let x = 1; x < w - 1; x += SAMPLE_STEP) {
        const i = (y * w + x) * 4
        const r = pixels[i], g = pixels[i + 1], b = pixels[i + 2]

        // Check if neighbor pixels are similar (uniform region)
        const neighbors = [
          ((y - 1) * w + x) * 4,
          ((y + 1) * w + x) * 4,
          (y * w + x - 1) * 4,
          (y * w + x + 1) * 4,
        ]
        let similar = 0
        for (const ni of neighbors) {
          const dr = Math.abs(pixels[ni] - r)
          const dg = Math.abs(pixels[ni + 1] - g)
          const db = Math.abs(pixels[ni + 2] - b)
          if (dr < 15 && dg < 15 && db < 15) similar++
        }
        if (similar >= 3) uniformCount++
        totalCount++
      }
    }

    return { ratio: totalCount > 0 ? uniformCount / totalCount : 0 }
  }

  /**
   * Detect text/overlay density by counting high-contrast accent-colored pixels.
   * Looks for bright red/accent pixels (brand bars, badges, hook text).
   */
  static _detectTextDensity(pixels, w, h) {
    const SAMPLE_STEP = 2
    let overlayCount = 0
    let totalCount = 0
    let regions = 0
    let inOverlay = false

    for (let y = 0; y < h; y += SAMPLE_STEP) {
      let rowOverlay = false
      for (let x = 0; x < w; x += SAMPLE_STEP) {
        const i = (y * w + x) * 4
        const r = pixels[i], g = pixels[i + 1], b = pixels[i + 2]

        // Detect high-saturation accent pixels (red, brand colors)
        const maxC = Math.max(r, g, b)
        const minC = Math.min(r, g, b)
        const saturation = maxC > 0 ? (maxC - minC) / maxC : 0

        // Accent color (red-dominant) or bright white text on dark bg
        const isAccent = r > 180 && g < 80 && b < 80 && saturation > 0.5
        const isBrightText = maxC > 220 && minC > 200 && saturation < 0.1
        const isBrandBar = y < h * 0.12 && maxC > 100 // top 12% with content

        if (isAccent || isBrightText || isBrandBar) {
          overlayCount++
          rowOverlay = true
        }
        totalCount++
      }
      if (rowOverlay && !inOverlay) regions++
      inOverlay = rowOverlay
    }

    return {
      ratio: totalCount > 0 ? overlayCount / totalCount : 0,
      regions,
    }
  }

  /**
   * Check safe zones — content should not be too close to edges.
   * YouTube player controls cover bottom ~15%, so text there is risky.
   */
  static _checkSafeZones(pixels, w, h) {
    const margin = Math.floor(Math.min(w, h) * SAFE_ZONE_MARGIN)
    let edgeContent = 0
    let totalEdge = 0

    // Check top margin
    for (let y = 0; y < margin; y++) {
      for (let x = 0; x < w; x += 2) {
        const i = (y * w + x) * 4
        const brightness = (pixels[i] + pixels[i + 1] + pixels[i + 2]) / 3
        if (brightness > 60) edgeContent++
        totalEdge++
      }
    }
    // Check bottom margin
    for (let y = h - margin; y < h; y++) {
      for (let x = 0; x < w; x += 2) {
        const i = (y * w + x) * 4
        const brightness = (pixels[i] + pixels[i + 1] + pixels[i + 2]) / 3
        if (brightness > 60) edgeContent++
        totalEdge++
      }
    }
    // Check left margin
    for (let y = 0; y < h; y += 2) {
      for (let x = 0; x < margin; x++) {
        const i = (y * w + x) * 4
        const brightness = (pixels[i] + pixels[i + 1] + pixels[i + 2]) / 3
        if (brightness > 60) edgeContent++
        totalEdge++
      }
    }
    // Check right margin
    for (let y = 0; y < h; y += 2) {
      for (let x = w - margin; x < w; x++) {
        const i = (y * w + x) * 4
        const brightness = (pixels[i] + pixels[i + 1] + pixels[i + 2]) / 3
        if (brightness > 60) edgeContent++
        totalEdge++
      }
    }

    const edgeRatio = totalEdge > 0 ? edgeContent / totalEdge : 0
    return { violation: edgeRatio > 0.6, edgeRatio }
  }
}
