import fs from 'fs'
import path from 'path'

const QUEUE_FILE = path.resolve(process.cwd(), 'data', 'autonomous-queue.json')
const USER_WINDOW_MS = 20 * 60 * 1000 // 20-minute human review window
const AUTO_START_MS = 10 * 60 * 1000   // T-10: auto-execute if untouched

export class AutonomousScheduler {
  constructor() {
    this.queue = this._load()
    this._timer = null
    this._onAutoExecute = null
    // Resume T-10 auto-execution for persisted pending items after restart
    this._armTimer()
  }

  // Terminal transitions so items never stay stuck in AUTO_EXECUTING
  complete(id, detail) {
    const item = this.queue.find(q => q.id === id)
    if (!item) return null
    item.status = 'COMPLETED'
    item.completedAt = new Date().toISOString()
    item.result = detail
    this._persist()
    return item
  }

  fail(id, error) {
    const item = this.queue.find(q => q.id === id)
    if (!item) return null
    item.status = 'FAILED'
    item.completedAt = new Date().toISOString()
    item.error = error
    this._persist()
    return item
  }

  _load() {
    try {
      if (fs.existsSync(QUEUE_FILE)) return JSON.parse(fs.readFileSync(QUEUE_FILE, 'utf-8'))
    } catch { /* ignore */ }
    return []
  }

  _persist() {
    try {
      fs.mkdirSync(path.dirname(QUEUE_FILE), { recursive: true })
      fs.writeFileSync(QUEUE_FILE, JSON.stringify(this.queue, null, 2))
    } catch { /* ignore */ }
  }

  // Create a ProductionIntent from Visual + Contract completion
  async enqueue(intent) {
    const item = {
      id: `auto_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      topic: intent.topic,
      category: intent.category,
      contract: intent.contract,
      predictedCtr: intent.predictedCtr || null,
      retentionScore: intent.retentionScore || null,
      audience: intent.audience || 'tech enthusiasts',
      recommendedTemplate: intent.recommendedTemplate || 'breaking-news',
      recommendedDuration: intent.recommendedDuration || 30,
      status: 'WAITING_USER_CONFIRMATION',
      enqueuedAt: new Date().toISOString(),
      confirmBy: new Date(Date.now() + USER_WINDOW_MS).toISOString(),
      autoStartAt: new Date(Date.now() + AUTO_START_MS).toISOString(),
      touched: false,
    }
    this.queue.push(item)
    this._persist()
    this._armTimer()
    return item
  }

  // Activity-aware: any user edit resets the idle countdown
  touch(id) {
    const item = this.queue.find(q => q.id === id)
    if (!item) return null
    item.touched = true
    item.confirmBy = new Date(Date.now() + USER_WINDOW_MS).toISOString()
    item.autoStartAt = new Date(Date.now() + AUTO_START_MS).toISOString()
    this._persist()
    return item
  }

  // User actions
  approve(id) {
    const item = this.queue.find(q => q.id === id)
    if (!item) return null
    item.touched = true
    item.status = 'APPROVED'
    item.confirmedAt = new Date().toISOString()
    this._persist()
    return item
  }

  cancel(id, reason = 'user cancelled') {
    const item = this.queue.find(q => q.id === id)
    if (!item) return null
    item.touched = true
    item.status = 'CANCELLED'
    item.reason = reason
    this._persist()
    return item
  }

  edit(id, patch) {
    const item = this.queue.find(q => q.id === id)
    if (!item) return null
    item.touched = true
    if (patch.contract) item.contract = patch.contract
    if (patch.category) item.category = patch.category
    if (patch.topic) item.topic = patch.topic
    this._persist()
    return item
  }

  // T-10 auto-execute when user hasn't touched the item
  _armTimer() {
    if (this._timer) clearTimeout(this._timer)
    this._timer = setTimeout(() => this._checkAutoStart(), 30_000)
  }

  _checkAutoStart() {
    const now = Date.now()
    let advanced = false
    for (const item of this.queue) {
      if (item.status === 'WAITING_USER_CONFIRMATION' && !item.touched && new Date(item.autoStartAt).getTime() <= now) {
        item.status = 'AUTO_EXECUTING'
        item.autoExecutedAt = new Date().toISOString()
        item.reason = 'No user intervention detected — AI took ownership'
        advanced = true
      }
    }
    if (advanced) {
      this._persist()
      if (this._onAutoExecute) this._onAutoExecute(this.queue.filter(q => q.status === 'AUTO_EXECUTING'))
    }
    this._armTimer()
  }

  setOnAutoExecute(fn) { this._onAutoExecute = fn }

  list() {
    const now = Date.now()
    return this.queue.map(q => ({
      ...q,
      confirmRemaining: Math.max(0, new Date(q.confirmBy).getTime() - now),
      autoStartRemaining: q.status === 'WAITING_USER_CONFIRMATION' ? Math.max(0, new Date(q.autoStartAt).getTime() - now) : 0,
    })).reverse()
  }

  static get USER_WINDOW_MS() { return USER_WINDOW_MS }
  static get AUTO_START_MS() { return AUTO_START_MS }
}
