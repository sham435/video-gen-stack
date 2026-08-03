/**
 * AI Pipeline Manager — API Routes
 *
 * GET  /api/ai/health       — Health check status
 * GET  /api/ai/suggestions  — Stack enhancement suggestions
 * GET  /api/ai/debug        — Last debug report
 * POST /api/ai/run          — Trigger AI helper (debug/enhance/full)
 */

import express from 'express'
import { spawn } from 'child_process'
import fs from 'fs'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(__dirname, '..', '..', '..')
const OUTPUT = resolve(ROOT, 'output')

const router = express.Router()

function runHelper(mode) {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn('node', [resolve(ROOT, '.github/scripts/ai-helper.mjs'), mode], {
      cwd: ROOT,
      stdio: 'pipe',
    })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', d => { stdout += d })
    child.stderr.on('data', d => { stderr += d })
    const killTimer = setTimeout(() => child.kill('SIGKILL'), 30000)
    child.on('close', code => {
      clearTimeout(killTimer)
      if (code === 0) return resolvePromise(stdout)
      rejectPromise(new Error(`ai-helper exited ${code}: ${stderr.slice(-400)}`))
    })
    child.on('error', err => {
      clearTimeout(killTimer)
      rejectPromise(err)
    })
  })
}

/**
 * GET /api/ai/health
 * Returns live health status of all pipeline components.
 */
router.get('/health', (req, res) => {
  const checks = [
    { name: 'PEXELS_API_KEY', ok: !!process.env.PEXELS_API_KEY },
    { name: 'NEWSAPI_KEY', ok: !!process.env.NEWSAPI_KEY },
    { name: 'YOUTUBE_REFRESH_TOKEN', ok: !!process.env.YOUTUBE_REFRESH_TOKEN },
    { name: 'Intro audio', ok: fs.existsSync(resolve(ROOT, 'assets/music/intro_whoosh.mp3')) },
    { name: 'Background music', ok: fs.existsSync(resolve(ROOT, 'assets/music/lofi1.mp3')) || fs.existsSync(resolve(ROOT, 'assets/music')) },
    { name: 'Anton font', ok: fs.existsSync(resolve(ROOT, 'assets/fonts/Anton-Regular.ttf')) },
    { name: 'composer.mjs', ok: fs.existsSync(resolve(ROOT, 'scripts/composer.mjs')) },
    { name: 'Database', ok: fs.existsSync(resolve(ROOT, 'data/newsroom.db')) },
  ]
  const score = Math.round(checks.filter(c => c.ok).length / checks.length * 100)
  res.json({
    channel: 'NEWS-MONSTER',
    anchor: 'sham435',
    score,
    checks,
    timestamp: new Date().toISOString(),
  })
})

/**
 * GET /api/ai/suggestions
 * Returns latest enhancement suggestions from AI scanner.
 * Runs the scanner on demand if no cached report exists.
 */
router.get('/suggestions', async (req, res) => {
  const cachePath = resolve(OUTPUT, 'ai_suggestions.json')

  // Re-run if cache is older than 1 hour
  const needsRefresh = !fs.existsSync(cachePath) ||
    (Date.now() - fs.statSync(cachePath).mtimeMs) > 3600000

  if (needsRefresh) {
    try {
      await runHelper('enhance')
    } catch (e) {
      // Use cached if available
      if (!fs.existsSync(cachePath)) {
        return res.status(500).json({ error: e.message })
      }
    }
  }

  try {
    const data = JSON.parse(fs.readFileSync(cachePath, 'utf8'))
    res.json({ suggestions: data, timestamp: new Date().toISOString() })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

/**
 * GET /api/ai/debug
 * Returns the last debug report from AI helper.
 */
router.get('/debug', (req, res) => {
  const debugPath = resolve(OUTPUT, 'ai_debug.json')
  if (!fs.existsSync(debugPath)) {
    return res.json({ message: 'No debug report yet — run happens after a failed publish' })
  }
  try {
    const data = JSON.parse(fs.readFileSync(debugPath, 'utf8'))
    res.json(data)
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

/**
 * POST /api/ai/run
 * Trigger AI helper on demand.
 * Body: { mode: "debug" | "enhance" | "health" | "full" }
 */
router.post('/run', async (req, res) => {
  const mode = req.body?.mode || 'health'
  const validModes = ['debug', 'enhance', 'health', 'full']

  if (!validModes.includes(mode)) {
    return res.status(400).json({ error: `Invalid mode. Use: ${validModes.join(', ')}` })
  }

  try {
    await runHelper(mode)

    // Return the relevant report
    const reportPath = resolve(OUTPUT, `ai_${mode === 'full' ? 'debug' : mode}.json`)
    const report = fs.existsSync(reportPath) ? JSON.parse(fs.readFileSync(reportPath, 'utf8')) : {}

    res.json({ mode, status: 'complete', report, timestamp: new Date().toISOString() })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

export default router
