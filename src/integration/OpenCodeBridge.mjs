import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '../..')
const CONFIG_PATH = path.join(ROOT, '.opencode/system-config.json')

const REQUIRED_TOP_LEVEL_KEYS = Object.freeze([
  'agents',
  'memory',
  'workflows',
  'policies',
  'approval_required',
  'data_sources',
  'integration_points',
])

const KNOWN_DIRS = Object.freeze(['agents', 'memory', 'workflows', 'policies'])
const DIR_TO_CONFIG_KEY = Object.freeze({
  agents: 'agents',
  memory: 'memory',
  workflows: 'workflows',
  policies: 'policies',
})

function readConfigSafe() {
  if (!fs.existsSync(CONFIG_PATH)) {
    throw new Error(`[OpenCodeBridge] Config missing: ${CONFIG_PATH}. Expected .opencode/system-config.json after 2026-07-30 schema rename.`)
  }
  const raw = fs.readFileSync(CONFIG_PATH, 'utf-8')
  let parsed
  try {
    parsed = JSON.parse(raw)
  } catch (e) {
    throw new Error(`[OpenCodeBridge] Config JSON parse failed: ${e.message}. File: ${CONFIG_PATH}`)
  }
  return { raw, parsed }
}

function validateConfigSchema(parsed) {
  const errors = []
  const warnings = []

  for (const key of REQUIRED_TOP_LEVEL_KEYS) {
    if (!(key in parsed)) {
      errors.push(`Missing required top-level key: "${key}"`)
    }
  }

  const valueTypes = {
    agents: 'object',
    memory: 'object',
    workflows: 'object',
    policies: 'object',
    approval_required: 'array',
    data_sources: 'array',
    integration_points: 'array',
  }
  for (const [key, expectedType] of Object.entries(valueTypes)) {
    if (!(key in parsed)) continue
    const actual = Array.isArray(parsed[key]) ? 'array' : typeof parsed[key]
    if (actual !== expectedType) {
      errors.push(`Wrong type for "${key}": expected ${expectedType}, got ${actual}`)
    }
  }

  const entryPathKeys = { agents: 'path' }
  for (const [regKey, subPathKey] of Object.entries(entryPathKeys)) {
    if (typeof parsed[regKey] !== 'object' || !parsed[regKey]) continue
    for (const [name, entry] of Object.entries(parsed[regKey])) {
      if (typeof entry !== 'object' || entry === null) {
        errors.push(`${regKey}["${name}"]: entry must be an object`)
        continue
      }
      if (!(subPathKey in entry)) {
        errors.push(`${regKey}["${name}"]: missing "${subPathKey}"`)
      }
    }
  }

  for (const regKey of ['memory', 'workflows', 'policies']) {
    if (typeof parsed[regKey] !== 'object' || !parsed[regKey]) continue
    for (const [name, entry] of Object.entries(parsed[regKey])) {
      if (typeof entry !== 'string') {
        errors.push(`${regKey}["${name}"]: expected string path, got ${typeof entry}`)
      }
    }
  }

  if (Array.isArray(parsed.integration_points)) {
    for (let i = 0; i < parsed.integration_points.length; i++) {
      const p = parsed.integration_points[i]
      if (typeof p !== 'object' || p === null) {
        errors.push(`integration_points[${i}]: expected object`)
        continue
      }
      if (!('name' in p)) errors.push(`integration_points[${i}]: missing "name"`)
      if (!('protocol' in p)) errors.push(`integration_points[${i}]: missing "protocol"`)
    }
  }

  const allowedMetadataKeys = ['engine', 'description', 'version', 'validation_schemas', ...REQUIRED_TOP_LEVEL_KEYS]
  for (const k of Object.keys(parsed)) {
    if (!allowedMetadataKeys.includes(k)) {
      warnings.push(`Unrecognized top-level key: "${k}" — ensure it is intentional; will not break bridge but may be stale`)
    }
  }

  return { errors, warnings }
}

