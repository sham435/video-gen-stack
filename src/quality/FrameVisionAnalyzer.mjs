import { execFileSync } from 'child_process'
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
const SAMPLE_STEP = 4 // analyze every 4th pixel

// Scene-type text presets — calibrated against the actual renderer layout
// (InformationLayer + CaptionEngine) on rendered 1080x1920 output:
//   hook:        headline band y1080-1320 (H*0.62±46) + captions y1405-1630
//   fact:        headline card centered at H*0.30 (y~450-750) + captions
//   explanation: "WHY IT MATTERS" header at y288 (+ body when present) + captions
//   reaction/reveal: captions only — the background image is NOT text
//   retention/brand_close: center text at H*0.50 (y~960) + captions
// Every scene carries word captions at y1405-1630, so that band is the
// universal text signal. The bright brand footer starts at y1820 and must
// never count as text bleed.
const LAYOUTS = {
  hook: {
    textBands: [SAFE_ZONES.headline, SAFE_ZONES.caption],
    subject: SAFE_ZONES.subject,
  },
  fact: {
    textBands: [{ x: 0, y: 400, width: 1080, height: 400 }, SAFE_ZONES.caption],
    subject: { x: 200, y: 800, width: 680, height: 500 },
  },
  explanation: {
    textBands: [{ x: 0, y: 250, width: 1080, height: 560 }, SAFE_ZONES.caption],
    subject: { x: 200, y: 820, width: 680, height: 480 },
  },
  reaction: {
    textBands: [SAFE_ZONES.caption],
    subject: SAFE_ZONES.subject,
  },
  reveal: {
    textBands: [SAFE_ZONES.caption],
    subject: SAFE_ZONES.subject,
  },
  centered: {
    textBands: [{ x: 0, y: 880, width: 1080, height: 280 }, SAFE_ZONES.caption],
    subject: { x: 200, y: 450, width: 680, height: 400 },
  },
}
// Gap between caption band (ends y1640) and the brand footer (starts y1820).
// Text bleeding past the captions lands here — this is the only bleed zone
// that stays reliably content-free on rendered frames.
const BLEED_BOTTOM = { x: 200, y: 1650, width: 680, height: 40 }

export class FrameVisionAnalyzer {
  constructor(options = {}) {
    this.threshold = options.threshold || 85
    this.sampleStep = options.sampleStep || SAMPLE_STEP
  }

  _extractFrame(videoPath, seconds) {
    if (!fs.existsSync(videoPath)) throw new Error('video not found')
    const out = execFileSync(
      'ffmpeg',
      ['-v', 'error', '-ss', String(seconds), '-i', videoPath, '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgb24', 'pipe:1'],
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
    const layout = LAYOUTS[scene.type] || LAYOUTS.centered

    // Overall blank detection
    const overall = this._regionStats(buf, { x: 0, y: 0, width: W, height: H }, 16)
    checks.blank = !(overall.mean < 10 && overall.stddev < 8)
    if (!checks.blank) { penalties.total += 40; penalties.issues.push('blank') }

    // Contrast — text bands must have enough luminance variance to be legible.
    // Calibrated to measured renders: captions ~17-22, headlines ~68-77.
    const textStd = Math.max(...layout.textBands.map(b => this._regionStats(buf, b).stddev))
    checks.contrast = textStd >= 15
    if (!checks.contrast) flag('contrast', textStd >= 10 ? 5 : 20)

    // Text presence — any layout text band must show ink (headline band for
    // hook/fact, centered CTA for close scenes, or the universal caption band)
    const ink = layout.textBands.map(b => this._regionStats(buf, b))
    const textRendered = ink.some(s => s.hiRatio > 0.8 || s.stddev >= 10) || scene.captionHidden
    checks.textRendered = textRendered
    if (!textRendered && !scene.captionHidden) flag('textRendered', 10)

    // Safe margin — no text bleeding past the caption band (footer at y1820
    // is brand chrome, not bleed)
    const bleed = this._regionStats(buf, BLEED_BOTTOM, 8).hiRatio
    checks.safeMargin = bleed < 0.15
    if (!checks.safeMargin) flag('safeMargin', 20)

    // Face visibility proxy — subject band should carry visual detail
    const subject = this._regionStats(buf, layout.subject)
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
      // Sample at ~65% of the scene duration — after the headline/caption
      // animations have fully rendered (text animates in at progress 0.45+,
      // so sampling at +0.2s would catch empty pre-animation frames)
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
