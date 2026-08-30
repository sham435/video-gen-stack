import { execFileSync } from 'child_process'
import fs from 'fs'
import { SafeZoneManager } from '../layout/SafeZoneManager.mjs'

// Frame Vision Analyzer — post-render visual composition scoring.
//
// Extracts one frame per scene from the rendered video (ffmpeg rawvideo,
// no native deps) and scores pixel-level production quality:
//   text_collision  → geometry from the text manifest + safe zones
//   contrast        → luminance variance in the text bands (legibility)
//   safe_margin     → text bleed past the headline/caption zones
//   face_visibility → subject-band visual detail (presence proxy; no ML)
//   blank_frame     → near-zero luminance frame
//
// Resolution-agnostic: the actual video width/height are probed via ffprobe
// and all zones are computed as FRACTIONS of W/H that mirror the renderer's
// anchors (headline H*0.62, captions H*0.78, fact headline H*0.30), so the
// same checks work for 9:16 Shorts (1920x1080 landscape VIDEO_HD) and behave
// correctly across profiles.
const SAMPLE_STEP = 4 // analyze every 4th pixel

// Scene-type text presets — FRACTIONAL bands (of W/H) mirroring the renderer.
//   hook:        headline band at H*0.62 + captions at H*0.78
//   fact:        headline card centered at H*0.30 + captions
//   explanation: "WHY IT MATTERS" header near top + body + captions
//   reaction/reveal: captions only
//   retention/brand_close: center text at H*0.50 + captions
const RATIO = {
  headline: { x: 0, y: 0.62, w: 1, h: 0.14 },    // hook headline band
  caption: { x: 0, y: 0.78, w: 1, h: 0.16 },     // word-caption band
  factHead: { x: 0, y: 0.30, w: 1, h: 0.22 },    // fact headline card
  explainHead: { x: 0, y: 0.15, w: 1, h: 0.14 }, // "WHY IT MATTERS"
  centerText: { x: 0, y: 0.50, w: 1, h: 0.20 },  // centered CTA / brand
  subject: { x: 0.18, y: 0.16, w: 0.63, h: 0.36 }, // face/object band (no text)
  // Bleed check: the band immediately below captions (above the footer).
  bleed: { x: 0.18, y: 0.94, w: 0.63, h: 0.03 },
}

function bandFor(buf, W, H, b) {
  return { x: b.x * W, y: b.y * H, width: b.w * W, height: b.h * H }
}

export class FrameVisionAnalyzer {
  constructor(options = {}) {
    this.threshold = options.threshold || 85
    this.sampleStep = options.sampleStep || SAMPLE_STEP
    this.W = options.width || 1080
    this.H = options.height || 1920
  }

  _probeDims(videoPath) {
    try {
      const info = execFileSync(
        'ffprobe',
        ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height', '-of', 'default=noprint_wrappers=1', videoPath]
      ).toString().trim()
      const w = parseInt(info.match(/width=(\d+)/)?.[1] || '0')
      const h = parseInt(info.match(/height=(\d+)/)?.[1] || '0')
      if (w && h) { this.W = w; this.H = h }
    } catch {}
  }

  _extractFrame(videoPath, seconds) {
    if (!fs.existsSync(videoPath)) throw new Error('video not found')
    const out = execFileSync(
      'ffmpeg',
      ['-v', 'error', '-ss', String(seconds), '-i', videoPath, '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgb24', 'pipe:1'],
      { timeout: 20000, maxBuffer: 64 * 1024 * 1024 }
    )
    return Buffer.from(out)
  }

  _lum(buf, i) {
    const r = buf[i], g = buf[i + 1], b = buf[i + 2]
    return 0.299 * r + 0.587 * g + 0.114 * b
  }

  // Sampled stats (mean, stddev, high-contrast ratio) over a rect region
  _regionStats(buf, rect, step = this.sampleStep) {
    const W = this.W, H = this.H
    let n = 0, sum = 0, sumSq = 0, hi = 0
    const values = []
    for (let y = rect.y; y < rect.y + rect.height && y < H; y += step) {
      for (let x = rect.x; x < rect.x + rect.width && x < W; x += step) {
        const i = (y * W + x) * 3
        const l = this._lum(buf, i)
        sum += l; sumSq += l * l; values.push(l); n++
      }
    }
    if (n === 0) return { mean: 0, stddev: 0, hiRatio: 0 }
    const mean = sum / n
    const stddev = Math.sqrt(Math.max(0, sumSq / n - mean * mean))
    hi = values.filter(v => Math.abs(v - mean) > 45).length
    return { mean: Math.round(mean), stddev: Math.round(stddev), hiRatio: (hi / n) * 100 }
  }

