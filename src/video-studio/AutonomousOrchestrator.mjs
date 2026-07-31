import fs from 'fs'
import path from 'path'

const CONTROL_MODES = Object.freeze(['manual', 'assisted', 'autonomous'])
const TARGET_SCORE = 85
const MAX_OPTIMIZE_ATTEMPTS = 3

// Event-driven lifecycle (DISCOVERED → ... → COMPLETED)
const LIFECYCLE = Object.freeze([
  'DISCOVERED', 'VISUAL_READY', 'CONTRACT_READY', 'COUNCIL_REVIEW',
  'COUNCIL_APPROVED', 'OPTIMIZING', 'SCENE_OPTIMIZATION', 'COVER_TOURNAMENT',
  'VOICE_READY', 'RENDERING', 'QUALITY_REVIEW', 'PUBLISHING', 'ANALYTICS', 'COMPLETED',
])

export class AutonomousOrchestrator {
  constructor(options = {}) {
    this.mode = options.mode || this._loadMode()
    this.targetScore = options.targetScore || TARGET_SCORE
    this.maxAttempts = options.maxAttempts || MAX_OPTIMIZE_ATTEMPTS
    this.listeners = []
    this._modeFile = path.resolve(process.cwd(), 'data', 'orchestrator-mode.json')
  }

  // ── Control mode ──
  getMode() { return this.mode }

  setMode(mode) {
    if (!CONTROL_MODES.includes(mode)) return { ok: false, error: `mode must be one of ${CONTROL_MODES.join(', ')}` }
    this.mode = mode
    try {
      fs.mkdirSync(path.dirname(this._modeFile), { recursive: true })
      fs.writeFileSync(this._modeFile, JSON.stringify({ mode, updatedAt: new Date().toISOString() }, null, 2))
    } catch { /* best effort */ }
    return { ok: true, mode }
  }

  _loadMode() {
    try {
      if (fs.existsSync(this._modeFile)) {
        return JSON.parse(fs.readFileSync(this._modeFile, 'utf-8')).mode || 'assisted'
      }
    } catch { /* ignore */ }
    return 'assisted'
  }

  // ── Event bus ──
  on(event, fn) { this.listeners.push({ event, fn }) }

  emit(event, payload) {
    for (const l of this.listeners) {
      if (l.event === event) l.fn(payload)
    }
  }

  // ── Council gate ──
  async review(contract, council) {
    this.emit('CouncilReview', { contract, council })
    const decision = {
      approved: council.passed,
      score: council.final_score,
      confidence: Math.round((council.final_score / 100) * 100) / 100,
      estimated_ctr: council.ctr_score / 100,
      estimated_retention: council.retention_score / 100,
      recommendations: council.recommendations || [],
    }

    // Autonomous: if below target, run optimization loop before human intervention
    if (this.mode === 'autonomous' && !decision.approved) {
      return this._optimizeLoop(contract, council, { aiProvider: this.aiProvider })
    }
    return decision
  }

  // ── AI optimization loop ──
  async _optimizeLoop(contract, council, deps) {
    const { AIOptimizer } = await import('./AIOptimizer.mjs')
    const optimizer = new AIOptimizer(deps.aiProvider || null)
    let current = contract
    let scores = council
    const history = [{ score: council.final_score, passed: council.passed }]

    for (let attempt = 1; attempt <= this.maxAttempts; attempt++) {
      this.emit('Optimizing', { attempt, max: this.maxAttempts, score: scores.final_score })
      current = await optimizer.optimize(current, { ctr: scores.ctr_score })

      const { AgentCouncil } = await import('./AgentCouncil.mjs')
      const reScore = new AgentCouncil().score(current, { title: current.story?.headline })
      scores = reScore
      history.push({ score: reScore.final_score, passed: reScore.passed, changes: current.changes })

      if (reScore.passed && reScore.final_score >= this.targetScore) break
    }

    this.emit('CouncilApproved', { contract: current, scores, history })
    return {
      approved: scores.passed,
      score: scores.final_score,
      confidence: Math.round((scores.final_score / 100) * 100) / 100,
      estimated_ctr: scores.ctr_score / 100,
      estimated_retention: scores.retention_score / 100,
      recommendations: scores.recommendations || [],
      history,
      attempts: history.length - 1,
      optimized: history.length > 1,
      contract: current,
    }
  }

  // ── Workflow transition — advance lifecycle based on completed prerequisites ──
  async advance(job) {
    const visual = job.stages.visual || job.stages.cover
    const contract = job.stages.story
    if (visual?.status === 'success' && contract?.status === 'success') {
      this.emit('PrerequisitesComplete', { job })
      return true
    }
    return false
  }

  static get CONTROL_MODES() { return CONTROL_MODES }
  static get LIFECYCLE() { return LIFECYCLE }
}
