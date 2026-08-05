import fs from 'fs'
import path from 'path'
import { ErrorRegistry } from './ErrorRegistry.mjs'

const MEMORY_FILE = path.resolve(process.cwd(), 'data', 'production-memory.json')

export class ProductionGuardian {
  constructor(options = {}) {
    this.maxRetries = options.maxRetries || 3
    this.circuitBreaker = { failures: 0, open: false, threshold: 10 }
    this.stats = { autoFixes: 0, knownErrors: 0, recoverySuccess: 0, recoveryTotal: 0 }
    this.memory = this._loadMemory()
  }

  _loadMemory() {
    let parsed = null
    try {
      if (fs.existsSync(MEMORY_FILE)) parsed = JSON.parse(fs.readFileSync(MEMORY_FILE, 'utf-8'))
    } catch { /* ignore */ }
    // Normalize: memory files may predate the errors key — always guarantee the
    // arrays the guardian relies on exist (a missing key crashed `.find`).
    return { errors: [], ...(parsed || {}), errors: Array.isArray(parsed?.errors) ? parsed.errors : [] }
  }

  _persistMemory() {
    try {
      fs.mkdirSync(path.dirname(MEMORY_FILE), { recursive: true })
      fs.writeFileSync(MEMORY_FILE, JSON.stringify(this.memory, null, 2))
    } catch { /* ignore */ }
  }

  // Check if this error is already known + fixed
  knownFix(error) {
    const m = String(error?.message || error || '')
    const match = this.memory.errors.find(e => m.toLowerCase().includes((e.name || '').toLowerCase().slice(0, 20)))
    if (match && match.fixed) {
      match.count = (match.count || 0) + 1
      this._persistMemory()
      return { known: true, solution: match.solution, confidence: 98, count: match.count }
    }
    return { known: false }
  }

  analyze(error) {
    const m = String(error?.message || error || '')
    return ErrorRegistry.classify(m)
  }

  async recover(error, context = {}) {
    const diagnosis = this.analyze(error)
    const known = this.knownFix(error)

    // Record the error in memory
    const existing = this.memory.errors.find(e => (e.name || '').toLowerCase() === diagnosis.type.toLowerCase())
    if (existing) existing.count = (existing.count || 0) + 1
    else this.memory.errors.push({ name: diagnosis.type, count: 1, solution: diagnosis.action, fixed: false })
    this._persistMemory()
    this.stats.knownErrors = this.memory.errors.length

    // Circuit breaker: track failures
    this.circuitBreaker.failures++
    if (this.circuitBreaker.failures >= this.circuitBreaker.threshold) this.circuitBreaker.open = true

    console.log(`[Guardian] ${diagnosis.type} → ${diagnosis.action}${known.known ? ` (known fix: ${known.solution})` : ''}`)

    return {
      diagnosis,
      known: known.known,
      knownSolution: known.solution || null,
      retry: !this.circuitBreaker.open,
      circuitBreaker: { ...this.circuitBreaker },
      context: { jobId: context.jobId, category: context.category },
    }
  }

  recordSuccess() {
    this.circuitBreaker.failures = 0
    this.circuitBreaker.open = false
    this.stats.recoverySuccess++
    this.stats.recoveryTotal++
    this.stats.autoFixes++
  }

  recordAttempt() {
    this.stats.recoveryTotal++
  }

  markFixed(error, solution) {
    const m = String(error?.message || error || '')
    const diagnosis = this.analyze(error)
    const entry = this.memory.errors.find(e => (e.name || '').toLowerCase() === diagnosis.type.toLowerCase())
    if (entry) {
      entry.fixed = true
      entry.solution = solution || entry.solution || diagnosis.action
      entry.fixedAt = new Date().toISOString()
    }
    this._persistMemory()
  }

  getStats() {
    return {
      ...this.stats,
      recoveryRate: this.stats.recoveryTotal > 0 ? Math.round((this.stats.recoverySuccess / this.stats.recoveryTotal) * 100) : 100,
      circuitBreaker: { ...this.circuitBreaker },
      knownErrors: this.memory.errors.length,
    }
  }
}
