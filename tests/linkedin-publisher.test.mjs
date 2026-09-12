// LinkedIn Publisher — unit tests for scope-aware author resolution + token
// introspection (no network: global fetch is mocked).
//
// Run: node --test tests/linkedin-publisher.test.mjs

import test from 'node:test'
import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'

// Env BEFORE module import — linkedin.js reads at top level.
process.env.LINKEDIN_CLIENT_ID = 'test-client'
process.env.LINKEDIN_CLIENT_SECRET = 'test-secret'
process.env.LINKEDIN_ORG_ID = '424242'

const PLUGIN_PATH = fileURLToPath(new URL('../apps/api/publishers/linkedin.js', import.meta.url))

function mockIntrospect(scopeString, active = true) {
  globalThis.fetch = async (url) => {
    if (String(url).includes('/oauth/v2/introspectToken')) {
      return {
        ok: true,
        // Real API returns `scope` as a comma-separated STRING.
        json: async () => ({ active, scope: scopeString || '', expires_at: 1893456000 }),
      }
    }
    throw new Error('unexpected fetch: ' + url)
  }
}

// Fresh module instance per import so the org-scope cache doesn't leak.
async function newPublisher(orgSocial) {
  process.env.LINKEDIN_ORG_SOCIAL = orgSocial
  const ts = Date.now() + Math.random()
  return import(PLUGIN_PATH + '?fresh=' + ts)
}

test('resolveAuthorUrn — org disabled posts as member profile', async () => {
  mockIntrospect('openid profile email w_member_social')
  const li = await newPublisher('0')
  const r = await li.resolveAuthorUrn('tok', 'urn:li:person:abc')
  assert.equal(r.urn, 'urn:li:person:abc')
  assert.equal(r.target, 'profile')
})

test('resolveAuthorUrn — org enabled + w_organization_social scope posts to org', async () => {
  mockIntrospect('openid,w_member_social,w_organization_social')
  const li = await newPublisher('1')
  const r = await li.resolveAuthorUrn('tok', 'urn:li:person:abc')
  assert.equal(r.urn, 'urn:li:organization:424242')
  assert.equal(r.target, 'company')
})

test('resolveAuthorUrn — org enabled but token lacks org scope falls back to member', async () => {
  mockIntrospect('openid,profile,email,w_member_social') // no w_organization_social
  const li = await newPublisher('1')
  const r = await li.resolveAuthorUrn('tok', 'urn:li:person:abc')
  assert.equal(r.urn, 'urn:li:person:abc')
  assert.equal(r.target, 'profile')
})

test('introspectToken — parses active flag + scope list', async () => {
  mockIntrospect('openid,profile,email,w_member_social', true)
  const li = await newPublisher('0')
  const info = await li.introspectToken('tok')
  assert.equal(info.active, true)
  assert.deepEqual(info.scope, ['openid', 'profile', 'email', 'w_member_social'])
  assert.ok(info.expires_at > 0)
})

test('introspectToken — returns safe shape when introspection fails', async () => {
  globalThis.fetch = async () => { throw new Error('network down') }
  const li = await newPublisher('0')
  const info = await li.introspectToken('tok')
  assert.equal(info.active, null)
  assert.deepEqual(info.scope, [])
})

test('resolveAllAuthorUrns — org disabled returns profile only', async () => {
  mockIntrospect('openid profile email w_member_social')
  const li = await newPublisher('0')
  const targets = await li.resolveAllAuthorUrns('tok', 'urn:li:person:abc')
  assert.equal(targets.length, 1)
  assert.equal(targets[0].target, 'profile')
  assert.equal(targets[0].urn, 'urn:li:person:abc')
})

test('resolveAllAuthorUrns — org enabled + scope returns both profile and company', async () => {
  mockIntrospect('openid,w_member_social,w_organization_social')
  const li = await newPublisher('1')
  const targets = await li.resolveAllAuthorUrns('tok', 'urn:li:person:abc')
  assert.equal(targets.length, 2)
  assert.equal(targets[0].target, 'profile')
  assert.equal(targets[0].urn, 'urn:li:person:abc')
  assert.equal(targets[1].target, 'company')
  assert.equal(targets[1].urn, 'urn:li:organization:424242')
})

test('resolveAllAuthorUrns — org enabled but no org scope returns profile only', async () => {
  mockIntrospect('openid,profile,email,w_member_social')
  const li = await newPublisher('1')
  const targets = await li.resolveAllAuthorUrns('tok', 'urn:li:person:abc')
  assert.equal(targets.length, 1)
  assert.equal(targets[0].target, 'profile')
})

