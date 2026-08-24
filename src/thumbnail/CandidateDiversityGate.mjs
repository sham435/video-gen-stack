// CandidateDiversityGate — ensures thumbnail candidates are visually distinct.
//
// After ThumbnailCompositionPreflight rejects invalid compositions, this gate
// rejects visually near-duplicate candidates. Five candidates that all look
// the same (same crop, same focal point, same text position) provide zero
// diversity — this gate catches that.
//
// Pipeline position:
//   ThumbnailCompositionPreflight → CandidateDiversityGate → ThumbnailJudge
//
// Signals used:
//   - Perceptual hash (downscaled pixel grid)
//   - Layout signature (region brightness distribution)
//   - Dominant color palette
//   - Text region overlap
//
// Thresholds: candidates with similarity > MAX_SIMILARITY are rejected.

import { loadImage } from '@napi-rs/canvas'
import crypto from 'node:crypto'

const MAX_SIMILARITY = 0.82     // two candidates more similar than this → reject the lower-scoring one
const MIN_DIVERSE_SET = 2       // after diversity filtering, need at least this many candidates
const HASH_GRID = 8             // 8x8 perceptual hash grid
const LAYOUT_GRID = 4           // 4x4 layout signature grid

export class CandidateDiversityGate {
  /**
   * Filter rendered candidates for visual diversity.
   *
   * @param {Array} candidates — rendered candidates with paths
   * @param {object} opts — { maxSimilarity, minDiverseSet }
   * @returns {{ diverse: Array, rejected: Array, pairs: Array }}
   */
  static async filter(candidates, opts = {}) {
    const maxSim = opts.maxSimilarity ?? MAX_SIMILARITY
    const minSet = opts.minDiverseSet ?? MIN_DIVERSE_SET
    const rendered = candidates.filter(c => c.rendered && c.path && c.eligible !== false)
    if (rendered.length <= 1) return { diverse: rendered, rejected: [], pairs: [] }

    // Compute signatures for all candidates
    const sigs = []
    for (const c of rendered) {
      try {
        const sig = await CandidateDiversityGate.computeSignature(c.path)
        sigs.push({ candidate: c, signature: sig })
      } catch {
        // Analysis failure — keep candidate (let judge decide)
        sigs.push({ candidate: c, signature: null })
      }
    }

    // Pairwise similarity comparison
    const pairs = []
    const rejected = new Set()

    for (let i = 0; i < sigs.length; i++) {
      for (let j = i + 1; j < sigs.length; j++) {
        const a = sigs[i], b = sigs[j]
        if (!a.signature || !b.signature) continue

        const similarity = CandidateDiversityGate.computeSimilarity(a.signature, b.signature)
        pairs.push({
          a: a.candidate.strategy,
          b: b.candidate.strategy,
          similarity: Number(similarity.toFixed(4)),
        })

        if (similarity > maxSim) {
          // Reject the lower-scoring candidate
          const loser = (a.candidate.compositeScore || 0) >= (b.candidate.compositeScore || 0)
            ? b.candidate : a.candidate
          rejected.add(loser.strategy)
          console.log(`[THUMB-DIV] ${loser.strategy}: REJECTED — similarity ${similarity.toFixed(3)} > ${maxSim}`)
        }
      }
    }

    const diverse = sigs
      .filter(s => !rejected.has(s.candidate.strategy))
      .map(s => s.candidate)

    // If diversity filtering left too few candidates, relax and keep all
    if (diverse.length < minSet) {
      return { diverse: rendered, rejected: [], pairs, relaxed: true }
    }

    return {
      diverse,
      rejected: [...rejected],
      pairs,
    }
  }

