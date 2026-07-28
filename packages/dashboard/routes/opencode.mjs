import { Router } from 'express'
import { OpenCodeBridge } from '../../../src/integration/OpenCodeBridge.mjs'
import fs from 'fs'
import path from 'path'

const router = Router()
const bridge = new OpenCodeBridge()

router.get('/api/opencode/status', (req, res) => {
  res.json(bridge.getSystemContext())
})

router.get('/api/opencode/agents', (req, res) => {
  res.json(bridge.getAgentNames())
})

router.get('/api/opencode/agent/:name', (req, res) => {
  try {
    const agent = bridge.loadAgent(req.params.name)
    res.json({ name: agent.name, capabilities: agent.capabilities, content: agent.content.slice(0, 2000) })
  } catch (e) {
    res.status(404).json({ error: e.message })
  }
})

router.get('/api/opencode/memory/:name', (req, res) => {
  try {
    const content = bridge.loadMemory(req.params.name)
    res.json({ name: req.params.name, content: content.slice(0, 5000) })
  } catch (e) {
    res.status(404).json({ error: e.message })
  }
})

router.get('/api/opencode/workflow/:name', (req, res) => {
  try {
    const content = bridge.loadWorkflow(req.params.name)
    res.json({ name: req.params.name, content: content.slice(0, 5000) })
  } catch (e) {
    res.status(404).json({ error: e.message })
  }
})

router.get('/api/opencode/policies', (req, res) => {
  res.json(bridge.getPolicies())
})

router.get('/api/opencode/diagnostics', async (req, res) => {
  const results = await bridge.runDiagnostics()
  res.json(results)
})

router.post('/api/opencode/session', (req, res) => {
  const session = bridge.createSession(req.body?.context || {})
  res.json(session)
})

router.get('/api/opencode/session/:id', (req, res) => {
  const session = bridge.getSession(req.params.id)
  if (!session) return res.status(404).json({ error: 'Session not found' })
  res.json(session)
})

router.get('/api/opencode/approval-required', (req, res) => {
  res.json(bridge.getApprovalRequiredActions())
})

router.post('/api/opencode/check-approval', (req, res) => {
  const { action } = req.body || {}
  if (!action) return res.status(400).json({ error: 'action required' })
  res.json({ action, level: bridge.getApprovalLevel(action) })
})

router.get('/api/opencode/memory/architecture', (req, res) => {
  const archPath = path.resolve('memory/brand')
  const files = fs.existsSync(archPath) ? fs.readdirSync(archPath).map(f => ({ name: f, path: path.join(archPath, f) })) : []
  res.json({
    opencode: bridge.getSystemContext(),
    brand: files,
  })
})

export default router