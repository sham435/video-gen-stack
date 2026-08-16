import { Router } from 'express'
import { OpenCodeBridge } from '../../../src/integration/OpenCodeBridge.mjs'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
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

// 48-algorithm diversity engine — live list for the dashboard (algo badge on
// covers shows #N/48; this route lets operators audit which combo each story used).
router.get('/api/opencode/algorithms', async (req, res) => {
  try {
    const registry = await getBridge().getAlgorithmList?.()
    if (registry) return res.json({ total: registry.length, algorithms: registry })
    res.status(501).json({ error: 'getAlgorithmList not available on bridge' })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

// M6 diversity dashboard — proves no two videos repeat photo/style/tone in production.
// Photo reuse source: data/pexels-used.json (48h TTL, written by pickDistinctPhoto).
// Algo usage source: data/algos-used.json (written by CoverGenerator.resolveHero).
router.get('/api/opencode/diversity', (req, res) => {
  try {
    const root = path.resolve(__dirname, '..', '..', '..')
    const read = (f) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')) } catch { return {} } }
    const pexels = read(path.join(root, 'data', 'pexels-used.json'))
    const algos = Array.isArray(read(path.join(root, 'data', 'algos-used.json'))) ? read(path.join(root, 'data', 'algos-used.json')) : []

    const photoIds = Object.keys(pexels).map(u => u.match(/photos\/(\d+)/)?.[1]).filter(Boolean)
    const photoCounts = {}
    for (const id of photoIds) photoCounts[id] = (photoCounts[id] || 0) + 1
    const dupPhotos = Object.values(photoCounts).filter(c => c > 1).length

    const last20 = algos.slice(-20)
    const recentAlgoNumbers = last20.map(a => a.algoNumber)
    const toneCounts = {}
    for (const a of last20) toneCounts[a.tone] = (toneCounts[a.tone] || 0) + 1
    const repeatedTones = Object.entries(toneCounts).filter(([, c]) => c > 1).map(([t, c]) => `${t}×${c}`)

    res.json({
      total: 48,
      videos: algos.length,
      used: algos.map(a => ({ n: a.algoNumber, algo: a.algoId, hook: a.hook, visual: a.visual, tone: a.tone, photo: a.photo, at: a.at })),
      last20Algos: recentAlgoNumbers,
      dupPhotos,
      photoCount: photoIds.length,
      last20UniqueAlgos: new Set(recentAlgoNumbers).size,
      repeatedTones: repeatedTones.length ? repeatedTones : 'none',
    })
  } catch (e) {
    res.status(500).json({ error: e.message })
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
