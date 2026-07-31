import fs from 'node:fs'
import path from 'node:path'

const SEV_ORDER = Object.freeze({ INFO: 0, NOTICE: 1, WARNING: 2, ERROR: 3, CRITICAL: 4 })

export const metadata = {
  name: 'performance',
  version: '1.2.0',
  dependsOn: ['schema', 'registry', 'bridge', 'dashboard'],
  provides: ['performanceChecks'],
  group: 'performance',
  description: 'Check performance vs static budgets, AND vs rolling persisted baseline (median of last 5). Regression > +40% vs baseline = WARNING, > +20% = NOTICE. Persists to .opencode/.perf-baseline.json.',
}

const BASELINE_FILE = '.opencode/.perf-baseline.json'
const BASELINE_WINDOW = 5

function readBaseline(root) {
  const p = path.join(root, BASELINE_FILE)
  try { if (!fs.existsSync(p)) return {}; return JSON.parse(fs.readFileSync(p, 'utf-8')) }
  catch { return {} }
}
function writeBaseline(root, data) {
  const p = path.join(root, BASELINE_FILE)
  try { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, JSON.stringify(data, null, 2)) }
  catch (_) { /* ignore */ }
}
function median(xs) {
  if (!xs.length) return NaN
  const s = [...xs].sort((a, b) => a - b)
  const m = Math.floor(s.length / 2)
  return s.length % 2 === 0 ? (s[m - 1] + s[m]) / 2 : s[m]
}

export default function (ctx) {
  const r = ctx.results
  const b = ctx.bridge
  if (!b) {
    r.add('performance', 'perf regressions (bridge unavailable)', 'ERROR', false)
    return
  }
  const budgets = (b.config.validation_schemas && b.config.validation_schemas.performance_budgets_ms) || {}
  const records = r.perf.records()
  const runFull = performance.now() - (records.__runStart || performance.now())
  const all = { ...records, fullValidation: runFull }
  const baselineStore = readBaseline(ctx.root)
  const budgetAll = { ...budgets, fullValidation: 250 }

  // Update rolling baseline (append current, cap to window)
  for (const [name, ms] of Object.entries(all)) {
    if (typeof ms !== 'number' || !isFinite(ms)) continue
    const key = `metric.${name}`
    if (!baselineStore[key]) baselineStore[key] = []
    baselineStore[key].push(ms)
    if (baselineStore[key].length > BASELINE_WINDOW) baselineStore[key] = baselineStore[key].slice(-BASELINE_WINDOW)
  }

  for (const [name, budget] of Object.entries(budgetAll)) {
    const actual = all[name]
    if (typeof actual !== 'number' || !isFinite(actual)) continue
    // Check baseline regression
    const hist = baselineStore[`metric.${name}`] || []
    let baselineMs = null
    let baselinePct = null
    if (hist.length >= 2) {
      baselineMs = median(hist.slice(0, -1)) // prior runs only, exclude current
      if (isFinite(baselineMs) && baselineMs > 0) {
        baselinePct = ((actual - baselineMs) / baselineMs) * 100
      }
    }
    // Severity: baseline regression first (only when we have >=2 samples to compare)
    let sev = 'INFO'
    let passed = true
    let labelDetail = ''
    if (baselinePct !== null && isFinite(baselinePct)) {
      labelDetail = ` (baseline ${baselineMs.toFixed(1)}ms, Δ${baselinePct >= 0 ? '+' : ''}${baselinePct.toFixed(0)}%)`
      if (baselinePct > 40) { sev = 'WARNING'; passed = false }
      else if (baselinePct > 20) { sev = 'NOTICE'; passed = false }
    }
    // Static budget check: escalate if exceeded
    if (actual > budget * 1.5 && SEV_ORDER[sev] < SEV_ORDER.WARNING) { sev = 'WARNING'; passed = false }
    else if (actual > budget && SEV_ORDER[sev] < SEV_ORDER.NOTICE) { sev = sev === 'INFO' ? (passed && actual <= budget * 1.5 ? 'NOTICE' : 'NOTICE') : sev; passed = actual <= budget ? passed : false }
    r.add('performance', `${name} ${actual.toFixed(1)}ms ≤ ${budget}ms${labelDetail}`, sev, actual <= budget && passed,
      baselineMs !== null ? { actual, budget, baselineMs, deltaPct: baselinePct } : undefined)
  }
  // Persist updated rolling baseline
  writeBaseline(ctx.root, baselineStore)
  // Persisted for future runs; also expose in state for JSON output
  ctx.state.perfBaselineWindow = BASELINE_WINDOW
  ctx.state.perfBaselineFile = BASELINE_FILE
}

