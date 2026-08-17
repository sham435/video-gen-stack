#!/usr/bin/env node
/**
 * verify-m10 — validates M10 auto-pipeline components
 *
 * Checks:
 * 1. cron-pipeline.mjs exists + syntax OK
 * 2. top-algos.mjs route exists + syntax OK
 * 3. algos-used.json has entries
 * 4. Cron workflow exists with 30min schedule
 * 5. No "Actually See" in algo history
 * 6. Diversity: last 20 has >1 unique algo
 * 7. PublishingEnhancer produces hashtags + CTA
 * 8. Dashboard route wired into index.mjs
 */

import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { execSync } from 'child_process'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname)
let pass = 0, fail = 0

function check(label, ok, detail = '') {
  if (ok) { pass++; console.log(`✅ ${label}${detail ? ' — ' + detail : ''}`) }
  else { fail++; console.log(`❌ ${label}${detail ? ' — ' + detail : ''}`) }
}

console.log('=== M10 Verify ===\n')

// 1. cron-pipeline.mjs
const cronPath = path.join(ROOT, 'scripts', 'cron-pipeline.mjs')
check('cron-pipeline.mjs exists', fs.existsSync(cronPath))
if (fs.existsSync(cronPath)) {
  try { execSync(`node --check "${cronPath}"`, { stdio: 'pipe' }); check('cron-pipeline.mjs syntax', true) }
  catch (e) { check('cron-pipeline.mjs syntax', false, e.stderr?.toString().split('\n')[0] || e.message) }
}

// 2. top-algos.mjs route
const topAlgosPath = path.join(ROOT, 'packages', 'dashboard', 'routes', 'top-algos.mjs')
check('top-algos.mjs exists', fs.existsSync(topAlgosPath))
if (fs.existsSync(topAlgosPath)) {
  try { execSync(`node --check "${topAlgosPath}"`, { stdio: 'pipe' }); check('top-algos.mjs syntax', true) }
  catch (e) { check('top-algos.mjs syntax', false, e.stderr?.toString().split('\n')[0] || e.message) }
}

// 3. algos-used.json has entries
const algosPath = path.join(ROOT, 'data', 'algos-used.json')
let algoHistory = []
try { algoHistory = JSON.parse(fs.readFileSync(algosPath, 'utf8')) } catch {}
check('algos-used.json has entries', algoHistory.length > 0, `${algoHistory.length} entries`)

// 4. Cron workflow exists with */30 schedule
const cronYml = path.join(ROOT, '.github', 'workflows', 'publish-news.yml')
let hasCron = false
if (fs.existsSync(cronYml)) {
  const content = fs.readFileSync(cronYml, 'utf8')
  hasCron = content.includes('*/30')
}
check('GitHub Actions cron 30min schedule', hasCron)

// 5. No "Actually See" in algo history
const hasActuallySee = algoHistory.some(e =>
  (e.title || '').toLowerCase().includes('actually see')
)
check('No "Actually See" in algo history', !hasActuallySee)

// 6. Diversity: last 20 has >1 unique algo
const last20 = algoHistory.slice(-20)
const uniqueAlgos = new Set(last20.map(e => e.algoNumber))
check('Diversity: last 20 unique > 1', uniqueAlgos.size > 1, `${uniqueAlgos.size}/20 unique`)

// 7. PublishingEnhancer produces hashtags + CTA
try {
  const { PublishingEnhancer } = await import('./src/publishing/PublishingEnhancer.mjs')
  const testAlgo = { number: 1, hook: 'NOBODY_EXPECTED', arc: 'RAIN_SHELTER_LOVE', visual: { id: 'STUDIO_NOIR' }, tone: { id: 'ANCHOR_EMPATHY' }, niche: 'test' }
  const enhanced = PublishingEnhancer.enhance({ title: 'Test headline', category: 'technology', source: 'Test', algorithm: testAlgo })
  check('PublishingEnhancer hashtags', enhanced.hashtags?.length >= 10, `${enhanced.hashtags?.length} hashtags`)
  check('PublishingEnhancer CTA', !!enhanced.pinnedComment, enhanced.pinnedComment?.slice(0, 60))
  check('PublishingEnhancer fullDescription', !!enhanced.fullDescription, `${enhanced.fullDescription?.length} chars`)
} catch (e) {
  check('PublishingEnhancer', false, e.message)
}

// 8. Dashboard route wired
const dashIndex = path.join(ROOT, 'packages', 'dashboard', 'index.mjs')
const dashContent = fs.readFileSync(dashIndex, 'utf8')
check('Dashboard wired top-algos', dashContent.includes('top-algos'))

// Summary
console.log(`\n${'='.repeat(40)}`)
console.log(`M10: ${pass} pass, ${fail} fail`)
console.log(`${'='.repeat(40)}`)

process.exit(fail > 0 ? 1 : 0)
