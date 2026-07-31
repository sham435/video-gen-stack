import fs from 'fs'
import path from 'path'

const STAGES = [
  { id: 'collector', label: 'Collector', emoji: '📰', requires: [] },
  { id: 'story', label: 'Story Director', emoji: '🧠', requires: ['collector'] },
  { id: 'cover', label: 'Cover Director', emoji: '🎨', requires: ['story'] },
  { id: 'assets', label: 'Visual Planner', emoji: '🎬', requires: ['story'] },
  { id: 'voice', label: 'VoiceSync', emoji: '🎙️', requires: ['story'] },
  { id: 'render', label: 'Renderer', emoji: '🎞️', requires: ['assets', 'voice'] },
  { id: 'quality', label: 'Quality Guardian', emoji: '🔍', requires: ['render'] },
  { id: 'publish', label: 'Publisher', emoji: '🚀', requires: ['quality'], approval: true },
  { id: 'analytics', label: 'Analytics', emoji: '📊', requires: ['publish'] },
]

// Full lifecycle state machine: DISCOVERED → ANALYZING → ... → ANALYTICS
const LIFECYCLE = Object.freeze([
  'DISCOVERED',
  'ANALYZING',
  'SCRIPT_READY',
  'COVER_READY',
  'ASSETS_READY',
  'VOICE_READY',
  'RENDERING',
  'QUALITY_REVIEW',
  'EDITOR_APPROVAL',
  'PUBLISHED',
  'ANALYTICS',
])

const STAGE_TO_LIFECYCLE = Object.freeze({
  collector: 'ANALYZING',
  story: 'SCRIPT_READY',
  cover: 'COVER_READY',
  assets: 'ASSETS_READY',
  voice: 'VOICE_READY',
  render: 'RENDERING',
  quality: 'QUALITY_REVIEW',
  publish: 'PUBLISHED',
  analytics: 'ANALYTICS',
})

const EVENT_FILE = path.resolve(process.cwd(), 'data', 'pipeline-events.jsonl')

export class ProductionJob {
  constructor(article, options = {}) {
    this.id = options.id || `pj_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
    this.articleId = article?.url || article?.title || 'unknown'
    this.title = article?.title || 'Untitled'
    this.createdAt = new Date().toISOString()
    this.status = 'DISCOVERED'
    this.lifecycleIndex = 0
    this.approved = false
    this.stages = Object.fromEntries(STAGES.map(s => [s.id, { status: 'waiting', startedAt: null, endedAt: null, detail: null, score: null }]))
    this.artifacts = {}
    this.metrics = {}
    this.events = []
  }

  _emitEvent(stageId, status, durationMs, detail) {
    const event = {
      job: this.id,
      stage: stageId,
      agent: this._agentForStage(stageId),
      status,
      duration_ms: durationMs,
      detail,
      timestamp: new Date().toISOString(),
    }
    this.events.push(event)
    try {
      fs.mkdirSync(path.dirname(EVENT_FILE), { recursive: true })
      fs.appendFileSync(EVENT_FILE, JSON.stringify(event) + '\n')
    } catch { /* best effort */ }
  }

  _agentForStage(stageId) {
    const agents = {
      collector: 'collector-agent', story: 'story-director', cover: 'cover-director',
      assets: 'visual-planner', voice: 'voice-sync', render: 'scene-engine',
      quality: 'quality-guardian', publish: 'publisher', analytics: 'analytics-agent',
    }
    return agents[stageId] || 'unknown'
  }

  markStart(stageId) {
    if (!this.stages[stageId]) return
    this.stages[stageId].status = 'running'
    this.stages[stageId].startedAt = new Date().toISOString()
    this._emitEvent(stageId, 'running', null, 'started')
    this._persist()
  }

  markDone(stageId, { ok = true, detail = null, score = null, artifact = null } = {}) {
    if (!this.stages[stageId]) return
    this.stages[stageId].status = ok ? 'success' : 'failed'
    this.stages[stageId].endedAt = new Date().toISOString()
    this.stages[stageId].detail = detail
    this.stages[stageId].score = score
    if (artifact) this.artifacts[stageId] = artifact
    const started = this.stages[stageId].startedAt ? new Date(this.stages[stageId].startedAt).getTime() : null
    const duration = started ? Date.now() - started : null
    this._emitEvent(stageId, ok ? 'success' : 'failed', duration, detail)
    this._updateOverall()
    this._persist()
  }

  markFailed(stageId, detail) {
    this.markDone(stageId, { ok: false, detail })
  }

  approve() {
    this.approved = true
    this._emitEvent('publish', 'approved', null, 'editor approval granted')
    this._persist()
  }

  reject() {
    this.approved = false
    this._emitEvent('publish', 'rejected', null, 'editor approval denied')
    this._persist()
  }

  _updateOverall() {
    const order = STAGES.map(s => s.id)
    let current = 'DISCOVERED'
    let idx = 0
    for (const id of order) {
      const st = this.stages[id].status
      if (st === 'running') { current = STAGE_TO_LIFECYCLE[id]; idx = LIFECYCLE.indexOf(current); break }
      if (st === 'failed') { current = `BLOCKED_AT_${STAGE_TO_LIFECYCLE[id]}`; break }
      if (st === 'success') { current = STAGE_TO_LIFECYCLE[id]; idx = LIFECYCLE.indexOf(current) }
    }
    // Publish requires approval — hold at EDITOR_APPROVAL
    if (current === 'PUBLISHED' && !this.approved && this.stages.quality.status === 'success') {
      current = 'EDITOR_APPROVAL'
      idx = LIFECYCLE.indexOf('EDITOR_APPROVAL')
    }
    this.status = current
    this.lifecycleIndex = idx
  }

  canStart(stageId) {
    const stage = STAGES.find(s => s.id === stageId)
    if (!stage) return { ok: false, reason: `unknown stage: ${stageId}` }
    if (stage.approval && !this.approved) return { ok: false, reason: `Approval required before ${stage.label}` }
    for (const req of stage.requires) {
      if (this.stages[req].status !== 'success') return { ok: false, reason: `${stage.label} requires ${req} to succeed` }
    }
    return { ok: true }
  }

  static get STAGES() { return STAGES }

  toJSON() {
    return {
      id: this.id,
      articleId: this.articleId,
      title: this.title,
      status: this.status,
      lifecycleIndex: this.lifecycleIndex,
      lifecycle: LIFECYCLE,
      approved: this.approved,
      createdAt: this.createdAt,
      stages: this.stages,
      artifacts: this.artifacts,
      metrics: this.metrics,
    }
  }

  _persist() {
    try {
      const dir = path.resolve(process.cwd(), 'data', 'production-jobs')
      fs.mkdirSync(dir, { recursive: true })
      fs.writeFileSync(path.join(dir, `${this.id}.json`), JSON.stringify(this.toJSON(), null, 2))
    } catch { /* best effort */ }
  }
}
