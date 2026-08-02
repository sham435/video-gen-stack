import { Router } from 'express'
import { RepoAgentTools } from '../../../src/integration/RepoAgentTools.mjs'

const router = Router()
const tools = new RepoAgentTools()

router.get('/api/opencode/tools', (req, res) => {
  res.json({ workspace: tools.root, tools: tools.registry() })
})

router.post('/api/opencode/tool', (req, res) => {
  const { name, args } = req.body || {}
  if (!name) return res.status(400).json({ ok: false, error: 'tool name required' })
  const result = tools.execute(name, args || {})
  if (!result.ok && result.error) return res.status(400).json(result)
  res.json(result)
})

export default router
