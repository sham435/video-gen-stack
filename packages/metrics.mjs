import { Registry, Counter, Gauge, Histogram, collectDefaultMetrics } from 'prom-client'
import { createServer } from 'http'

const registry = new Registry()

collectDefaultMetrics({ register: registry, prefix: 'nm_' })

// Job queue
export const jobsByStatus = new Gauge({
  name: 'nm_jobs_by_status',
  help: 'Jobs in newsroom.db by status',
  labelNames: ['status'],
  registers: [registry],
})

export const jobDurationMs = new Histogram({
  name: 'nm_job_duration_ms',
  help: 'Job execution duration in ms',
  labelNames: ['type', 'outcome'],
  buckets: [250, 500, 1000, 2500, 5000, 10000, 30000, 60000, 120000],
  registers: [registry],
})

export const jobFailuresTotal = new Counter({
  name: 'nm_job_failures_total',
  help: 'Total job failures by type and error code',
  labelNames: ['type', 'error_code'],
  registers: [registry],
})

export const provider429Total = new Counter({
  name: 'nm_provider_429_total',
  help: 'Provider HTTP 429 (rate limit) responses',
  labelNames: ['provider'],
  registers: [registry],
})

export const consecutiveFailures = new Gauge({
  name: 'nm_worker_consecutive_failures',
  help: 'Current streak of consecutive job failures in this worker process',
  registers: [registry],
})

// HTTP API
export const httpRequestsTotal = new Counter({
  name: 'nm_http_requests_total',
  help: 'HTTP requests by method, route and status class',
  labelNames: ['method', 'route', 'status'],
  registers: [registry],
})

export const httpRequestDurationMs = new Histogram({
  name: 'nm_http_request_duration_ms',
  help: 'HTTP request duration in ms',
  labelNames: ['method', 'route'],
  buckets: [10, 50, 100, 250, 500, 1000, 2500, 5000, 10000],
  registers: [registry],
})

export function extractErrorCode(error) {
  const msg = String(error || '')
  const m = msg.match(/(\d{3})/)
  if (m && ['400', '401', '403', '404', '408', '429', '500', '502', '503', '504'].includes(m[1])) return m[1]
  return 'unknown'
}

export function recordJobOutcome(job, durationMs, error = null) {
  const outcome = error ? 'failed' : 'done'
  jobDurationMs.observe({ type: job.type, outcome }, durationMs)
  if (error) {
    jobFailuresTotal.inc({ type: job.type, error_code: extractErrorCode(error) })
    if (/429|Too Many Requests|rate.limit/i.test(String(error))) {
      provider429Total.inc({ provider: job.payload?.provider || 'unknown' })
    }
  }
}

export function updateJobGauges(db) {
  try {
    const rows = db.prepare('SELECT status, COUNT(*) AS n FROM jobs GROUP BY status').all()
    const counts = Object.fromEntries(rows.map(r => [r.status, r.n]))
    for (const s of ['queued', 'running', 'done', 'failed', 'cancelled']) {
      jobsByStatus.set({ status: s }, counts[s] || 0)
    }
  } catch {}
}

export function startMetricsServer(port, { log = null } = {}) {
  const server = createServer(async (req, res) => {
    if (req.url !== '/metrics') {
      res.writeHead(404)
      return res.end('not found')
    }
    res.setHeader('Content-Type', registry.contentType)
    res.end(await registry.metrics())
  })
  server.listen(port, '127.0.0.1', () => {
    if (log) log.info({ port }, 'metrics server listening')
  })
  server.on('error', (err) => {
    if (log) log.warn({ err: err.message }, 'metrics server failed to start')
  })
  return server
}

export { registry }
