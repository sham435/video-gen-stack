#!/usr/bin/env node
/**
 * trace-inspect — read-only inspection of persisted production traces.
 *
 * Renders the stage timeline from .newsmonster/checkpoints/*.json and verifies
 * the telemetry invariant (one terminal record per attempt). Touches nothing:
 * safe to run against live checkpoints.
 *
 *   node scripts/trace-inspect.mjs                  # summarise every job
 *   node scripts/trace-inspect.mjs <jobId>          # one job, full timeline
 *   node scripts/trace-inspect.mjs --json           # machine-readable
 *   node scripts/trace-inspect.mjs --verify         # exit 1 on invariant breach
 */

import fs from 'fs'
import path from 'path'

const TERMINAL = new Set(['SUCCEEDED', 'FAILED', 'SKIPPED', 'QUARANTINED'])
const MARK = { SUCCEEDED: '✓', FAILED: '✗', QUARANTINED: '⊘', SKIPPED: '–', RUNNING: '·' }

const args = process.argv.slice(2)
const asJson = args.includes('--json')
const verifyOnly = args.includes('--verify')
const dirFlag = args.indexOf('--dir')
const baseDir = dirFlag >= 0 ? args[dirFlag + 1] : '.newsmonster/checkpoints'
const jobFilter = args.find(a => !a.startsWith('--') && a !== baseDir)

function loadJobs() {
  if (!fs.existsSync(baseDir)) return []
  return fs.readdirSync(baseDir)
    .filter(f => f.endsWith('.json'))
    .map(f => {
      try {
        return { file: path.join(baseDir, f), state: JSON.parse(fs.readFileSync(path.join(baseDir, f), 'utf-8')) }
      } catch (err) {
        return { file: path.join(baseDir, f), error: err.message }
      }
    })
    .filter(j => !jobFilter || j.state?.jobId === jobFilter || path.basename(j.file, '.json') === jobFilter)
}

/** One terminal record per (stage, attempt) — the Phase 1 telemetry invariant. */
function verifyTrace(trace) {
  const violations = []
  const byAttempt = new Map()
  for (const r of trace) {
    const key = `${r.stage}#${r.attempt}`
    if (!byAttempt.has(key)) byAttempt.set(key, [])
    byAttempt.get(key).push(r)
  }
  for (const [key, records] of byAttempt) {
    const terminals = records.filter(r => TERMINAL.has(r.status))
    if (terminals.length === 0) {
      violations.push({ key, kind: 'NO_TERMINAL', detail: 'attempt never reached a terminal state' })
    } else if (terminals.length > 1) {
      violations.push({ key, kind: 'MULTIPLE_TERMINAL', detail: terminals.map(t => t.status).join(' + ') })
    }
    // A stage blocked by a precondition never entered execution, so it has no
    // RUNNING record by design — same for stages that were skipped outright.
    const neverExecuted = records.some(r => r.metadata?.handlerInvoked === false)
    if (!records.some(r => r.status === 'RUNNING') && !terminals.some(t => t.status === 'SKIPPED') && !neverExecuted) {
      violations.push({ key, kind: 'NO_RUNNING', detail: 'terminal record with no preceding RUNNING' })
    }
  }
  return violations
}

function summarise(job) {
  const trace = job.state?.stageTrace || []
  return {
    jobId: job.state?.jobId || path.basename(job.file, '.json'),
    file: job.file,
    title: job.state?.articleTitle || null,
    status: job.state?.status || 'UNKNOWN',
    startedAt: job.state?.startedAt || null,
    completedAt: job.state?.completedAt || null,
    quarantineReason: job.state?.quarantineReason || null,
    traceRecords: trace.length,
    attempts: new Set(trace.map(r => `${r.stage}#${r.attempt}`)).size,
    artifacts: job.state?.artifacts || {},
    violations: verifyTrace(trace),
    trace,
  }
}

function printTimeline(s) {
  console.log(`\n${'─'.repeat(72)}`)
  console.log(`job      ${s.jobId}`)
  if (s.title) console.log(`article  ${s.title}`)
  console.log(`status   ${s.status}`)
  if (s.startedAt) console.log(`started  ${s.startedAt}`)
  if (s.quarantineReason) console.log(`blocked  ${s.quarantineReason}`)
  console.log(`${'─'.repeat(72)}`)

  if (s.trace.length === 0) {
    console.log('(no trace records)')
    return
  }

  for (const r of s.trace) {
    if (r.status === 'RUNNING') continue // paired with its terminal record below
    const mark = MARK[r.status] || '?'
    const dur = r.durationMs != null ? `${String(r.durationMs).padStart(6)}ms` : '        '
    const cls = r.errorClassification ? ` [${r.errorClassification}]` : ''
    const note = r.metadata?.failedPredicates?.length ? ` — blocked on: ${r.metadata.failedPredicates.join(', ')}`
      : r.metadata?.error ? ` — ${String(r.metadata.error).slice(0, 60)}`
        : r.metadata?.reason ? ` — ${r.metadata.reason}`
          : ''
    console.log(`  ${mark} ${r.stage.padEnd(11)} a${r.attempt} ${dur} ${r.status.padEnd(11)}${cls}${note}`)
    if (r.metadata?.handlerInvoked === false) console.log('       └─ handler never invoked')
    for (const id of r.artifactIds || []) console.log(`       └─ ${id}`)
  }

  const artifactStages = Object.keys(s.artifacts)
  if (artifactStages.length) {
    console.log(`\n  artifacts indexed: ${artifactStages.join(', ')}`)
  }

  if (s.violations.length) {
    console.log(`\n  ⚠ ${s.violations.length} invariant violation(s):`)
    for (const v of s.violations) console.log(`    ${v.kind}  ${v.key}  ${v.detail}`)
  }
}

const jobs = loadJobs()

if (jobs.length === 0) {
  const scope = jobFilter ? `job "${jobFilter}"` : 'jobs'
  console.log(`No ${scope} found in ${baseDir}`)
  process.exit(verifyOnly ? 0 : 0)
}

const unreadable = jobs.filter(j => j.error)
const summaries = jobs.filter(j => !j.error).map(summarise)
const totalViolations = summaries.reduce((n, s) => n + s.violations.length, 0)

if (asJson) {
  console.log(JSON.stringify({
    baseDir,
    jobs: summaries.map(({ trace, ...rest }) => (jobFilter ? { ...rest, trace } : rest)),
    unreadable,
    totalViolations,
  }, null, 2))
} else if (jobFilter) {
  summaries.forEach(printTimeline)
} else {
  console.log(`\n${'jobId'.padEnd(34)} ${'status'.padEnd(18)} ${'records'.padStart(7)} ${'bad'.padStart(4)}`)
  console.log('─'.repeat(70))
  for (const s of summaries) {
    console.log(`${s.jobId.slice(0, 33).padEnd(34)} ${s.status.padEnd(18)} ${String(s.traceRecords).padStart(7)} ${String(s.violations.length).padStart(4)}`)
  }
  console.log(`\n${summaries.length} job(s), ${totalViolations} invariant violation(s)`)
  if (unreadable.length) console.log(`${unreadable.length} unreadable checkpoint file(s)`)
  console.log(`\nInspect one:  node scripts/trace-inspect.mjs <jobId>`)
}

if (verifyOnly && totalViolations > 0) process.exit(1)