  /**
   * Compute a multi-signal signature for a thumbnail image.
   *
   * @param {string} imagePath — path to rendered thumbnail PNG
   * @returns {object} — { perceptualHash, layoutSignature, colorPalette, textRegions }
   */
  static async computeSignature(imagePath) {
    const img = await loadImage(imagePath)
    const { createCanvas } = await import('@napi-rs/canvas')

    // Downscale to analysis grid
    const aw = HASH_GRID * 4
    const ah = Math.floor(aw * (img.height / img.width))
    const canvas = createCanvas(aw, ah)
    const ctx = canvas.getContext('2d')
    ctx.drawImage(img, 0, 0, aw, ah)
    const imageData = ctx.getImageData(0, 0, aw, ah)
    const pixels = imageData.data

    const perceptualHash = CandidateDiversityGate._computePerceptualHash(pixels, aw, ah)
    const layoutSignature = CandidateDiversityGate._computeLayoutSignature(pixels, aw, ah)
    const colorPalette = CandidateDiversityGate._computeColorPalette(pixels, aw, ah)
    const textRegions = CandidateDiversityGate._computeTextRegions(pixels, aw, ah)

    return { perceptualHash, layoutSignature, colorPalette, textRegions }
  }

  /**
   * Compute similarity between two signatures. Returns 0 (identical) to 1 (completely different).
   */
  static computeSimilarity(sigA, sigB) {
    const weights = { perceptual: 0.35, layout: 0.30, color: 0.20, text: 0.15 }
    let total = 0

    // Perceptual hash hamming distance
    if (sigA.perceptualHash && sigB.perceptualHash) {
      total += weights.perceptual * CandidateDiversityGate._hammingDistance(sigA.perceptualHash, sigB.perceptualHash)
    }

    // Layout signature euclidean distance (normalized)
    if (sigA.layoutSignature && sigB.layoutSignature) {
      total += weights.layout * CandidateDiversityGate._layoutDistance(sigA.layoutSignature, sigB.layoutSignature)
    }

    // Color palette overlap
    if (sigA.colorPalette && sigB.colorPalette) {
      total += weights.color * CandidateDiversityGate._paletteDistance(sigA.colorPalette, sigB.colorPalette)
    }

    // Text region overlap
    if (sigA.textRegions && sigB.textRegions) {
      total += weights.text * CandidateDiversityGate._textOverlap(sigA.textRegions, sigB.textRegions)
    }

    return Math.min(1, Math.max(0, total))
  }

  // ── Signature computation helpers ─────────────────────────────────────

  /**
   * Perceptual hash: downscale to HASH_GRID×HASH_GRID, threshold against
   * mean brightness, return binary string.
   */
  static _computePerceptualHash(pixels, w, h) {
    const values = []
    const cellW = Math.floor(w / HASH_GRID)
    const cellH = Math.floor(h / HASH_GRID)

    for (let gy = 0; gy < HASH_GRID; gy++) {
      for (let gx = 0; gx < HASH_GRID; gx++) {
        let sum = 0, count = 0
        for (let y = gy * cellH; y < (gy + 1) * cellH && y < h; y++) {
          for (let x = gx * cellW; x < (gx + 1) * cellW && x < w; x++) {
            const i = (y * w + x) * 4
            sum += (pixels[i] + pixels[i + 1] + pixels[i + 2]) / 3
            count++
          }
        }
        values.push(count > 0 ? sum / count : 0)
      }
    }

    const mean = values.reduce((a, b) => a + b, 0) / values.length
    return values.map(v => v > mean ? '1' : '0').join('')
  }

  /**
   * Layout signature: brightness distribution across a 4×4 grid.
   * Returns normalized array of 16 brightness values.
   */
  static _computeLayoutSignature(pixels, w, h) {
    const cellW = Math.floor(w / LAYOUT_GRID)
    const cellH = Math.floor(h / LAYOUT_GRID)
    const values = []

    for (let gy = 0; gy < LAYOUT_GRID; gy++) {
      for (let gx = 0; gx < LAYOUT_GRID; gx++) {
        let sum = 0, count = 0
        for (let y = gy * cellH; y < (gy + 1) * cellH && y < h; y++) {
          for (let x = gx * cellW; x < (gx + 1) * cellW && x < w; x++) {
            const i = (y * w + x) * 4
            sum += (pixels[i] + pixels[i + 1] + pixels[i + 2]) / 3
            count++
          }
        }
        values.push(count > 0 ? sum / count / 255 : 0)
      }
    }
    return values
  }

