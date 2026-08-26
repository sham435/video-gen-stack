import { FailureClass } from './Stages.mjs'

/**
 * PublishabilityGate — deterministic policy validator.
 *
 * NOT a production stage. NOT part of ProductionJob lifecycle.
 * This is a pure function that evaluates whether a job's accumulated
 * results satisfy all prerequisites for publish.
 *
 * Usage:
 *   const gate = new PublishabilityGate()
 *   const result = gate.evaluate(job.results)
 *   if (!result.valid) throw new ProductionError(...)
 */

const REQUIRED_CHECKS = ['video', 'thumbnail', 'c2pa', 'uniqueness', 'upload']

export class PublishabilityGate {
  evaluate(results = {}) {
    const checks = {
      video: this._checkVideo(results),
      thumbnail: this._checkThumbnail(results),
      c2pa: this._checkC2pa(results),
      uniqueness: this._checkUniqueness(results),
      upload: this._checkUpload(results),
    }

    const missing = Object.entries(checks)
      .filter(([, v]) => !v.pass)
      .map(([k]) => k)

    return {
      valid: missing.length === 0,
      checks,
      missing,
      timestamp: new Date().toISOString(),
    }
  }

  _checkVideo(results) {
    const render = results.RENDER
    if (!render) return { pass: false, reason: 'RENDER stage not executed' }
    const engine = render.engine
    if (!engine) return { pass: false, reason: 'no engine in RENDER results' }
    return { pass: true, reason: 'video produced' }
  }

  _checkThumbnail(results) {
    const thumb = results.THUMBNAIL
    if (!thumb) return { pass: false, reason: 'THUMBNAIL stage not executed' }
    if (!thumb.selected) return { pass: false, reason: 'no thumbnail selected' }
    return { pass: true, reason: `thumbnail: ${thumb.selected.path}` }
  }

  _checkC2pa(results) {
    const c2pa = results.C2PA
    if (!c2pa) return { pass: false, reason: 'C2PA stage not executed' }
    if (c2pa.skipped) return { pass: true, reason: 'C2PA skipped (not required)' }
    if (!c2pa.signed) return { pass: false, reason: 'C2PA signing failed' }
    return { pass: true, reason: `C2PA signed: ${c2pa.path}` }
  }

  _checkUniqueness(results) {
    const unq = results.UNIQUENESS
    if (!unq) return { pass: false, reason: 'UNIQUENESS stage not executed' }
    if (unq.pass === false) return { pass: false, reason: `uniqueness violations: ${(unq.violations || []).map(v => v.type).join(', ')}` }
    return { pass: true, reason: 'uniqueness passed' }
  }

  _checkUpload(results) {
    const upload = results.UPLOAD
    if (!upload) return { pass: false, reason: 'UPLOAD stage not executed' }
    if (upload.blocked) return { pass: false, reason: `upload blocked: ${upload.reason}` }
    if (!upload.videoId) return { pass: false, reason: 'upload completed but no videoId' }
    return { pass: true, reason: `upload: ${upload.videoId}` }
  }
}

export class ProductionError extends Error {
  constructor(code, details) {
    super(`ProductionError: ${code}`)
    this.code = code
    this.details = details
    this.name = 'ProductionError'
  }
}
