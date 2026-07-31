#!/usr/bin/env node
/**
 * Hot-Reload Dev Mode — NEWS-MONSTER | anchor: sham435
 *
 * Watches scripts/ and packages/ for changes, auto-restarts the pipeline.
 * Also starts the dashboard and API server alongside.
 *
 * Usage:
 *   node scripts/dev.mjs                  # Full dev mode: watcher + dashboard
 *   node scripts/dev.mjs --composer       # Watch + restart composer only
 *   node scripts/dev.mjs --dashboard      # Dashboard only (port 3456)
 *   node scripts/dev.mjs --api            # API server only (port 3001)
 *   node scripts/dev.mjs --health         # One-shot health check
 */

import { watch } from 'fs'
import { spawn } from 'child_process'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'
import { existsSync, mkdirSync } from 'fs'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(__dirname, '..')

const args = process.argv.slice(2)
const flags = new Set(args.filter(a => a.startsWith('--')))

const WATCH_DIRS = [
  resolve(ROOT, 'scripts'),
  resolve(ROOT, 'packages'),
  resolve(ROOT, '.github/scripts'),
  resolve(ROOT, 'assets/fonts'),
]

let child = null
let debounceTimer = null
const DEBOUNCE_MS = 1000

function log(tag, msg) {
  const t = new Date().toLocaleTimeString()
  console.log(`[${t}] ${tag} ${msg}`)
}

function spawnNode(script, label) {
  if (child) { child.kill(); child = null }
  log('🚀', `starting: ${label}`)
  child = spawn('node', ['--watch', script], { cwd: ROOT, stdio: 'inherit' })
  child.on('exit', (code) => {
    if (code !== null && ![0, 143].includes(code)) log('⚠️', `${label} exited (${code})`)
  })
  return child
}

function watchAndRestart(changedFile) {
  if (debounceTimer) clearTimeout(debounceTimer)
  debounceTimer = setTimeout(() => {
    log('🔄', `change detected: ${changedFile || '?'}`)
    const target = flags.has('--intro') ? 'intro.mjs' : 'composer.mjs'
    const scriptPath = resolve(ROOT, 'scripts', target)
    if (existsSync(scriptPath)) spawnNode(scriptPath, target)
  }, DEBOUNCE_MS)
}

function startWatcher() {
  const seen = new Set()
  for (const dir of WATCH_DIRS) {
    if (!existsSync(dir)) continue
    watch(dir, { recursive: true }, (event, filename) => {
      if (!filename || filename.startsWith('.')) return
      const ext = filename.split('.').pop()
      if (!['mjs', 'js', 'json', 'ttf', 'css'].includes(ext)) return
      const key = `${dir}/${filename}`
      if (seen.has(key)) return; seen.add(key)
      setTimeout(() => seen.delete(key), 2000)
      watchAndRestart(filename)
    })
  }
  log('👀', `watching ${WATCH_DIRS.length} dirs, ${WATCH_DIRS.filter(d => existsSync(d)).length} active`)

  // Initial run
  const target = flags.has('--intro') ? 'intro.mjs' : 'composer.mjs'
  const scriptPath = resolve(ROOT, 'scripts', target)
  if (existsSync(scriptPath)) spawnNode(scriptPath, target)
}

// ═══════════════════════════════════════
// MAIN
// ═══════════════════════════════════════

console.log(`
╔═══════════════════════════════════════════╗
║   NEWS-MONSTER Dev Hot-Reload            ║
║───────────────────────────────────────────║
║  Commands:                               ║
║  node scripts/dev.mjs                    ║
║    → Watch files + auto-restart composer ║
║  node scripts/dev.mjs --intro            ║
║    → Watch + rebuild intro only          ║
║  node scripts/dev.mjs --dashboard        ║
║    → Start admin dashboard at :3456      ║
║  node scripts/dev.mjs --api              ║
║    → Start API server at :3001           ║
║  node scripts/dev.mjs --health           ║
║    → One-shot health check               ║
║───────────────────────────────────────────║
║  npm run broadcast      News broadcast   ║
║  npm run dev:hot        Watch mode       ║
║  npm run dashboard      Admin UI         ║
║  npm run api            API server       ║
╚═══════════════════════════════════════════╝
`)

mkdirSync(resolve(ROOT, 'output'), { recursive: true })

if (flags.has('--dashboard')) {
  spawnNode(resolve(ROOT, 'packages/dashboard/index.mjs'), 'dashboard')
} else if (flags.has('--api')) {
  spawnNode(resolve(ROOT, 'apps/api/server.js'), 'API server')
} else if (flags.has('--health')) {
  spawnNode(resolve(ROOT, '.github/scripts/ai-helper.mjs'), 'ai-helper health')
} else {
  startWatcher()
}
