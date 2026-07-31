#!/usr/bin/env node
import path from 'node:path'
import fs from 'node:fs'
import { fileURLToPath, pathToFileURL } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..')

const SEV_ORDER = Object.freeze({
  INFO: 0,
  NOTICE: 1,
  WARNING: 2,
  ERROR: 3,
  CRITICAL: 4,
})
const SEV_GLYPH = Object.freeze({ INFO: 'ℹ', NOTICE: '▪', WARNING: '!', ERROR: '✗', CRITICAL: '✖' })

class PerfRecorder {
  constructor() { this.data = { __runStart: performance.now() } }
  record(name, ms) { this.data[name] = ms }
  records() { return { ...this.data } }
}

class ResultSet {
  constructor() {
    this.groups = {}
    this.depGraph = null
    this.perf = new PerfRecorder()
  }
  ensureGroup(groupName) {
    if (!this.groups[groupName]) this.groups[groupName] = []
    return this.groups[groupName]
  }
  add(groupName, what, severity, passed, detail) {
    if (typeof SEV_ORDER[severity] !== 'number') {
      console.warn(`[validator] unknown severity "${severity}" on ${groupName}/${what}; treating as ERROR`)
      severity = 'ERROR'
    }
    this.ensureGroup(groupName).push({ what, severity, passed: !!passed, detail })
  }
  addDepGraphTable(rows) { this.depGraph = rows }
  maxSeverity() {
    let max = -1
    for (const g of Object.values(this.groups)) {
      for (const r of g) max = Math.max(max, SEV_ORDER[r.severity] ?? -1)
    }
    return max
  }
  summary() {
    const out = []
    for (const [gname, items] of Object.entries(this.groups)) {
      const maxSev = items.reduce((m, r) => Math.max(m, SEV_ORDER[r.severity]), -1)
      const sevKey = Object.keys(SEV_ORDER).find(k => SEV_ORDER[k] === maxSev) || 'INFO'
      const counts = { INFO: 0, NOTICE: 0, WARNING: 0, ERROR: 0, CRITICAL: 0 }
      for (const r of items) counts[r.severity] = (counts[r.severity] || 0) + 1
      out.push({
        name: gname,
        level: sevKey,
        items,
        counts,
        hasFail: maxSev >= SEV_ORDER.ERROR,
        hasWarn: maxSev >= SEV_ORDER.WARNING && maxSev < SEV_ORDER.ERROR,
      })
    }
    return out
  }
  exitCode() {
    const m = this.maxSeverity()
    if (m <= 1) return 0
    if (m === 2) return 1
    return 2
  }
}

const bridgeImport = import(pathToFileURL(path.join(ROOT, 'src/integration/OpenCodeBridge.mjs')).href)

function resolvePluginList(config) {
  const declared = config && config.validation_schemas && config.validation_schemas.plugin_paths
  if (Array.isArray(declared) && declared.length > 0) return declared
  return [
    'scripts/validators/schema.js',
    'scripts/validators/registry.js',
    'scripts/validators/bridge.js',
    'scripts/validators/dashboard.js',
    'scripts/validators/depgraph.js',
    'scripts/validators/rollback.js',
    'scripts/validators/performance.js',
    'scripts/validators/api-stability.js',
    'scripts/validators/mutation.js',
  ]
}

function wantGroup(args, pluginGroup, config) {
  const wantAll = args.has('--all') || args.has('--all-and-mutation') || args.size === 0 || (args.size === 1 && (args.has('--json') || args.has('--format=json')))
  if (wantAll) return true
  const aliases = (config && config.validation_schemas && config.validation_schemas.plugin_group_aliases) || {
    schema: ['schema'],
    registry: ['schema', 'registry'],
    smoke: ['schema', 'bridge', 'dashboard'],
    depgraph: ['schema', 'registry', 'depgraph'],
    rollback: ['schema', 'bridge', 'rollback'],
    performance: ['schema', 'bridge', 'dashboard', 'registry', 'performance'],
    perf: ['schema', 'bridge', 'dashboard', 'registry', 'performance'],
    api: ['schema', 'bridge', 'api-stability'],
    mutation: ['schema', 'bridge', 'mutation'],
  }
  for (const [arg, groups] of Object.entries(aliases)) {
    if (args.has('--' + arg) && groups.includes(pluginGroup)) return true
  }
  if (args.has('--schema-only') && pluginGroup === 'schema') return true
  return false
}

async function loadConfig() {
  try {
    const raw = fs.readFileSync(path.join(ROOT, '.opencode/system-config.json'), 'utf-8')
    return JSON.parse(raw)
  } catch (e) {
    console.error(`[validator] Cannot read system-config.json: ${e.message}`)
    return null
  }
}

