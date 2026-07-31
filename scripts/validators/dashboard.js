import path from 'node:path'
import { pathToFileURL } from 'node:url'

export const metadata = {
  name: 'dashboard',
  version: '1.1.0',
  dependsOn: ['schema'],
  provides: ['dashboardImport'],
  group: 'dashboard',
  description: 'Dynamic import of packages/dashboard/routes/opencode.mjs, records performance + export surface',
}

export default async function (ctx) {
  const r = ctx.results
  const DASHBOARD_PATH = path.join(ctx.root, 'packages/dashboard/routes/opencode.mjs')
  const t0 = performance.now()
  try {
    const url = pathToFileURL(DASHBOARD_PATH).href
    const mod = await import(url)
    const t1 = performance.now()
    r.perf.record('dashboardImport', t1 - t0)
    const present = typeof (mod.default) === 'function' || typeof (mod.default) === 'object' || Object.keys(mod).length > 0
    if (present) r.add('dashboard', 'opencode.mjs dashboard routes import cleanly', 'INFO', true, `export keys: ${Object.keys(mod).join(',')}`)
    else r.add('dashboard', 'opencode.mjs module has no apparent exports', 'NOTICE', false)
  } catch (e) {
    r.add('dashboard', 'opencode.mjs dashboard routes import cleanly', 'CRITICAL', false, e.message)
  }
}
