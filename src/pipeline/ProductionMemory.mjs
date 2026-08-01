import fs from 'fs'
import path from 'path'

const MEMORY_FILE = path.resolve(process.cwd(), 'data', 'production-memory.json')

// Production Learning Memory — accumulates reusable rules so the pipeline
// never re-encounters the same class of issue without a known fix.
export class ProductionMemory {
  constructor() {
    this.memory = this._load()
  }

  _load() {
    try {
      if (fs.existsSync(MEMORY_FILE)) return JSON.parse(fs.readFileSync(MEMORY_FILE, 'utf-8'))
    } catch { /* ignore */ }
    return { rules: [] }
  }

  _persist() {
    try {
      fs.mkdirSync(path.dirname(MEMORY_FILE), { recursive: true })
      fs.writeFileSync(MEMORY_FILE, JSON.stringify(this.memory, null, 2))
    } catch { /* ignore */ }
  }

  // Look up a known rule for a detected issue
  lookup(rule) {
    return this.memory.rules.find(r => r.rule === rule) || null
  }

  // Record a resolved issue as reusable knowledge.
  // retentionImpact aggregates performance patterns (negative = hurts
  // retention, positive = helps), smoothed over frequency.
  learn(rule, { status = 'resolved', introducedIn = 'V4', preventedBy = null, preferredFix = null, retentionImpact = null } = {}) {
    const existing = this.memory.rules.find(r => r.rule === rule)
    if (existing) {
      existing.frequency = (existing.frequency || 1) + 1
      if (preferredFix) existing.preferredFix = preferredFix
      if (preventedBy) existing.preventedBy = preventedBy
      if (retentionImpact != null) {
        existing.retentionImpact = existing.retentionImpact == null
          ? retentionImpact
          : Math.round(((existing.retentionImpact * (existing.frequency - 1)) + retentionImpact) / existing.frequency)
      }
    } else {
      this.memory.rules.push({ rule, status, introducedIn, preventedBy, preferredFix, retentionImpact, frequency: 1, learnedAt: new Date().toISOString() })
    }
    this._persist()
    return this.memory.rules.find(r => r.rule === rule)
  }

  rules() {
    return this.memory.rules
  }
}
