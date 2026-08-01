import fs from 'fs'
import path from 'path'

// Stage: publish — the finished video must exist before any upload attempt.
export class PublishPreflight {
  static async run(job, options = {}) {
    const errors = []
    const warnings = []
    if (!options.bypassYoutube && !process.env.YOUTUBE_REFRESH_TOKEN) {
      warnings.push('YOUTUBE_CREDENTIALS_MISSING')
    }
    const outDir = options.outDir || 'output'
    const video = path.join(outDir, options.videoName || 'final.mp4')
    if (!fs.existsSync(video)) errors.push('VIDEO_MISSING')
    return { errors, warnings }
  }
}
