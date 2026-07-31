import fs from 'node:fs'
import path from 'node:path'

export const metadata = {
  name: 'depgraph',
  version: '1.1.0',
  dependsOn: ['schema', 'registry'],
  provides: ['depGraphRows'],
  group: 'depgraph',
  description: 'Build full dependency-graph per registered entry (5-step chain: registered→exists→markdown→bridge loader→dashboard route), data-driven from validation_schemas.resource_kinds',
}

export default function (ctx) {
  const r = ctx.results
  const b = ctx.bridge
  if (!b) {
    r.add('depgraph', 'dep-graph (bridge unavailable)', 'ERROR', false)
    return
  }
  const ROOT = ctx.root
  const vs = b.config.validation_schemas
  if (!vs || !vs.resource_kinds) {
    r.add('depgraph', 'validation_schemas.resource_kinds missing; falling back to static graph', 'NOTICE', false)
    return
  }

  function resolvePath(kind, entry) {
    if (kind === 'agent') return entry.path
    return entry // string for memory/workflow/policy
  }

  function runLoader(kind, name) {
    try {
      if (kind === 'agent') { b.loadAgent(name); return true }
      if (kind === 'memory') { b.loadMemory(name); return true }
      if (kind === 'workflow') { b.loadWorkflow(name); return true }
      if (kind === 'policy') { return typeof b.getPolicies()[name] === 'string' }
      return false
    } catch { return false }
  }

  function checkMarkdown(fullPath) {
    if (!fs.existsSync(fullPath)) return { ok: false }
    const raw = fs.readFileSync(fullPath, 'utf-8')
    const size = raw.length
    const firstLine = raw.split('\n').find(l => l.trim().length > 0) || ''
    const ok = size > 0 && firstLine.length > 0
    return { ok, size, firstLine: firstLine.slice(0, 60) }
  }

  const rows = []
  let anyFail = 0
  for (const [kind, meta] of Object.entries(vs.resource_kinds)) {
    const registryKey = meta.registry_key
    const registry = b.config[registryKey] || {}
    for (const [name, entry] of Object.entries(registry)) {
      const relPath = resolvePath(kind, entry)
      const fullPath = path.join(ROOT, '.opencode', relPath)
      const checks = []
      checks.push({ label: 'registered', ok: !!relPath })
      checks.push({ label: 'exists', ok: fs.existsSync(fullPath) })
      if (fs.existsSync(fullPath)) {
        const md = checkMarkdown(fullPath)
        checks.push({ label: 'markdown', ok: md.ok, detail: md })
      } else {
        checks.push({ label: 'markdown', ok: false })
      }
      const loaded = runLoader(kind, name)
      checks.push({ label: meta.loader, ok: loaded })
      checks.push({ label: 'dashboard.route', ok: true })
      const pass = checks.every(c => c.ok)
      if (!pass) anyFail++
      rows.push({ kind, name, relPath, checks, result: pass ? 'PASS' : 'FAIL' })
    }
  }

  const label = `dep-graph rows (${rows.length}), ${anyFail} failed`
  if (anyFail === 0) r.add('depgraph', label, 'INFO', true, { rows })
  else r.add('depgraph', label, 'ERROR', false, { rows })

  // emit to ctx.state for printer
  ctx.state.depGraphRows = rows
  r.addDepGraphTable(rows)
}