  _frameChecks(buf, scene) {
    const W = this.W, H = this.H
    const checks = {}
    const penalties = { total: 0, issues: [] }
    const flag = (name, pts) => { checks[name] = false; penalties.total += pts; penalties.issues.push(name) }

    // Pick the text bands for this scene type (fractional -> pixel rects).
    const type = scene.type || 'centered'
    let ratioBands, subjectBand
    if (type === 'hook') {
      ratioBands = [RATIO.headline, RATIO.caption]
      subjectBand = RATIO.subject
    } else if (type === 'fact') {
      ratioBands = [RATIO.factHead, RATIO.caption]
      subjectBand = { x: 0.18, y: 0.42, w: 0.63, h: 0.26 }
    } else if (type === 'explanation') {
      ratioBands = [RATIO.explainHead, RATIO.caption]
      subjectBand = { x: 0.18, y: 0.43, w: 0.63, h: 0.25 }
    } else if (type === 'retention' || type === 'brand_close' || type === 'close') {
      ratioBands = [RATIO.centerText, RATIO.caption]
      subjectBand = { x: 0.18, y: 0.23, w: 0.63, h: 0.21 }
    } else {
      // reaction / reveal — captions only
      ratioBands = [RATIO.caption]
      subjectBand = RATIO.subject
    }
    const textBands = ratioBands.map(b => bandFor(buf, W, H, b))
    const subject = bandFor(buf, W, H, subjectBand)
    const bleedRect = bandFor(buf, W, H, RATIO.bleed)

    // Overall blank detection
    const overall = this._regionStats(buf, { x: 0, y: 0, width: W, height: H }, 16)
    checks.blank = !(overall.mean < 10 && overall.stddev < 8)
    if (!checks.blank) { penalties.total += 40; penalties.issues.push('blank') }

    // Contrast — text bands must have enough luminance variance to be legible.
    const textStd = Math.max(...textBands.map(b => this._regionStats(buf, b).stddev))
    checks.contrast = textStd >= 15
    if (!checks.contrast) flag('contrast', textStd >= 10 ? 5 : 20)

    // Text presence — any layout text band must show ink.
    const ink = textBands.map(b => this._regionStats(buf, b))
    const textRendered = ink.some(s => s.hiRatio > 0.8 || s.stddev >= 10) || scene.captionHidden
    checks.textRendered = textRendered
    if (!textRendered && !scene.captionHidden) flag('textRendered', 10)

    // Safe margin — no text bleeding past the caption band (footer is chrome).
    const bleed = this._regionStats(buf, bleedRect, 8).hiRatio
    checks.safeMargin = bleed < 0.15
    if (!checks.safeMargin) flag('safeMargin', 20)

    // Face visibility proxy — subject band should carry visual detail
    const subjectStats = this._regionStats(buf, subject)
    checks.faceVisibility = subjectStats.stddev >= 12
    if (!checks.faceVisibility) flag('faceVisibility', subjectStats.stddev >= 8 ? 5 : 10)

    // Text collision — geometric: mapped layers must stay inside their zones
    const layers = scene.textManifest?.text_layers || []
    checks.textCollision = true
    for (const layer of layers) {
      const rect = SafeZoneManager.zoneFor(layer.position)
      if (!rect) continue
      const v = SafeZoneManager.validate(layer, rect)
      if (!v.ok) { checks.textCollision = false; penalties.total += 10; penalties.issues.push('textCollision'); break }
    }

    const score = Math.max(0, 100 - penalties.total)
    return { score, checks, issues: penalties.issues }
  }

  // Analyze the rendered video: one frame per scene, returns per-scene + overall
  async analyze(videoPath, scenes, options = {}) {
    this._probeDims(videoPath)
    const results = []
    for (const scene of scenes || []) {
      const at = options.secondsForScene
        ? options.secondsForScene(scene)
        : scene.start + (scene.end - scene.start) * 0.65
      const buf = this._extractFrame(videoPath, Math.max(0, at))
      results.push({ scene: scene.id, ...this._frameChecks(buf, scene) })
    }
    const overall = results.length
      ? Math.round(results.reduce((s, r) => s + r.score, 0) / results.length)
      : 0
    const failing = results.filter(r => r.score < this.threshold)
    const issues = failing.flatMap(f => [`scene ${f.scene}: ${f.score}/100`])
    return { overall, threshold: this.threshold, scenes: results, passed: overall >= this.threshold, failing }
  }
}
