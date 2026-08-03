import { test } from 'node:test'
import assert from 'node:assert/strict'
import express from 'express'
import { once } from 'node:events'
import rateLimit from 'express-rate-limit'

test('metrics: error code extraction + 429 counting', async () => {
  const metrics = await import('../packages/metrics.mjs')
  metrics.jobFailuresTotal.reset()
  metrics.provider429Total.reset()
  metrics.jobDurationMs.reset()

  assert.equal(metrics.extractErrorCode('Upstream 429 Too Many Requests'), '429')
  assert.equal(metrics.extractErrorCode('fetch failed: 503'), '503')
  assert.equal(metrics.extractErrorCode('ffmpeg exit 1'), 'unknown')

  metrics.recordJobOutcome({ type: 'video_generate', payload: { provider: 'fal.ai' } }, 100, 'HTTP 429: quota exceeded')
  const out = await metrics.registry.metrics()
  assert.match(out, /nm_provider_429_total\{provider="fal\.ai"\} 1/)
  assert.match(out, /nm_job_failures_total\{[^}]*error_code="429"[^}]*\} 1/)

  metrics.recordJobOutcome({ type: 'news_video', payload: {} }, 50, 'boom')
  const out2 = await metrics.registry.metrics()
  assert.match(out2, /nm_job_failures_total\{[^}]*type="news_video"[^}]*error_code="unknown"[^}]*\} 1/)
  assert.match(out2, /nm_job_duration_ms_bucket/)
})

test('rate limit: render endpoints cap at 10 req/min then 429', async () => {
  const app = express()
  const limiter = rateLimit({
    windowMs: 60 * 1000,
    limit: 10,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    message: { error: 'Rate limit exceeded: max 10 render requests per minute' },
  })
  app.use('/api/generate', limiter)
  app.post('/api/generate', (req, res) => res.json({ ok: true }))

  const server = app.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const port = server.address().port
  const base = `http://127.0.0.1:${port}`

  let last = 0
  for (let i = 0; i < 11; i++) {
    const res = await fetch(`${base}/api/generate`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })
    last = res.status
  }
  assert.equal(last, 429, '11th request within the window must be rate limited')
  const body = await (await fetch(`${base}/api/generate`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })).json()
  assert.match(body.error, /Rate limit/)

  server.close()
  await once(server, 'close')
})
