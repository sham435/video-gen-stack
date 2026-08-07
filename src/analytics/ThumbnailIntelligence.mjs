// ThumbnailIntelligence — Milestone C: learn which thumbnail styles, colors
// and headline patterns actually drive CTR.
//
// The learning loop:
//   1. A video is uploaded with its cover.png as the custom thumbnail
//      (run-batch / engine cover stage).
//   2. The daily job (scripts/update-image-performance.mjs) fetches the
//      video's impressions + CTR, hashes the cover file, extracts its accent
//      color family, and records a sample into thumbnail_performance.
//   3. Rollups (styles / colorFamilies) aggregate CTR by attribute, weighted
//      by impressions, gated by sample count + impression floor.
//   4. Generation feedback: styleOrder() reorders the tournament styles by
//      learned CTR, tuneBrief() nudges the accent color. Both return null /
//      no-op on cold start — rendering stays byte-identical to before.

import { createHash } from 'node:crypto'
import fs from 'node:fs'
import { createCanvas, loadImage } from '@napi-rs/canvas'
import { ImagePerformanceMemory } from './ImagePerformanceMemory.mjs'
import { patternKey } from '../ai/thumbnail/ThumbnailBrandOptimizer.mjs'

// Representative hex per accent family — used by tuneBrief when a family
// has proven CTR above the channel baseline.
export const FAMILY_HEX = {
  red: '#E10600',
  amber: '#F59E0B',
  yellow: '#FACC15',
  green: '#16A34A',
  cyan: '#06B6D4',
  blue: '#2563EB',
  purple: '#7C3AED',
  white: '#F8FAFC',
  gray: '#6B7280',
  none: null,
}

// Deterministic hue-based family classification for a hex color.
export function colorFamily(hex) {
  const m = /^#?([0-9a-fA-F]{6})$/.exec(String(hex || '').trim())
  if (!m) return 'none'
  const [r, g, b] = [0, 2, 4].map(i => parseInt(m[1].slice(i, i + 2), 16))
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const d = max - min
  if (d < 25) return (max + min) / 2 > 200 ? 'white' : 'gray'
  let hue = d ? (max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4) * 60 : 0
  if (hue < 0) hue += 360
  if (hue < 15 || hue >= 345) return 'red'
  if (hue < 45) return 'amber'
  if (hue < 70) return 'yellow'
  if (hue < 160) return 'green'
  if (hue < 200) return 'cyan'
  if (hue < 260) return 'blue'
  if (hue < 330) return 'purple'
  return 'red'
}

export class ThumbnailIntelligence {
  constructor({ memory = null } = {}) {
    this.memory = memory || new ImagePerformanceMemory()
  }

  close() { this.memory.close() }

  // ------------------------------------------------------------------
  // Fingerprinting
  // ------------------------------------------------------------------

  /** sha256 of the cover file — the stable thumbnail identity. */
  fileHash(coverPath) {
    try {
      return createHash('sha256').update(fs.readFileSync(coverPath)).digest('hex')
    } catch { return null }
  }

  /**
   * Sample the accent family from a rendered cover: the composer always
   * paints an 8px accent bar across the top, plus accent headline text —
   * sample the top bar row deterministically.
   */
  async accentFamily(coverPath) {
    try {
      const img = await loadImage(coverPath)
      const canvas = createCanvas(480, 8)
      const ctx = canvas.getContext('2d')
      const w = Math.min(480, img.width)
      const h = Math.min(8, img.height)
      canvas.width = w
      canvas.height = h
      ctx.drawImage(img, 0, 0, w, h)
      const data = ctx.getImageData(0, 0, w, h).data
      // collect the most saturated pixel row (accent bar is pure color)
      let best = null
      let bestSat = -1
      for (let i = 0; i < data.length; i += 4) {
        const r = data[i], g = data[i + 1], b = data[i + 2]
        const max = Math.max(r, g, b), min = Math.min(r, g, b)
        const sat = max === 0 ? 0 : (max - min) / max
        if (sat > bestSat) { bestSat = sat; best = [r, g, b] }
      }
      if (!best || bestSat < 0.15) return null
      const hex = '#' + best.map(v => v.toString(16).padStart(2, '0')).join('')
      return colorFamily(hex)
    } catch { return null }
  }

  // ------------------------------------------------------------------
  // Learning
  // ------------------------------------------------------------------

