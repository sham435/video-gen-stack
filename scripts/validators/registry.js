import fs from 'node:fs'
import path from 'node:path'

export const metadata = {
  name: 'registry',
  version: '1.1.0',
  dependsOn: ['schema'],
  provides: ['registrySweep', 'integrityReport'],
  group: 'registry',
  description: 'Run validateIntegrity() against the bridge; check registry sweeps, orphans, broken links, data-driven resource_kinds declaration',
}

export default function (ctx) {
  const r = ctx.results
  const b = ctx.bridge
  if (!b) {
    r.add('registry', 'registry checks (bridge unavailable)', 'ERROR', false)
    return
  }
  const t0 = performance.now()
  const integ = b.validateIntegrity()
  const t1 = performance.now()
  r.perf.record('registrySweep', t1 - t0)

  for (const k of ['agents', 'memory', 'workflows', 'policies']) {
    const list = integ.registrySweep[k]
    const fails = list.filter(x => !x.ok)
    const label = `${k} sweep (${list.length})`
    if (fails.length === 0) r.add('registry', label, 'INFO', true)
    else r.add('registry', label, 'ERROR', false, fails.map(f => `${f.name}: ${f.error}`).join(' | '))
  }
  if (integ.brokenRegistry.length === 0) r.add('registry', 'brokenRegistry entries = 0', 'INFO', true)
  else r.add('registry', `brokenRegistry entries = ${integ.brokenRegistry.length}`, 'ERROR', false, JSON.stringify(integ.brokenRegistry))
  if (integ.orphanedFiles.length === 0) r.add('registry', 'orphanedFiles = 0', 'INFO', true)
  else r.add('registry', `orphanedFiles = ${integ.orphanedFiles.length} (each intentionally unregistered?)`, 'NOTICE', false, JSON.stringify(integ.orphanedFiles))
  if (integ.ok) r.add('registry', 'validateIntegrity().ok', 'INFO', true)
  else r.add('registry', 'validateIntegrity().ok = false', 'ERROR', false)

  // ensure new validation_schemas top-level key loaded (data-driven dep-graph)
  if (b.config && b.config.validation_schemas && b.config.validation_schemas.resource_kinds) {
    const nKinds = Object.keys(b.config.validation_schemas.resource_kinds).length
    r.add('registry', `data-driven resource_kinds declared in system-config.json (${nKinds})`, 'INFO', true)
  } else {
    r.add('registry', 'validation_schemas.resource_kinds missing from system-config.json', 'ERROR', false)
  }
}
