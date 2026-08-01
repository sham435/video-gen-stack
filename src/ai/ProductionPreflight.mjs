import fs from 'fs'
import path from 'path'

// Stage-based preflight — each pipeline stage owns its own validation rules.
// Callers declare the stage they are entering, so a check can never run
// before the data it depends on exists:
//
//   stage: 'article'  → article + category present
//   stage: 'scene'    → scenes built and non-empty
//   stage: 'render'   → ffmpeg available, output writable, narration ready
//   stage: 'publish'  → video exists, YouTube credentials (warning)
//
// Output: [Preflight:ARTICLE] PASS / BLOCKED: REASON
export class ProductionPreflight {
  static STAGES = ['article', 'scene', 'render', 'publish']

  static _validateArticle(job, options) {
    const errors = []
    if (!job?.article && !options.article) errors.push('ARTICLE_MISSING')
    if (!job?.category && !options.category) errors.push('CATEGORY_MISSING')
    return { errors, warnings: [] }
  }

  static _validateScene(job) {
    const errors = []
    const warnings = []
    if (!job?.scenes || job.scenes.length === 0) {
      errors.push('SCENE_EMPTY')
    } else if (job.scenes.length < 3) {
      warnings.push('MIN_SCENES')
    }
    return { errors, warnings }
  }

  static async _validateRender(job, options) {
    const errors = []
    const warnings = []
    try {
      const { execSync } = await import('child_process')
      execSync('ffmpeg -version', { stdio: 'pipe' })
    } catch {
      errors.push('FFMPEG_MISSING')
    }
    const outDir = options.outDir || 'output'
    try {
      fs.mkdirSync(outDir, { recursive: true })
      const test = path.join(outDir, '.preflight-write-test')
      fs.writeFileSync(test, 'ok')
      fs.unlinkSync(test)
    } catch {
      errors.push('OUTPUT_NOT_WRITABLE')
    }
    const narration = path.join(outDir, 'narration.mp3')
    if (!fs.existsSync(narration)) warnings.push('NARRATION_MISSING')
    return { errors, warnings }
  }

  static async _validatePublish(job, options) {
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

  static async check(job, options = {}) {
    // Backward compat: expectScenes: true → stage 'scene'
    let stage = options.stage || (options.expectScenes ? 'scene' : 'article')
    if (!this.STAGES.includes(stage)) stage = 'article'

    let result
    switch (stage) {
      case 'scene':
        result = this._validateScene(job, options)
        break
      case 'render':
        result = await this._validateRender(job, options)
        break
      case 'publish':
        result = await this._validatePublish(job, options)
        break
      default:
        result = this._validateArticle(job, options)
    }

    const { errors, warnings } = result
    const ready = errors.length === 0
    const label = stage.toUpperCase()
    const warning = warnings.length ? ` (warning: ${warnings.join(', ')})` : ''
    console.log(`[Preflight:${label}] ${ready ? 'PASS' : `BLOCKED: ${errors.join(', ')}`}${warning}`)

    return {
      stage,
      ready,
      errors,
      warnings,
      summary: `${errors.length} errors, ${warnings.length} warnings`,
    }
  }
}
