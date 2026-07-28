import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '../..')
const CONFIG_PATH = path.join(ROOT, '.opencode/opencode.json')

export class OpenCodeBridge {
  constructor() {
    this.config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8'))
    this.sessions = new Map()
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

  async runDiagnostics() {
    const results = []
    for (const [name, memPath] of Object.entries(this.config.memory)) {
      const fullPath = path.join(ROOT, '.opencode', memPath)
      results.push({ type: 'memory', name, exists: fs.existsSync(fullPath), size: fs.existsSync(fullPath) ? fs.statSync(fullPath).size : 0 })
    }
    for (const [name, agent] of Object.entries(this.config.agents)) {
      const fullPath = path.join(ROOT, '.opencode', agent.path)
      results.push({ type: 'agent', name, exists: fs.existsSync(fullPath), size: fs.existsSync(fullPath) ? fs.statSync(fullPath).size : 0 })
    }
    for (const [name, wfPath] of Object.entries(this.config.workflows)) {
      const fullPath = path.join(ROOT, '.opencode', wfPath)
      results.push({ type: 'workflow', name, exists: fs.existsSync(fullPath), size: fs.existsSync(fullPath) ? fs.statSync(fullPath).size : 0 })
    }
    for (const [name, polPath] of Object.entries(this.config.policies)) {
      const fullPath = path.join(ROOT, '.opencode', polPath)
      results.push({ type: 'policy', name, exists: fs.existsSync(fullPath), size: fs.existsSync(fullPath) ? fs.statSync(fullPath).size : 0 })
    }
    return results
  }
}