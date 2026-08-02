import { execSync } from 'child_process'
import fs from 'fs'
import { SafeZoneManager, SAFE_ZONES } from '../layout/SafeZoneManager.mjs'

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
// This is the "Frame → Vision Analyzer → Score" step the pre-render
// deterministic checks cannot provide: it verifies what actually rendered.
const W = 1080
const H = 1920
const HEADLINE = SAFE_ZONES.headline // y 0..220
const SUBJECT = SAFE_ZONES.subject // x 200..880, y 250..650
const CAPTION = SAFE_ZONES.caption // y 750..950
const SAMPLE_STEP = 4 // analyze every 4th pixel

export class FrameVisionAnalyzer {
  constructor(options = {}) {
    this.threshold = options.threshold || 85
    this.sampleStep = options.sampleStep || SAMPLE_STEP
  }

  _extractFrame(videoPath, seconds) {
    if (!fs.existsSync(videoPath)) throw new Error('video not found')
    const out = execSync(
      `ffmpeg -v error -ss ${seconds} -i "${videoPath}" -frames:v 1 -f rawvideo -pix_fmt rgb24 pipe:1`,
      { timeout: 20000, maxBuffer: 32 * 1024 * 1024 }
    )
    return Buffer.from(out)
  }

  _lum(buf, i) {
    const r = buf[i], g = buf[i + 1], b = buf[i + 2]
    return 0.299 * r + 0.587 * g + 0.114 * b
  }

  // Sampled stats (mean, stddev, high-contrast ratio) over a rect region
  _regionStats(buf, rect, step = this.sampleStep) {
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
    const threshold = mean + 45
    hi = values.filter(v => Math.abs(v - mean) > 45).length
    return { mean: Math.round(mean), stddev: Math.round(stddev), hiRatio: (hi / n) * 100 }
  }

  _frameChecks(buf, scene) {
    const checks = {}
    const penalties = { total: 0, issues: [] }
    const flag = (name, pts) => { checks[name] = false; penalties.total += pts; penalties.issues.push(name) }

    // Overall blank detection
    const overall = this._regionStats(buf, { x: 0, y: 0, width: W, height: H }, 16)
    checks.blank = !(overall.mean < 10 && overall.stddev < 8)
    if (!checks.blank) { penalties.total += 40; penalties.issues.push('blank') }

    // Contrast — text bands must have enough luminance variance to be legible
    const headline = this._regionStats(buf, HEADLINE)
    const caption = this._regionStats(buf, CAPTION)
    const textStd = Math.max(headline.stddev, caption.stddev)
    checks.contrast = textStd >= 25
    if (!checks.contrast) flag('contrast', textStd >= 15 ? 5 : 20)

    // Text presence — unless the layer is intentionally hidden, expect ink
    checks.textRendered = headline.hiRatio > 0.8 || caption.hiRatio > 0.8 || scene.captionHidden
    if (!checks.textRendered && !scene.captionHidden) flag('textRendered', 10)

    // Safe margin — no text bleeding past the headline/caption zones.
    // Bands kept thin and OUTSIDE the subject zone (y 250..650) so that
    // legitimate subject detail never counts as text bleed.
    const bleedTop = this._regionStats(buf, { x: 200, y: 220, width: 680, height: 26 }, 4).hiRatio
    const bleedBottom = this._regionStats(buf, { x: 200, y: 950, width: 680, height: 26 }, 4).hiRatio
    checks.safeMargin = bleedTop < 0.15 && bleedBottom < 0.15
    if (!checks.safeMargin) flag('safeMargin', 20)

    // Face visibility proxy — subject band should carry visual detail
    const subject = this._regionStats(buf, SUBJECT)
    checks.faceVisibility = subject.stddev >= 12
    if (!checks.faceVisibility) flag('faceVisibility', subject.stddev >= 8 ? 5 : 10)

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
    const results = []
    for (const scene of scenes || []) {
      const at = options.secondsForScene ? options.secondsForScene(scene) : (scene.start || 0) + 0.2
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
