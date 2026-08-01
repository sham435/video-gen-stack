import fs from 'fs'
import path from 'path'

// Stage: render — environment and inputs must be ready before the frame loop.
export class RenderPreflight {
  static async run(job, options = {}) {
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
}
