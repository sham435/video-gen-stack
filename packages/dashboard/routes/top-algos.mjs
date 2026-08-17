/**
 * M10 Dashboard Routes — /api/opencode/top-algos + /api/opencode/cron-status
 *
 * Shows which of 48 algos drives the most engagement, top niches with
 * millionPotential, breakdown hooks/visuals/tones, diversity last 20.
 */

import { Router } from 'express'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..', '..', '..')
const router = Router()

function loadJson(p, fallback = []) {
  try { return JSON.parse(fs.readFileSync(p, 'utf8')) } catch { return fallback }
}

// GET /api/opencode/top-algos — top 10 algos by usage count + diversity stats
router.get('/api/opencode/top-algos', (req, res) => {
  const algoHistory = loadJson(path.join(ROOT, 'data', 'algos-used.json'))

  // Count per algo number
  const counts = {}
  const hooks = {}
  const visuals = {}
  const tones = {}
  const niches = {}

  for (const entry of algoHistory) {
    const n = entry.algoNumber
    counts[n] = (counts[n] || 0) + 1
    if (entry.hook) hooks[entry.hook] = (hooks[entry.hook] || 0) + 1
    if (entry.visual) visuals[entry.visual] = (visuals[entry.visual] || 0) + 1
    if (entry.tone) tones[entry.tone] = (tones[entry.tone] || 0) + 1
    if (entry.niche) {
      if (!niches[entry.niche]) niches[entry.niche] = { count: 0, algoNumbers: [] }
      niches[entry.niche].count++
      niches[entry.niche].algoNumbers.push(n)
    }
  }

  // Top 10 algos sorted by count
  const topAlgos = Object.entries(counts)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 10)
    .map(([num, count]) => ({
      algoNumber: Number(num),
      count,
      millionPotential: count * 100000,
    }))

  // Top niches by count
  const topNiches = Object.entries(niches)
    .sort(([, a], [, b]) => b.count - a.count)
    .slice(0, 10)
    .map(([niche, data]) => ({
      niche,
      count: data.count,
      millionPotential: data.count * 100000,
      algoNumbers: [...new Set(data.algoNumbers)].sort((a, b) => a - b),
    }))

  // Diversity — last 20 unique
  const last20 = algoHistory.slice(-20)
  const last20Unique = new Set(last20.map(e => e.algoNumber)).size

  // Sorting helpers
  const sortObj = (obj) => Object.entries(obj).sort(([, a], [, b]) => b - a)

  res.json({
    totalRuns: algoHistory.length,
    topAlgos,
    topNiches,
    breakdown: {
      hooks: sortObj(hooks),
      visuals: sortObj(visuals),
      tones: sortObj(tones),
    },
    diversity: {
      last20Unique,
      last20Total: last20.length,
      uniqueRatio: last20.length > 0 ? (last20Unique / last20.length).toFixed(2) : '0',
    },
  })
})

// GET /api/opencode/cron-status — last pipeline run info
router.get('/api/opencode/cron-status', (req, res) => {
  const algoHistory = loadJson(path.join(ROOT, 'data', 'algos-used.json'))
  const lastEntry = algoHistory[algoHistory.length - 1]

  res.json({
    lastRun: lastEntry ? new Date(lastEntry.at).toISOString() : null,
    lastAlgo: lastEntry ? `#${lastEntry.algoNumber}/48` : null,
    lastTitle: lastEntry?.title || null,
    totalRuns: algoHistory.length,
    status: lastEntry ? 'healthy' : 'no-data',
    schedule: '*/30 * * * *',
    hideBrandingSupported: true,
  })
})

export default router
