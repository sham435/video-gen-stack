import fs from 'fs'
import path from 'path'

// Preflight validation — checks everything before rendering starts.
// Context-aware by stage: callers declare what they validate.
//   expectScenes: true  → caller provides a job that must already contain scenes
//                         (e.g. orchestrator re-checking a built production job)
//   expectScenes: false → caller builds scenes itself (e.g. generateFromArticle)
// This prevents stage regressions where a check runs before its data exists.
export class ProductionPreflight {
  static async check(job, options = {}) {
    const errors = []
    const warnings = []

    if (!job?.article && !options.article) errors.push('ARTICLE_MISSING')
    if (!job?.category && !options.category) errors.push('CATEGORY_MISSING')
    if (options.expectScenes && (!job?.scenes || job.scenes.length === 0)) errors.push('SCENE_EMPTY')

    // FFmpeg available
    if (!options.bypassFfmpeg) {
      try {
        const { execSync } = await import('child_process')
        execSync('ffmpeg -version', { stdio: 'pipe' })
      } catch {
        errors.push('FFMPEG_MISSING')
      }
    }

    // Output directory writable
    const outDir = options.outDir || 'output'
    try {
      fs.mkdirSync(outDir, { recursive: true })
      const test = path.join(outDir, '.preflight-write-test')
      fs.writeFileSync(test, 'ok')
      fs.unlinkSync(test)
    } catch {
      errors.push('OUTPUT_NOT_WRITABLE')
    }

    // YouTube credentials (warning if publishing)
    if (!options.bypassYoutube && !process.env.YOUTUBE_REFRESH_TOKEN) {
      warnings.push('YOUTUBE_CREDENTIALS_MISSING')
    }

    return {
      ready: errors.length === 0,
      errors,
      warnings,
      summary: `${errors.length} errors, ${warnings.length} warnings`,
    }
  }
}