  /**
   * Record one video's thumbnail sample. metrics = AnalyticsCollector output
   * (needs ctr + impressions). coverPath hashed for identity; style passed by
   * the caller (batch metadata); dominant_color sampled from the image.
   */
  async learn(metrics, coverPath, { style = null, entity = null, headline = null, features = null } = {}) {
    if (!metrics?.videoId || metrics.ctr == null) return null
    const thumbnailHash = coverPath ? this.fileHash(coverPath) : `thumb-${metrics.videoId}`
    const dominantColor = coverPath ? await this.accentFamily(coverPath) : null
    this.memory.recordThumbnail(thumbnailHash, {
      ctr: metrics.ctr,
      impressions: metrics.impressions ?? 0,
      entity: entity || null,
      style: style || null,
      dominantColor,
      headlineStyle: headline ? patternKey(headline) : null,
      features: features || null,
    })
    return { thumbnailHash, style, dominantColor, ctr: metrics.ctr, impressions: metrics.impressions ?? 0 }
  }

  // ------------------------------------------------------------------
  // Rollups — learned attribute performance
  // ------------------------------------------------------------------

  /** Per-style CTR rollup, impressions-weighted, gated. Sorted best first. */
  styles(minSamples = 2, minImpressions = 300) {
    return this._rollup('style', minSamples, minImpressions)
  }

  /** Per-accent-family CTR rollup, gated. Sorted best first. */
  colorFamilies(minSamples = 2, minImpressions = 300) {
    return this._rollup('dominant_color', minSamples, minImpressions, 'family')
  }

  /** Per-headline-pattern CTR rollup, gated. Sorted best first. */
  headlinePatterns(minSamples = 2, minImpressions = 300) {
    return this._rollup('headline_style', minSamples, minImpressions, 'pattern')
  }

  _rollup(column, minSamples, minImpressions, keyName = column) {
    const rows = this.memory.db.db
      .prepare(`SELECT ${column} AS k, COUNT(*) AS n, SUM(impressions) AS imp, AVG(ctr) AS ctr FROM thumbnail_performance WHERE ${column} IS NOT NULL GROUP BY ${column}`)
      .all()
    const totalImp = rows.reduce((a, r) => a + (r.imp || 0), 0)
    const baseline = totalImp ? rows.reduce((a, r) => a + (r.ctr || 0) * (r.imp || 0), 0) / totalImp : 0
    const out = rows
      .filter(r => r.n >= minSamples && r.imp >= minImpressions && r.ctr != null)
      .map(r => ({
        [keyName]: r.k,
        ctr: +r.ctr.toFixed(2),
        impressions: r.imp,
        samples: r.n,
        lift: +(r.ctr - baseline).toFixed(2),
      }))
      .sort((a, b) => b.ctr - a.ctr || b.samples - a.samples || String(a[keyName]).localeCompare(String(b[keyName])))
    return out
  }

  /** Channel-wide CTR baseline across all thumbnail samples. */
  baseline() {
    const r = this.memory.db.db.prepare('SELECT SUM(impressions) imp, SUM(ctr * impressions) weighted FROM thumbnail_performance WHERE ctr IS NOT NULL').get()
    return r?.imp ? +((r.weighted || 0) / r.imp).toFixed(2) : null
  }

  // ------------------------------------------------------------------
  // Generation feedback — cold start is a strict no-op
  // ------------------------------------------------------------------

  /**
   * Tournament style order from learned CTR. Returns null on cold start or
   * when the learned gap is too small to be meaningful → caller keeps the
   * original order (byte-identical behavior).
   */
  styleOrder(originalStyles) {
    const learned = this.styles()
    if (!learned?.length || learned.length < 2) return null
    if (learned[1] && learned[0].ctr - learned[1].ctr < 0.5) return null
    const known = new Set(learned.map(s => s.style))
    return [
      ...learned.map(s => s.style),
      ...originalStyles.filter(s => !known.has(s)),
    ]
  }

  /**
   * Nudge a cover brief's accent color toward the best-learned family.
   * Returns the SAME brief (no mutation, no change) on cold start or when
   * the current family already leads.
   */
  tuneBrief(brief) {
    if (!brief?.accent_color) return brief
    const families = this.colorFamilies()
    if (!families?.length) return brief
    const current = colorFamily(brief.accent_color)
    const best = families[0]
    const base = this.baseline()
    if (base == null) return brief
    // Only override when: learned family beats baseline, current family
    // trails it, and the gap is meaningful (>1pp CTR or >2x samples).
    const currentRow = families.find(f => f.family === current)
    if (best.family === current || (currentRow && currentRow.ctr >= best.ctr - 0.5)) return brief
    if (best.ctr <= base) return brief
    if (!FAMILY_HEX[best.family]) return brief
    return {
      ...brief,
      accent_color: FAMILY_HEX[best.family],
      _thumbnailLearning: { family: best.family, ctr: best.ctr, lift: best.lift, samples: best.samples },
    }
  }
}