function detectOrphans(parsed) {
  const orphans = []
  const registered = new Set()

  const regDir = (dirName, configKey, extractPath) => {
    const entries = parsed[configKey] || {}
    for (const [, entry] of Object.entries(entries)) {
      const relPath = typeof entry === 'string' ? entry : extractPath(entry)
      if (relPath) registered.add(path.normalize(relPath))
    }
    const dirFull = path.join(ROOT, '.opencode', dirName)
    if (!fs.existsSync(dirFull)) return
    const files = fs.readdirSync(dirFull).filter(f => f.endsWith('.md'))
    for (const f of files) {
      const rel = path.normalize(path.join(dirName, f))
      if (!registered.has(rel)) {
        orphans.push({ directory: dirName, file: f, path: rel })
      }
    }
  }

  regDir('agents', 'agents', e => e?.path)
  regDir('memory', 'memory', e => e)
  regDir('workflows', 'workflows', e => e)
  regDir('policies', 'policies', e => e)

  const brokenRegistry = []
  for (const dirName of KNOWN_DIRS) {
    const configKey = DIR_TO_CONFIG_KEY[dirName]
    const entries = parsed[configKey] || {}
    for (const [name, entry] of Object.entries(entries)) {
      const relPath = typeof entry === 'string' ? entry : entry?.path
      if (!relPath) continue
      const full = path.join(ROOT, '.opencode', relPath)
      if (!fs.existsSync(full)) {
        brokenRegistry.push({ type: configKey, name, expectedPath: relPath, missing: true })
      }
    }
  }

  return { orphans, brokenRegistry }
}

export class OpenCodeBridge {
  constructor(options = {}) {
    const { parsed } = readConfigSafe()
    const schema = validateConfigSchema(parsed)
    if (schema.errors.length > 0) {
      throw new Error(`[OpenCodeBridge] Schema validation failed:\n  - ${schema.errors.join('\n  - ')}`)
    }
    this.config = parsed
    this.schemaWarnings = schema.warnings
    this.sessions = new Map()
    this._configSignature = this._computeSignature(parsed)
    this.aiProvider = options.aiProvider || null
    this._storyComponents = { storyPlanner: null, storyDirector: null }
  }

  get ai() {
    if (!this.aiProvider) return null
    if (!this._storyComponents) {
      this._storyComponents = this._initAIComponents()
    }
    return this._storyComponents
  }

  _initAIComponents() {
    return {
      storyPlanner: null,
      storyDirector: null,
    }
  }

  async getStoryPlanner() {
    if (!this.aiProvider) return null
    if (this._storyComponents.storyPlanner) return this._storyComponents.storyPlanner
    try {
      const mod = await import(pathToFileURL(path.join(__dirname, '../ai/StoryPlanner.mjs')).href)
      const Cls = mod.default || Object.values(mod)[0]
      if (Cls) {
        const instance = new Cls(this.aiProvider)
        this._storyComponents.storyPlanner = instance
        return instance
      }
    } catch (e) {
      console.warn(`[OpenCodeBridge] StoryPlanner load failed: ${e.message}`)
    }
    return null
  }

  async getStoryDirector() {
    if (!this.aiProvider) return null
    if (this._storyComponents.storyDirector) return this._storyComponents.storyDirector
    try {
      const mod = await import(pathToFileURL(path.join(__dirname, '../ai/StoryDirector.mjs')).href)
      const Cls = mod.default || Object.values(mod)[0]
      if (Cls) {
        const instance = new Cls(this.aiProvider)
        this._storyComponents.storyDirector = instance
        return instance
      }
    } catch (e) {
      console.warn(`[OpenCodeBridge] StoryDirector load failed: ${e.message}`)
    }
    return null
  }

  async generateVideoPackage(topic, article) {
    const director = await this.getStoryDirector()
    if (!director) throw new Error('No AI provider configured. Set OPENROUTER_API_KEY or pass aiProvider to constructor.')
    return director.plan(article, { targetFormat: 'youtube_shorts' })
  }

  _computeSignature(obj) {
    try {
      const stable = JSON.stringify(
        Object.keys(obj).sort().map(k => [k, Array.isArray(obj[k]) ? obj[k].length : typeof obj[k] === 'object' ? Object.keys(obj[k]).length : obj[k]]),
      )
      let h = 0
      for (let i = 0; i < stable.length; i++) h = (h * 31 + stable.charCodeAt(i)) | 0
      return h
    } catch {
      return 0
    }
  }

  isConfigSameAs(otherConfig) {
    return this._computeSignature(otherConfig) === this._configSignature
  }

  loadAgent(name) {
    const agent = this.config.agents[name]
    if (!agent) throw new Error(`Unknown agent: ${name}. Available: ${Object.keys(this.config.agents).join(', ')}`)
    const content = fs.readFileSync(path.join(ROOT, '.opencode', agent.path), 'utf-8')
    return { name, ...agent, content }
  }

  loadMemory(name) {
    const memPath = this.config.memory[name]
    if (!memPath) throw new Error(`Unknown memory: ${name}. Available: ${Object.keys(this.config.memory).join(', ')}`)
    return fs.readFileSync(path.join(ROOT, '.opencode', memPath), 'utf-8')
  }

