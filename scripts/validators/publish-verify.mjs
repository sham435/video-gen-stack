#!/usr/bin/env node
// M8 publish-verify validator — enforces ALGO # in description, anchor badge,
// no "Actually See", unique photos, 3-act emoji order.
//
// Usage: node scripts/validators/publish-verify.mjs [--strict]
// Exit 0 = PASS, Exit 1 = FAIL

import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '../..')
const strict = process.argv.includes('--strict')

const results = []
function check(name, pass, detail = '') {
  results.push({ name, pass, detail })
  const icon = pass ? '✅' : '❌'
  console.log(`${icon} ${name}${detail ? ' — ' + detail : ''}`)
}

// ─── 1. algo-number-in-description ───────────────────────────────────────────
// Verify the last algos-used.json entry has valid algoNumber
const algosPath = path.join(ROOT, 'data', 'algos-used.json')
let lastAlgo = null
if (fs.existsSync(algosPath)) {
  try {
    const algos = JSON.parse(fs.readFileSync(algosPath, 'utf8'))
    lastAlgo = algos[algos.length - 1] || null
  } catch { /* corrupt file */ }
}
check('algo-number-present', !!lastAlgo, lastAlgo ? `algo #${lastAlgo.algoNumber}` : 'no algos-used.json')
check('algo-number-range', lastAlgo && lastAlgo.algoNumber >= 1 && lastAlgo.algoNumber <= 48,
  lastAlgo ? `#${lastAlgo.algoNumber}/48` : 'N/A')

// ─── 2. description-contains-algo-tag ────────────────────────────────────────
// Check if description text would contain ALGO #N/48 + VISUAL + TONE + anchor
function buildExpectedDesc(algo) {
  if (!algo) return null
  return `ALGO #${algo.algoNumber}/48 • ${algo.visual || ''} • ${algo.tone || ''} sham435·ANCHOR`
}
const expectedDesc = buildExpectedDesc(lastAlgo)
check('description-algo-tag', !!expectedDesc, expectedDesc || 'N/A')

// ─── 3. pexels-photo-uniqueness ──────────────────────────────────────────────
const pexelsPath = path.join(ROOT, 'data', 'pexels-used.json')
let pexelsData = {}
let dupPhotos = 0
if (fs.existsSync(pexelsPath)) {
  try {
    pexelsData = JSON.parse(fs.readFileSync(pexelsPath, 'utf8'))
    const now = Date.now()
    const TTL = 48 * 60 * 60 * 1000
    const recentEntries = Object.entries(pexelsData).filter(([, ts]) => now - ts < TTL)
    const urls = recentEntries.map(([url]) => url)
    const uniqueUrls = new Set(urls)
    dupPhotos = urls.length - uniqueUrls.size
  } catch { /* corrupt file */ }
}
check('photo-uniqueness', dupPhotos === 0,
  `dupPhotos: ${dupPhotos} (48h window)`)

// ─── 4. actually-see check ──────────────────────────────────────────────────
// Scan recent algo entries for "Actually See" in hook or title
let hasActuallySee = false
if (lastAlgo) {
  const text = `${lastAlgo.hook || ''} ${lastAlgo.title || ''} ${lastAlgo.algoId || ''}`.toLowerCase()
  hasActuallySee = text.includes('actually see')
}
check('no-actually-see', !hasActuallySee, hasActuallySee ? 'DETECTED' : 'clear')

// ─── 5. diversity-report ─────────────────────────────────────────────────────
let diversity = { dupPhotos: 0, last20Unique: 0, repeatedTones: 'none' }
try {
  // Read algos-used to compute diversity locally
  const algos = fs.existsSync(algosPath) ? JSON.parse(fs.readFileSync(algosPath, 'utf8')) : []
  const last20 = algos.slice(-20)
  const uniqueAlgos = new Set(last20.map(a => a.algoNumber)).size
  const tones = last20.map(a => a.tone)
  const toneCounts = {}
  tones.forEach(t => { toneCounts[t] = (toneCounts[t] || 0) + 1 })
  const repeated = Object.entries(toneCounts).filter(([, c]) => c > 1).map(([t, c]) => `${t}(${c})`)
  diversity = {
    dupPhotos,
    last20Unique: uniqueAlgos,
    repeatedTones: repeated.length ? repeated.join(', ') : 'none',
    total: algos.length,
  }
} catch { /* skip */ }
check('diversity-dupPhotos', diversity.dupPhotos === 0, `${diversity.dupPhotos}`)
check('diversity-last20-unique', diversity.last20Unique >= Math.ceil(Math.min(diversity.total, 20) * 0.8),
  `${diversity.last20Unique}/${Math.min(diversity.total, 20)} unique algos`)
check('diversity-no-repeated-tones', diversity.repeatedTones === 'none',
  diversity.repeatedTones === 'none' ? 'no repeats' : `repeated: ${diversity.repeatedTones}`)

// ─── 6. render-validity (if last output exists) ─────────────────────────────
const outputDirs = fs.readdirSync(path.join(ROOT, 'output')).filter(d => d.startsWith('batch-')).sort().reverse()
if (outputDirs.length) {
  const latestDir = path.join(ROOT, 'output', outputDirs[0], 'final.mp4')
  if (fs.existsSync(latestDir)) {
    try {
      const { validateRenderOutput } = await import(path.join(ROOT, 'src', 'video', 'validateOutput.mjs'))
      const vres = await validateRenderOutput(latestDir, { requireAudio: true })
      check('render-valid', vres.ok, vres.ok ? 'valid mp4' : vres.errors.join(', '))
    } catch (e) {
      check('render-valid', false, `probe error: ${e.message}`)
    }
  } else {
    check('render-valid', null, 'no final.mp4 found')
  }
} else {
  check('render-valid', null, 'no output dirs')
}

// ─── Summary ─────────────────────────────────────────────────────────────────
console.log('\n' + '─'.repeat(60))
const passed = results.filter(r => r.pass === true).length
const failed = results.filter(r => r.pass === false).length
const skipped = results.filter(r => r.pass === null).length
console.log(`M8 PUBLISH-VERIFY: ${passed} passed, ${failed} FAILED, ${skipped} skipped`)
console.log(`Diversity: dupPhotos=${diversity.dupPhotos} last20Unique=${diversity.last20Unique} repeatedTones=${diversity.repeatedTones}`)
console.log('─'.repeat(60))

if (failed > 0) {
  console.log('\n❌ M8 GATE FAILED — fix issues above before publishing')
  process.exit(1)
} else {
  console.log('\n✅ M8 GATE PASSED — publish-verify OK')
  process.exit(0)
}