function printHuman(summary, depGraphRows, signedSnapshot) {
  for (const g of summary) {
    const icon = g.hasFail ? '❌' : g.hasWarn ? '⚠️ ' : '✅'
    console.log(`\n${icon}  ${g.name.toUpperCase()} (${g.level})`)
    for (const r of g.items) {
      const glyph = r.passed ? '✓' : (SEV_GLYPH[r.severity] ?? '•')
      const extra = r.detail ? ` — ${typeof r.detail === 'object' ? JSON.stringify(r.detail) : String(r.detail)}` : ''
      console.log(`   ${glyph} ${r.what}${extra}`)
    }
  }

  if (depGraphRows && depGraphRows.length > 0) {
    console.log('\n   DEP-GRAPH TABLE (S12 safeguard, data-driven from validation_schemas.resource_kinds)')
    console.log('   ' + '-'.repeat(120))
    for (const row of depGraphRows) {
      const glyphs = row.checks.map(c => (c.ok ? '✓' : '✗')).join(' ')
      const label = `[${row.result}] ${row.kind}s/${row.name}`
      console.log(`   ${label.padEnd(52)}${glyphs}`)
      if (row.result !== 'PASS') {
        for (const c of row.checks.filter(x => !x.ok)) console.log(`        fail step: ${c.label}${c.detail ? ' — ' + JSON.stringify(c.detail) : ''}`)
      }
    }
    console.log('   ' + '-'.repeat(120))
  }

  if (signedSnapshot) {
    console.log('\n🔐  Signed Snapshot (for exact rollback)')
    console.log(`   takenAt:         ${signedSnapshot.takenAt}`)
    console.log(`   configHash:      ${signedSnapshot.configHash}`)
    console.log(`   configSignature: ${signedSnapshot.configSignature}`)
    console.log(`   signature:       ${signedSnapshot.signature}`)
    if (signedSnapshot.contentHashes) {
      console.log(`   contentHashes:`)
      for (const [f, h] of Object.entries(signedSnapshot.contentHashes)) console.log(`     ${f}: ${h}`)
    }
  }

  console.log('\n========== SUMMARY ==========')
  let maxSev = -1
  for (const g of summary) {
    const sevNum = SEV_ORDER[g.level] ?? 0
    maxSev = Math.max(maxSev, sevNum)
    const counts = g.counts
    const label = `INFO:${counts.INFO} / NOTICE:${counts.NOTICE} / WARNING:${counts.WARNING} / ERROR:${counts.ERROR} / CRITICAL:${counts.CRITICAL}`
    console.log(`   ${g.name.padEnd(12)} ${g.level.padEnd(8)} (${label})`)
  }
  const maxKey = Object.keys(SEV_ORDER).find(k => SEV_ORDER[k] === maxSev) || 'INFO'
  console.log(`\n   max severity: ${maxKey}`)
}

async function mainAsync(args) {
  const asJson = args.has('--json') || args.has('--format=json')
  const config = await loadConfig()
  const results = new ResultSet()
  const bridge = await bridgeImport.catch(e => { console.error('bridge import failed:', e.message); return null })
  const ctx = {
    root: ROOT,
    opts: args,
    results,
    state: {},
    modules: { bridge },
    setBridge(b) { ctx.bridge = b },
    bridge: null,
  }

  const plugins = resolvePluginList(config).filter(p => {
    const groupName = path.basename(p, path.extname(p))
    return wantGroup(args, groupName, config)
  })

  for (const rel of plugins) {
    const full = path.join(ROOT, rel)
    if (!fs.existsSync(full)) {
      results.add('orchestration', `plugin not found at ${rel}`, 'WARNING', false)
      continue
    }
    try {
      const mod = await import(pathToFileURL(full).href)
      const fn = (mod && mod.default) ? mod.default : (typeof mod === 'function' ? mod : null)
      if (!fn) {
        results.add('orchestration', `plugin ${rel} has no default export`, 'WARNING', false)
        continue
      }
      const ret = fn(ctx)
      if (ret && typeof ret.then === 'function') await ret
    } catch (e) {
      results.add('orchestration', `plugin ${rel} threw`, 'CRITICAL', false, `${e.message}\n${e.stack && e.stack.split('\n').slice(0, 2).join('\n')}`)
    }
  }

  const summaryList = results.summary()
  const depGraphRows = results.depGraph
  const signedSnapshot = ctx.state.signedSnapshot || null
  if (asJson) {
    const maxSev = results.maxSeverity()
    const maxKey = Object.keys(SEV_ORDER).find(k => SEV_ORDER[k] === maxSev) || 'INFO'
    const out = {
      generatedAt: new Date().toISOString(),
      root: ROOT,
      severityLevels: SEV_ORDER,
      maxSeverity: maxKey,
      exitCode: results.exitCode(),
      pluginOrder: plugins,
      pluginGroups: summaryList.map(g => ({
        name: g.name, level: g.level, counts: g.counts, hasFail: g.hasFail, hasWarn: g.hasWarn,
        items: g.items.map(it => ({ what: it.what, severity: it.severity, passed: it.passed, detail: it.detail ?? undefined })),
      })),
    }
    if (depGraphRows && depGraphRows.length > 0) {
      out.depGraph = depGraphRows.map(r => ({
        kind: r.kind, name: r.name, relPath: r.relPath,
        checks: r.checks.map(c => ({ label: c.label, ok: c.ok, detail: c.detail ?? undefined })),
        result: r.result,
      }))
    }
    if (signedSnapshot) out.signedSnapshot = signedSnapshot
    process.stdout.write(JSON.stringify(out, null, 2))
    process.exit(out.exitCode)
  }

  printHuman(summaryList, depGraphRows, signedSnapshot)
  console.log(`\n   exit code: ${results.exitCode()}`)
  process.exit(results.exitCode())
}

function main() {
  const args = new Set(process.argv.slice(2))
  mainAsync(args).catch(e => {
    console.error(`INTERNAL ERROR (exit code 3): ${e.message}\n${e.stack}`)
    process.exit(3)
  })
}

main()
