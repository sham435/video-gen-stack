import { test } from 'node:test'
import assert from 'node:assert/strict'
import express from 'express'
import videoRoutes, { validateCronToken } from '../apps/api/routes/video.js'

// Fix A regression: /cron/rotate performs a FULL render + public YouTube
// publish, so it must be gated by the same fail-closed cron token as
// /cron/news-video. validateCronToken is FAIL-CLOSED: an unset CRON_SECRET
// refuses to run (misconfiguration, not an open door).

async function withSecret(secret, fn) {
  const saved = process.env.CRON_SECRET
  if (secret === undefined) delete process.env.CRON_SECRET
  else process.env.CRON_SECRET = secret
  try { return await fn() } finally {
    if (saved === undefined) delete process.env.CRON_SECRET
    else process.env.CRON_SECRET = saved
  }
}

test('cron: validateCronToken fails CLOSED when CRON_SECRET unset', () => {
  withSecret(undefined, () => {
    assert.throws(
      () => validateCronToken({ body: { token: 'anything' } }),
      /CRON_SECRET not configured/
    )
    assert.throws(
      () => validateCronToken({ query: { token: 'anything' } }),
      /CRON_SECRET not configured/
    )
  })
})

test('cron: validateCronToken rejects wrong or missing token', () => {
  withSecret('s3cret', () => {
    assert.throws(() => validateCronToken({ body: {} }), /invalid or missing/)
    assert.throws(() => validateCronToken({ body: { token: 'nope' } }), /invalid or missing/)
    assert.throws(() => validateCronToken({ query: { token: 'nope' } }), /invalid or missing/)
  })
})

test('cron: validateCronToken accepts correct token', () => {
  withSecret('s3cret', () => {
    assert.equal(validateCronToken({ body: { token: 's3cret' } }), undefined)
    assert.equal(validateCronToken({ query: { token: 's3cret' } }), undefined)
  })
})

test('cron: /cron/rotate route returns 401 without a configured secret', async () => {
  const app = express()
  app.use(express.json())
  app.use('/api', videoRoutes)
  const server = app.listen(0)
  try {
    const base = `http://127.0.0.1:${server.address().port}`
    const res = await fetch(`${base}/api/cron/rotate`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })
    assert.equal(res.status, 401)
    const payload = await res.json()
    assert.match(payload.error, /CRON_SECRET not configured/)
  } finally { server.close() }
})

test('cron: /cron/rotate route returns 401 with a wrong token', async () => {
  withSecret('s3cret', async () => {
    const app = express()
    app.use(express.json())
    app.use('/api', videoRoutes)
    const server = app.listen(0)
    try {
      const base = `http://127.0.0.1:${server.address().port}`
      const res = await fetch(`${base}/api/cron/rotate`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ token: 'wrong' }) })
      assert.equal(res.status, 401)
      const payload = await res.json()
      assert.match(payload.error, /invalid or missing/)
    } finally { server.close() }
  })
})

test('cron: /cron/news-video route also 401s without a secret (fail-closed pair)', async () => {
  const app = express()
  app.use(express.json())
  app.use('/api', videoRoutes)
  const server = app.listen(0)
  try {
    const base = `http://127.0.0.1:${server.address().port}`
    const res = await fetch(`${base}/api/cron/news-video`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })
    assert.equal(res.status, 401)
  } finally { server.close() }
})