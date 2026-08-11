import fs from 'fs'
import path from 'path'
import { validateRenderOutput } from '../video/validateOutput.mjs'

// Stage: publish — the finished video must exist AND be a readable,
// probable, streamed render before any upload attempt. RENDER-001: file
// existence alone is not a publish gate — a truncated/corrupt mp4 (missing
// moov atom, zero duration, missing streams) must never reach YouTube or
// LinkedIn. Proprietary diagnostics are surfaced as VIDEO_INVALID codes.
export class PublishPreflight {
  static async run(job, options = {}) {
    const errors = []
    const warnings = []
    if (!options.bypassYoutube && !process.env.YOUTUBE_REFRESH_TOKEN) {
      warnings.push('YOUTUBE_CREDENTIALS_MISSING')
    }
    const outDir = options.outDir || 'output'
    const video = path.join(outDir, options.videoName || 'final.mp4')
    if (!fs.existsSync(video)) {
      errors.push('VIDEO_MISSING')
      return { errors, warnings }
    }

    const res = await validateRenderOutput(video, { requireAudio: true })
    if (!res.ok) {
      const { diagnostics } = res
      for (const code of res.errors) errors.push(`VIDEO_INVALID:${code}`)
      if (diagnostics) {
        warnings.push(
          `video=${video} size=${diagnostics.size}B duration=${diagnostics.duration ?? 'n/a'} moov=${diagnostics.moovDetected ?? 'n/a'} streams=${Array.isArray(diagnostics.streams) ? diagnostics.streams.length : 'n/a'}`
        )
      }
    }
    return { errors, warnings }
  }
}