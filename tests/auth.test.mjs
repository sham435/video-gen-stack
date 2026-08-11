import { test } from 'node:test'
import assert from 'node:assert/strict'
import { requireAuth, createAdminSession } from '../packages/auth/requireAuth.js'

function makeRes() {
  const res = { statusCode: null, body: null }
  return {
    ...res,
    status(code) { this.statusCode = code; return this },
    json(payload) { this.body = payload; return this },
  }
}

test('auth: 503 when ADMIN_API_KEY not configured (fails closed)', () => {
  const prev = process.env.ADMIN_API_KEY
  delete process.env.ADMIN_API_KEY
  try {
    const res = makeRes()
    requireAuth({ headers: {}, query: {} }, res, () => assert.fail('next() must not run'))
    assert.equal(res.statusCode, 503)
    assert.match(res.body?.error ?? '', /ADMIN_API_KEY not configured/)
  } finally {
    if (prev !== undefined) process.env.ADMIN_API_KEY = prev
  }
})

test('auth: 401 without key', () => {
  const prev = process.env.ADMIN_API_KEY
  process.env.ADMIN_API_KEY = 'test-key-123'
  try {
    const res = makeRes()
    requireAuth({ headers: {}, query: {} }, res, () => assert.fail('next() must not run'))
    assert.equal(res.statusCode, 401)
  } finally {
    if (prev !== undefined) process.env.ADMIN_API_KEY = prev
  }
})

test('auth: 401 with wrong key', () => {
  const prev = process.env.ADMIN_API_KEY
  process.env.ADMIN_API_KEY = 'test-key-123'
  try {
    const res = makeRes()
    requireAuth({ headers: { 'x-api-key': 'wrong' }, query: {} }, res, () => assert.fail('next() must not run'))
    assert.equal(res.statusCode, 401)
  } finally {
    if (prev !== undefined) process.env.ADMIN_API_KEY = prev
  }
})

test('auth: 200 with correct header key', () => {
  const prev = process.env.ADMIN_API_KEY
  process.env.ADMIN_API_KEY = 'test-key-123'
  try {
    let nextCalled = false
    const res = makeRes()
    requireAuth({ headers: { 'x-api-key': 'test-key-123' }, query: {} }, res, () => { nextCalled = true })
    assert.equal(nextCalled, true, 'next() invoked')
    assert.equal(res.statusCode, null)
  } finally {
    if (prev !== undefined) process.env.ADMIN_API_KEY = prev
  }
})

test('auth: 401 when key passed in query string (keys must never be in URLs)', () => {
  const prev = process.env.ADMIN_API_KEY
  process.env.ADMIN_API_KEY = 'test-key-123'
  try {
    const res = makeRes()
    requireAuth({ headers: {}, query: { apiKey: 'test-key-123' } }, res, () => assert.fail('next() must not run'))
    assert.equal(res.statusCode, 401)
  } finally {
    if (prev !== undefined) process.env.ADMIN_API_KEY = prev
  }
})

test('auth: 200 with valid session cookie (EventSource streams)', () => {
  const prev = process.env.ADMIN_API_KEY
  process.env.ADMIN_API_KEY = 'test-key-123'
  try {
    const token = createAdminSession()
    let nextCalled = false
    const res = makeRes()
    requireAuth({ headers: { cookie: `nm_session=${token}` } }, res, () => { nextCalled = true })
    assert.equal(nextCalled, true, 'next() invoked')
  } finally {
    if (prev !== undefined) process.env.ADMIN_API_KEY = prev
  }
})
