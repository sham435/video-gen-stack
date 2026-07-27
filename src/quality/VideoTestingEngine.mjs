import { execSync } from 'child_process'
import fs from 'fs'

export class VideoTestingEngine {
  async test(videoPath) {
    if (!fs.existsSync(videoPath)) return { pass: false, errors: ['File not found'], score: 0 }

    const results = {}
    results.exists = true
    results.size = fs.statSync(videoPath).size
    results.sizeMB = (results.size / 1024 / 1024).toFixed(1)

    try {
      const info = execSync(
        `ffprobe -v error -select_streams v:0 -show_entries stream=width,height,codec_name,r_frame_rate -of default=noprint_wrappers=1 "${videoPath}"`,
        { timeout: 10000 }
      ).toString()

      const width = parseInt(info.match(/width=(\d+)/)?.[1] || '0')
      const height = parseInt(info.match(/height=(\d+)/)?.[1] || '0')
      const fpsMatch = info.match(/r_frame_rate=(\d+)\/(\d+)/)
      const fps = fpsMatch ? parseInt(fpsMatch[1]) / parseInt(fpsMatch[2]) : 0
      const codec = info.match(/codec_name=(\w+)/)?.[1]

      results.resolution = { width, height, valid: width === 1080 && height === 1920 }
      results.fps = { value: fps, valid: Math.abs(fps - 30) < 1 }
      results.codec = { value: codec, valid: codec === 'h264' }

      const duration = execSync(
        `ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${videoPath}"`,
        { timeout: 10000 }
      ).toString().trim()
      results.duration = { value: parseFloat(duration || 0), valid: parseFloat(duration || 0) >= 15 }
    } catch (e) {
      results.error = e.message
    }

    try {
      const black = execSync(
        `ffmpeg -i "${videoPath}" -vf "blackdetect=d=0.5:pix_th=0.1" -f null - 2>&1 | grep -c blackdetect`,
        { timeout: 15000 }
      ).toString().trim()
      results.blackFrames = { count: parseInt(black || '0'), valid: parseInt(black || '0') === 0 }
    } catch { results.blackFrames = { count: 0, valid: true } }

    results.technicalScore = this.calcScore(results)
    return results
  }

  calcScore(r) {
    let score = 100
    if (!r.resolution?.valid) score -= 25
    if (!r.fps?.valid) score -= 15
    if (!r.codec?.valid) score -= 10
    if (!r.duration?.valid) score -= 10
    if (r.blackFrames?.count > 0) score -= 20
    return Math.max(0, score)
  }
}