test('shareVideoBuffer — full upload + post flow', async () => {
  const fakeBuffer = Buffer.from('fake-video-bytes')
  let initCalled = false, putCount = 0, finalizeCalled = false, postBody = null
  globalThis.fetch = async (url, opts = {}) => {
    const u = String(url)
    if (u.includes('action=initializeUpload')) {
      initCalled = true
      return {
        ok: true, json: async () => ({
          value: {
            uploadInstructions: [
              { uploadUrl: 'https://upload.example.com/part1', firstByte: 0, lastByte: fakeBuffer.byteLength - 1 },
            ],
            video: 'urn:li:video:111',
            uploadToken: 'tok123',
          },
        }),
      }
    }
    if (u.includes('upload.example.com')) {
      putCount++
      return { ok: true, headers: new Map([['etag', `etag-${putCount}`]]) }
    }
    if (u.includes('action=finalizeUpload')) {
      finalizeCalled = true
      return { ok: true }
    }
    if (u.includes('/rest/videos/urn')) {
      return { ok: true, json: async () => ({ status: 'AVAILABLE' }) }
    }
    if (u.includes('/rest/posts')) {
      postBody = opts.body
      return { ok: true, text: async () => '', headers: new Map([['x-restli-id', 'ugc-post:999']]), json: async () => ({}) }
    }
    throw new Error('unexpected: ' + u)
  }

  const li = await newPublisher('0')
  const result = await li.shareVideoBuffer('tok', 'urn:li:person:abc', fakeBuffer, 'Test commentary')
  assert.equal(initCalled, true)
  assert.equal(putCount, 1)
  assert.equal(finalizeCalled, true)
  assert.equal(result.id, 'ugc-post:999')
  assert.equal(result.urn, 'urn:li:video:111')
  const body = JSON.parse(postBody)
  assert.equal(body.author, 'urn:li:person:abc')
  assert.equal(body.content.media.id, 'urn:li:video:111')
})

test('shareVideoToAll — dual target posts once per target', async () => {
  const fakeBuffer = Buffer.from('fake-video-bytes')
  let postCount = 0
  const postAuthors = []
  globalThis.fetch = async (url, opts = {}) => {
    const u = String(url)
    if (u.includes('/oauth/v2/introspectToken')) {
      return { ok: true, json: async () => ({ active: true, scope: 'openid,w_member_social,w_organization_social', expires_at: 1893456000 }) }
    }
    if (u.includes('action=initializeUpload')) {
      return {
        ok: true, json: async () => ({
          value: {
            uploadInstructions: [
              { uploadUrl: 'https://upload.example.com/p', firstByte: 0, lastByte: fakeBuffer.byteLength - 1 },
            ],
            video: `urn:li:video:${postCount + 200}`,
            uploadToken: 'tok',
          },
        }),
      }
    }
    if (u.includes('upload.example.com')) {
      return { ok: true, headers: new Map([['etag', 'etag1']]) }
    }
    if (u.includes('action=finalizeUpload')) return { ok: true }
    if (u.includes('/rest/videos/urn')) return { ok: true, json: async () => ({ status: 'AVAILABLE' }) }
    if (u.includes('/rest/posts')) {
      postCount++
      postAuthors.push(JSON.parse(opts.body).author)
      return { ok: true, text: async () => '', headers: new Map([['x-restli-id', `post-${postCount}`]]), json: async () => ({}) }
    }
    throw new Error('unexpected: ' + u)
  }

  const li = await newPublisher('1')
  const results = await li.shareVideoToAll('tok', 'urn:li:person:abc', fakeBuffer, 'Dual test')
  assert.equal(results.length, 2)
  assert.equal(results[0].target, 'profile')
  assert.equal(results[0].success, true)
  assert.equal(results[1].target, 'company')
  assert.equal(results[1].success, true)
  assert.equal(postCount, 2)
  assert.deepEqual(postAuthors, ['urn:li:person:abc', 'urn:li:organization:424242'])
})

test('shareVideoToAll — company failure still returns profile result', async () => {
  const fakeBuffer = Buffer.from('video')
  let callCount = 0
  globalThis.fetch = async (url, opts = {}) => {
    const u = String(url)
    if (u.includes('/oauth/v2/introspectToken')) {
      return { ok: true, json: async () => ({ active: true, scope: 'openid,w_member_social,w_organization_social', expires_at: 1893456000 }) }
    }
    if (u.includes('action=initializeUpload')) {
      callCount++
      // Fail on second call (company upload)
      if (callCount === 2) return { ok: false, status: 403, text: async () => 'forbidden' }
      return {
        ok: true, json: async () => ({
          value: {
            uploadInstructions: [
              { uploadUrl: 'https://upload.example.com/p', firstByte: 0, lastByte: fakeBuffer.byteLength - 1 },
            ],
            video: 'urn:li:video:500',
            uploadToken: 'tok',
          },
        }),
      }
    }
    if (u.includes('upload.example.com')) return { ok: true, headers: new Map([['etag', 'e1']]) }
    if (u.includes('action=finalizeUpload')) return { ok: true }
    if (u.includes('/rest/videos/urn')) return { ok: true, json: async () => ({ status: 'AVAILABLE' }) }
    if (u.includes('/rest/posts')) return { ok: true, text: async () => '', headers: new Map([['x-restli-id', 'post-ok']]), json: async () => ({}) }
    throw new Error('unexpected')
  }

  const li = await newPublisher('1')
  const results = await li.shareVideoToAll('tok', 'urn:li:person:abc', fakeBuffer, 'Partial')
  assert.equal(results.length, 2)
  assert.equal(results[0].target, 'profile')
  assert.equal(results[0].success, true)
  assert.equal(results[1].target, 'company')
  assert.equal(results[1].success, false)
  assert.ok(results[1].error)
})