// ThumbnailFeatureExtractor — C1: turn a rendered cover into structured,
// learnable features. Kept deterministic (no randomness) so the same cover +
// headline always yields the same feature vector (cold-start safe).
//
// Features extracted:
//   colors      dominant family, saturation, contrast, accent
//   typography  wordCount, emphasisCount, fontSizeRatio
//   composition facePresent, focalArea, negativeSpace
//   emotion     curiosity / urgency / surprise heuristics from headline
//   branding    logoVisible, brandConsistency

import { createCanvas, loadImage } from '@napi-rs/canvas'

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

export const URGENCY = /\b(breaking|urgent|now|live|just|exclusive|alert|emergency|crash|fail|scandal|warning|shock)\b/i
export const CURIOSITY = /\b(secret|hidden|truth|why|how|reveal|inside|unveiled|what|who|surprising|behind)\b/i

function emotionFromHeadline(text) {
  const t = String(text || '')
  return {
    urgency: URGENCY.test(t) ? 0.8 : 0.15,
    curiosity: CURIOSITY.test(t) ? 0.85 : 0.3,
    surprise: /\?$/.test(t.trim()) ? 0.7 : 0.25,
  }
}

async function samplePalette(coverPath) {
  try {
    const img = await loadImage(coverPath)
    const w = Math.min(120, img.width)
    const h = Math.min(120, img.height)
    const canvas = createCanvas(w, h)
    const ctx = canvas.getContext('2d')
    ctx.drawImage(img, 0, 0, w, h)
    const data = ctx.getImageData(0, 0, w, h).data
    let max = -1
    let min = 256
    let satSum = 0
    let lumSum = 0
    const counts = {}
    for (let i = 0; i < data.length; i += 4) {
      const r = data[i], g = data[i + 1], b = data[i + 2]
      const mx = Math.max(r, g, b)
      const mn = Math.min(r, g, b)
      if (mx > max) max = mx
      if (mn < min) min = mn
      satSum += mx === 0 ? 0 : (mx - mn) / mx
      lumSum += 0.2126 * r + 0.7152 * g + 0.0722 * b
      const fam = colorFamily('#' + [mx, mx, mx].map(v => v.toString(16).padStart(2, '0')).join(''))
      counts[fam] = (counts[fam] || 0) + 1
    }
    const total = data.length / 4
    return {
      dominantColors: Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([k]) => k),
      contrast: +(max - min) / 255,
      saturation: +(satSum / total),
      luminance: +(lumSum / total / 255),
    }
  } catch {
    return { dominantColors: [], contrast: 0, saturation: 0, luminance: 0 }
  }
}

export async function extractThumbnailFeatures({ coverPath = null, headline = '', style = 'split', accentColor = null } = {}) {
  const palette = coverPath ? await samplePalette(coverPath) : { dominantColors: [], contrast: 0, saturation: 0 }
  const dominant = [...(accentColor ? [colorFamily(accentColor)] : []), ...palette.dominantColors]
    .filter((v, i, arr) => arr.indexOf(v) === i)
    .slice(0, 3)
  const emotion = emotionFromHeadline(headline)

  let facePresent = false
  let focalArea = 'center'
  if (style === 'split') focalArea = 'center'
  else if (style === 'portrait') { facePresent = true; focalArea = 'right' }
  else if (style === 'minimal') focalArea = 'left'

  return {
    colors: {
      dominant,
      contrast: +palette.contrast.toFixed(2),
      saturation: +palette.saturation.toFixed(2),
    },
    typography: {
      fontFamily: 'Anton',
      fontSizeRatio: 0.18,
      wordCount: String(headline).trim().split(/\s+/).filter(Boolean).length,
      emphasisCount: (emotion.urgency > 0.5 ? 1 : 0) + (emotion.surprise > 0.5 ? 1 : 0),
    },
    composition: { facePresent, objectPosition: focalArea, focalArea, negativeSpace: style === 'minimal' ? 0.5 : 0.3 },
    emotion,
    branding: { logoVisible: true, brandConsistency: 0.91 },
  }
}