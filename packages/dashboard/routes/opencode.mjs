import { Router } from 'express'
import { OpenCodeBridge } from '../../../src/integration/OpenCodeBridge.mjs'
import fs from 'fs'
import path from 'path'

const router = Router()
let _bridge = null
function getBridge() {
  if (!_bridge) _bridge = new OpenCodeBridge()
  return _bridge
}

router.get('/api/opencode/status', (req, res) => {
  res.json(getBridge().getSystemContext())
})

router.get('/api/opencode/agents', (req, res) => {
  res.json(getBridge().getAgentNames())
})

router.get('/api/opencode/agent/:name', (req, res) => {
  try {
    const agent = getBridge().loadAgent(req.params.name)
    res.json({ name: agent.name, capabilities: agent.capabilities, content: agent.content.slice(0, 2000) })
  } catch (e) {
    res.status(404).json({ error: e.message })
  }
})

router.get('/api/opencode/memory/:name', (req, res) => {
  try {
    const content = getBridge().loadMemory(req.params.name)
    res.json({ name: req.params.name, content: content.slice(0, 5000) })
  } catch (e) {
    res.status(404).json({ error: e.message })
  }
})

router.get('/api/opencode/workflow/:name', (req, res) => {
  try {
    const content = getBridge().loadWorkflow(req.params.name)
    res.json({ name: req.params.name, content: content.slice(0, 5000) })
  } catch (e) {
    res.status(404).json({ error: e.message })
  }
})

router.get('/api/opencode/policies', (req, res) => {
  res.json(getBridge().getPolicies())
})

router.get('/api/opencode/skills', (req, res) => {
  res.json(getBridge().getSkills())
})

router.get('/api/opencode/skill/:name', (req, res) => {
  try {
    const content = getBridge().loadSkill(req.params.name)
    res.json({ name: req.params.name, content: content.slice(0, 5000) })
  } catch (e) {
    res.status(404).json({ error: e.message })
  }
})

router.get('/api/opencode/diagnostics', async (req, res) => {
  const results = await getBridge().runDiagnostics()
  res.json(results)
})

router.post('/api/opencode/session', (req, res) => {
  const session = getBridge().createSession(req.body?.context || {})
  res.json(session)
})

router.get('/api/opencode/session/:id', (req, res) => {
  const session = getBridge().getSession(req.params.id)
  if (!session) return res.status(404).json({ error: 'Session not found' })
  res.json(session)
})

router.get('/api/opencode/approval-required', (req, res) => {
  res.json(getBridge().getApprovalRequiredActions())
})

router.post('/api/opencode/check-approval', (req, res) => {
  const { action } = req.body || {}
  if (!action) return res.status(400).json({ error: 'action required' })
  res.json({ action, level: getBridge().getApprovalLevel(action) })
})

router.get('/api/opencode/memory/architecture', (req, res) => {
  const archPath = path.resolve('memory/brand')
  const files = fs.existsSync(archPath) ? fs.readdirSync(archPath).map(f => ({ name: f, path: path.join(archPath, f) })) : []
  res.json({
    opencode: getBridge().getSystemContext(),
    brand: files,
  })
})

export default router
