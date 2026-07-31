import fs from 'node:fs'
import child_process from 'node:child_process'
import path from 'node:path'
import crypto from 'node:crypto'

export const metadata = {
  name: 'schema',
  version: '1.1.0',
  dependsOn: [],
  provides: ['bridge', 'configHash', 'configSignature'],
  group: 'schema',
  description: 'Parse system-config.json, syntax-check bridge + dashboard, construct bridge instance, compute config hashes',
}

export default function (ctx) {
  const r = ctx.results
  const opts = ctx.opts
  const ROOT = ctx.root
  const CONFIG_PATH = path.join(ROOT, '.opencode/system-config.json')
  const BRIDGE_PATH = path.join(ROOT, 'src/integration/OpenCodeBridge.mjs')
  const DASHBOARD_PATH = path.join(ROOT, 'packages/dashboard/routes/opencode.mjs')

  // syntax
  for (const [label, abs] of [
    ['system-config.json JSON syntax', CONFIG_PATH, 'json'],
    ['OpenCodeBridge.mjs syntax', BRIDGE_PATH, 'js'],
    ['opencode.mjs dashboard syntax', DASHBOARD_PATH, 'js'],
  ]) {
    try {
      if (abs.endsWith('.json')) {
        JSON.parse(fs.readFileSync(abs, 'utf-8'))
        r.add('schema', label, 'INFO', true)
      } else {
        child_process.execFileSync('node', ['--check', abs], { stdio: 'pipe' })
        r.add('schema', label, 'INFO', true)
      }
    } catch (e) {
      const detail = abs.endsWith('.json') ? e.message : ((e.stderr || '').toString('utf8').slice(0, 200) || e.message)
      r.add('schema', label, 'CRITICAL', false, detail)
    }
  }

  // constructor + schemaWarnings
  try {
    const t0 = performance.now()
    const b = new ctx.modules.bridge.OpenCodeBridge()
    const t1 = performance.now()
    r.perf.record('constructor', t1 - t0)
    r.add('schema', 'bridge constructor runs (no throw)', 'INFO', true)
    if (b.schemaWarnings && b.schemaWarnings.length > 0) {
      r.add('schema', `bridge schemaWarnings (${b.schemaWarnings.length})`, 'WARNING', false, b.schemaWarnings.join(' | '))
    } else {
      r.add('schema', 'bridge schemaWarnings = 0', 'INFO', true)
    }
    ctx.setBridge(b)
  } catch (e) {
    r.add('schema', 'bridge constructor runs (no throw)', 'CRITICAL', false, e.message)
    ctx.setBridge(null)
  }

  // sha256 of config for snapshot signing
  try {
    const raw = fs.readFileSync(CONFIG_PATH)
    const hash = crypto.createHash('sha256').update(raw).digest('hex').slice(0, 16)
    ctx.state.configHash = hash
  } catch (_) { /* ignore */ }
}