  loadWorkflow(name) {
    const wfPath = this.config.workflows[name]
    if (!wfPath) throw new Error(`Unknown workflow: ${name}. Available: ${Object.keys(this.config.workflows).join(', ')}`)
    return fs.readFileSync(path.join(ROOT, '.opencode', wfPath), 'utf-8')
  }

  getPolicies() {
    const policies = {}
    for (const [name, filePath] of Object.entries(this.config.policies)) {
      policies[name] = fs.readFileSync(path.join(ROOT, '.opencode', filePath), 'utf-8')
    }
    return policies
  }

  getSystemContext() {
    return {
      agents: Object.keys(this.config.agents),
      memory: Object.keys(this.config.memory),
      workflows: Object.keys(this.config.workflows),
      policies: Object.keys(this.config.policies),
      approvalRequired: this.config.approval_required,
      dataSources: this.config.data_sources,
    }
  }

  getApprovalLevel(action) {
    if (this.config.approval_required.includes(action)) return 'controlled'
    const autoActions = ['syntax-check', 'read-file', 'search-code', 'analyze-report', 'suggest-improvement', 'update-memory']
    if (autoActions.includes(action)) return 'auto'
    return 'review'
  }

  createSession(context = {}) {
    const id = `oc_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
    const session = {
      id,
      created: new Date().toISOString(),
      context,
      actions: [],
      status: 'active',
    }
    this.sessions.set(id, session)
    return session
  }

  logAction(sessionId, action, result) {
    const session = this.sessions.get(sessionId)
    if (!session) throw new Error(`Session not found: ${sessionId}`)
    session.actions.push({
      action,
      result: typeof result === 'string' ? result.slice(0, 500) : JSON.stringify(result).slice(0, 500),
      timestamp: new Date().toISOString(),
    })
  }

  getSession(sessionId) {
    return this.sessions.get(sessionId)
  }

  getApprovalRequiredActions() {
    return this.config.approval_required
  }

  getIntegrationPoints() {
    return this.config.integration_points
  }

  getAgentNames() {
    return Object.keys(this.config.agents).map(k => ({ id: k, ...this.config.agents[k] }))
  }

  loadAllAgents() {
    const results = []
    for (const name of Object.keys(this.config.agents || {})) {
      try {
        const loaded = this.loadAgent(name)
        results.push({ name, ok: true, contentLen: loaded.content.length })
      } catch (e) {
        results.push({ name, ok: false, error: e.message })
      }
    }
    return results
  }

  loadAllMemory() {
    const results = []
    for (const name of Object.keys(this.config.memory || {})) {
      try {
        const content = this.loadMemory(name)
        results.push({ name, ok: true, contentLen: content.length })
      } catch (e) {
        results.push({ name, ok: false, error: e.message })
      }
    }
    return results
  }

  loadAllWorkflows() {
    const results = []
    for (const name of Object.keys(this.config.workflows || {})) {
      try {
        const content = this.loadWorkflow(name)
        results.push({ name, ok: true, contentLen: content.length })
      } catch (e) {
        results.push({ name, ok: false, error: e.message })
      }
    }
    return results
  }

  loadAllPolicies() {
    try {
      const policies = this.getPolicies()
      return Object.entries(policies).map(([name, content]) => ({ name, ok: true, contentLen: content.length }))
    } catch (e) {
      return [{ name: '*', ok: false, error: e.message }]
    }
  }

  validateIntegrity() {
    const schema = validateConfigSchema(this.config)
    const orphans = detectOrphans(this.config)
    const registrySweep = {
      agents: this.loadAllAgents(),
      memory: this.loadAllMemory(),
      workflows: this.loadAllWorkflows(),
      policies: this.loadAllPolicies(),
    }
    const anyFailed = (arr) => arr.some(x => !x.ok)
    const allFailed =
      anyFailed(registrySweep.agents) ||
      anyFailed(registrySweep.memory) ||
      anyFailed(registrySweep.workflows) ||
      anyFailed(registrySweep.policies)
    return {
      schemaErrors: schema.errors,
      schemaWarnings: [...(this.schemaWarnings || []), ...schema.warnings],
      brokenRegistry: orphans.brokenRegistry,
      orphanedFiles: orphans.orphans,
      registrySweep,
      ok: schema.errors.length === 0 && orphans.brokenRegistry.length === 0 && !allFailed,
      idempotency: {
        configSignature: this._configSignature,
      },
    }
  }

  snapshotForRollback(targetFiles = []) {
    const defaultFiles = [
      '.opencode/system-config.json',
      'src/integration/OpenCodeBridge.mjs',
      'packages/dashboard/routes/opencode.mjs',
    ]
    const files = targetFiles.length > 0 ? targetFiles : defaultFiles
    const snapshot = new Map()
    for (const rel of files) {
      const full = path.join(ROOT, rel)
      if (!fs.existsSync(full)) {
        snapshot.set(rel, { exists: false })
        continue
      }
      try {
        snapshot.set(rel, {
          exists: true,
          content: fs.readFileSync(full, 'utf-8'),
          stat: { size: fs.statSync(full).size, mtimeMs: fs.statSync(full).mtimeMs },
        })
      } catch (e) {
        snapshot.set(rel, { exists: true, error: e.message })
      }
    }
    const restore = (keepLog = true) => {
      const report = []
      for (const [rel, snap] of snapshot.entries()) {
        const full = path.join(ROOT, rel)
        if (!snap.exists) {
          if (fs.existsSync(full)) {
            try { fs.unlinkSync(full); report.push({ file: rel, action: 'deleted', ok: true }) }
            catch (e) { report.push({ file: rel, action: 'deleted', ok: false, error: e.message }) }
          } else {
            report.push({ file: rel, action: 'noop-absent', ok: true })
          }
          continue
        }
        if (snap.error) {
          report.push({ file: rel, action: 'skipped-snapshot-error', ok: false, error: snap.error })
          continue
        }
        try {
          fs.writeFileSync(full, snap.content, 'utf-8')
          report.push({ file: rel, action: 'restored', ok: true, bytes: snap.content.length })
        } catch (e) {
          report.push({ file: rel, action: 'restored', ok: false, error: e.message })
        }
      }
      if (keepLog) {
        const logPath = path.join(ROOT, '.opencode', 'rollback-log.jsonl')
        try {
          const logLine = JSON.stringify({ ts: new Date().toISOString(), report })
          fs.appendFileSync(logPath, `${logLine}\n`)
        } catch { /* ignore logging failure */ }
      }
      return report
    }
    return { snapshotTakenAt: new Date().toISOString(), files: Array.from(snapshot.keys()), restore }
  }

  async runDiagnostics() {
    const integrity = this.validateIntegrity()
    const fileExistence = []
    for (const [name, memPath] of Object.entries(this.config.memory)) {
      const fullPath = path.join(ROOT, '.opencode', memPath)
      fileExistence.push({ type: 'memory', name, exists: fs.existsSync(fullPath), size: fs.existsSync(fullPath) ? fs.statSync(fullPath).size : 0 })
    }
    for (const [name, agent] of Object.entries(this.config.agents)) {
      const fullPath = path.join(ROOT, '.opencode', agent.path)
      fileExistence.push({ type: 'agent', name, exists: fs.existsSync(fullPath), size: fs.existsSync(fullPath) ? fs.statSync(fullPath).size : 0 })
    }
    for (const [name, wfPath] of Object.entries(this.config.workflows)) {
      const fullPath = path.join(ROOT, '.opencode', wfPath)
      fileExistence.push({ type: 'workflow', name, exists: fs.existsSync(fullPath), size: fs.existsSync(fullPath) ? fs.statSync(fullPath).size : 0 })
    }
    for (const [name, polPath] of Object.entries(this.config.policies)) {
      const fullPath = path.join(ROOT, '.opencode', polPath)
      fileExistence.push({ type: 'policy', name, exists: fs.existsSync(fullPath), size: fs.existsSync(fullPath) ? fs.statSync(fullPath).size : 0 })
    }
    return {
      ok: integrity.ok,
      summary: {
        schemaErrors: integrity.schemaErrors.length,
        schemaWarnings: integrity.schemaWarnings.length,
        brokenRegistry: integrity.brokenRegistry.length,
        orphanedFiles: integrity.orphanedFiles.length,
        agentsSweep: { total: integrity.registrySweep.agents.length, failed: integrity.registrySweep.agents.filter(a => !a.ok).length },
        memorySweep: { total: integrity.registrySweep.memory.length, failed: integrity.registrySweep.memory.filter(a => !a.ok).length },
        workflowsSweep: { total: integrity.registrySweep.workflows.length, failed: integrity.registrySweep.workflows.filter(a => !a.ok).length },
        policiesSweep: { total: integrity.registrySweep.policies.length, failed: integrity.registrySweep.policies.filter(a => !a.ok).length },
      },
      files: fileExistence,
      integrity,
    }
  }
}
