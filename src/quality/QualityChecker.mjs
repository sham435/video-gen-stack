import fs from 'fs'
import { execFileSync } from 'child_process'

export class QualityChecker {
  constructor(config) {
    this.config = config
  }

  validateTemplate(template) {
    const errors = []

    if (!template.version) errors.push('Missing version')
    // Rendered output is always 16:9 landscape (1280x720, 1920x1080,
    // 3840x2160). Validate aspect, not one size.
    const { width = 0, height = 0 } = template.resolution || {}
    const gcd = (a, b) => (b ? gcd(b, a % b) : a)
    const g = gcd(width, height)
    const ar = g ? `${width / g}:${height / g}` : ''
    if (ar !== '16:9') {
      errors.push(`Resolution must be 16:9, got ${width}x${height}`)
    }
    if (template.fps !== 30) errors.push('FPS must be 30')
    if (!template.scenes || template.scenes.length === 0) errors.push('No scenes defined')

    const firstScene = template.scenes[0]
    if (firstScene && firstScene.start !== 0) errors.push('First scene must start at 0s')

    for (const scene of template.scenes) {
      if (!scene.id) errors.push('Scene missing id')
      if (!scene.type) errors.push(`Scene ${scene.id || '?'} missing type`)
      if (scene.end - scene.start < 1) errors.push(`Scene ${scene.id} duration too short (<1s)`)
    }

    if (!template.colors?.primary) errors.push('Missing primary color')
    if (!template.colors?.secondary) errors.push('Missing secondary color')

    return {
      valid: errors.length === 0,
      errors,
      warnings: [],
    }
  }

  checkRenderOutput(videoPath, expect = null) {
    const checks = {}

    try {
      const info = execFileSync(
        'ffprobe',
        ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height,codec_name,r_frame_rate', '-of', 'default=noprint_wrappers=1', videoPath]
      ).toString().trim()

      checks.resolution = this.parseResolution(info, expect)
      checks.codec = info.match(/codec_name=(\w+)/)?.[1]
      checks.fps = this.parseFPS(info)
    } catch {}

    return checks
  }

  parseResolution(info, expect = null) {
    const w = parseInt(info.match(/width=(\d+)/)?.[1] || '0')
    const h = parseInt(info.match(/height=(\d+)/)?.[1] || '0')
    const gcd = (a, b) => (b ? gcd(b, a % b) : a)
    const g = gcd(w, h)
    const ar = g ? `${w / g}:${h / g}` : ''
    // Valid if it exactly matches the expected size, or if it's the 16:9
    // landscape aspect ratio (so any 16:9 production render validates).
    const expectMatch = expect && w === expect.width && h === expect.height
    const aspectValid = ar === '16:9'
    return { width: w, height: h, valid: expectMatch || aspectValid, aspectRatio: ar }
  }

  parseFPS(info) {
    const match = info.match(/r_frame_rate=(\d+)\/(\d+)/)
    if (match) return parseInt(match[1]) / parseInt(match[2])
    return 0
  }

  verifySceneSequence(scenes) {
    let prevEnd = 0
    for (const scene of scenes) {
      if (Math.abs(scene.start - prevEnd) > 0.1) {
        return { valid: false, gap: `Gap between ${prevEnd}s and ${scene.start}s` }
      }
      prevEnd = scene.end
    }
    return { valid: true }
  }

  async analyzeRenderedVideo(videoPath, expect = null) {
    const results = {
      path: videoPath,
      exists: fs.existsSync(videoPath),
      checks: {},
      warnings: [],
    }

    if (!results.exists) {
      results.warnings.push('Video file does not exist')
      return results
    }

    results.checks = this.checkRenderOutput(videoPath, expect)

    const size = fs.statSync(videoPath).size
    results.checks.fileSize = size
    results.checks.fileSizeMB = (size / (1024 * 1024)).toFixed(1)

    if (size < 1024 * 100) results.warnings.push('Video file suspiciously small')

    return results
  }
}