  /**
   * Dominant color palette: quantize to 8 buckets, return normalized histogram.
   */
  static _computeColorPalette(pixels, w, h) {
    const buckets = new Array(8).fill(0)
    const total = w * h

    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = (y * w + x) * 4
        const r = pixels[i], g = pixels[i + 1], b = pixels[i + 2]
        // Map to 8 buckets: red, orange, yellow, green, cyan, blue, purple, gray
        const maxC = Math.max(r, g, b)
        const minC = Math.min(r, g, b)
        const sat = maxC > 0 ? (maxC - minC) / maxC : 0
        const hue = CandidateDiversityGate._getHue(r, g, b)

        if (sat < 0.15) {
          buckets[7]++ // gray/achromatic
        } else if (hue < 30 || hue >= 330) {
          buckets[0]++ // red
        } else if (hue < 60) {
          buckets[1]++ // orange
        } else if (hue < 90) {
          buckets[2]++ // yellow
        } else if (hue < 150) {
          buckets[3]++ // green
        } else if (hue < 195) {
          buckets[4]++ // cyan
        } else if (hue < 270) {
          buckets[5]++ // blue
        } else {
          buckets[6]++ // purple
        }
      }
    }

    return buckets.map(b => b / total)
  }

  static _getHue(r, g, b) {
    const max = Math.max(r, g, b)
    const min = Math.min(r, g, b)
    const d = max - min
    if (d === 0) return 0
    let h
    if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6
    else if (max === g) h = ((b - r) / d + 2) / 6
    else h = ((r - g) / d + 4) / 6
    return h * 360
  }

  /**
   * Text regions: detect high-contrast overlay areas, return bounding boxes.
   * Simplified — returns region centers + areas.
   */
  static _computeTextRegions(pixels, w, h) {
    const regions = []
    const cellW = Math.floor(w / 4)
    const cellH = Math.floor(h / 4)

    for (let gy = 0; gy < 4; gy++) {
      for (let gx = 0; gx < 4; gx++) {
        let brightCount = 0
        let totalCount = 0
        for (let y = gy * cellH; y < (gy + 1) * cellH && y < h; y++) {
          for (let x = gx * cellW; x < (gx + 1) * cellW && x < w; x++) {
            const i = (y * w + x) * 4
            const maxC = Math.max(pixels[i], pixels[i + 1], pixels[i + 2])
            if (maxC > 200) brightCount++
            totalCount++
          }
        }
        const ratio = totalCount > 0 ? brightCount / totalCount : 0
        if (ratio > 0.3) {
          regions.push({
            x: gx / 4,
            y: gy / 4,
            w: 0.25,
            h: 0.25,
            density: ratio,
          })
        }
      }
    }
    return regions
  }

  // ── Similarity computation helpers ────────────────────────────────────

  static _hammingDistance(hashA, hashB) {
    if (hashA.length !== hashB.length) return 1
    let diff = 0
    for (let i = 0; i < hashA.length; i++) {
      if (hashA[i] !== hashB[i]) diff++
    }
    return diff / hashA.length
  }

  static _layoutDistance(sigA, sigB) {
    if (!sigA?.length || !sigB?.length || sigA.length !== sigB.length) return 1
    let sum = 0
    for (let i = 0; i < sigA.length; i++) {
      sum += (sigA[i] - sigB[i]) ** 2
    }
    return Math.min(1, Math.sqrt(sum / sigA.length) * 2)
  }

  static _paletteDistance(palA, palB) {
    if (!palA?.length || !palB?.length || palA.length !== palB.length) return 1
    let sum = 0
    for (let i = 0; i < palA.length; i++) {
      sum += (palA[i] - palB[i]) ** 2
    }
    return Math.min(1, Math.sqrt(sum / palA.length) * 3)
  }

  static _textOverlap(regionsA, regionsB) {
    if (!regionsA?.length || !regionsB?.length) return 0
    let overlap = 0
    let total = 0

    for (const a of regionsA) {
      for (const b of regionsB) {
        if (a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y) {
          overlap += Math.min(a.density, b.density)
        }
        total += Math.max(a.density, b.density)
      }
    }

    return total > 0 ? 1 - overlap / total : 0
  }
}
