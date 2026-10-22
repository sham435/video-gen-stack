// YouTube publisher — OAuth error-shape regression tests.
//
// Incident this locks down: a revoked/expired refresh token makes Google's
// token endpoint return
//     HTTP 400  { "error": "invalid_grant", "error_description": "Bad Request" }
// The old `youtubeApiError()` only read `error.message`; because `error` is a
// STRING here, every upload failed with a useless `YOUTUBE_API_ERROR: HTTP 400`
// and the channel published nothing for 18 days while runs reported success.
//
// These tests assert:
//   1. the real OAuth code/description are surfaced,
//   2. the error is flagged `isAuthError` (so the composer fails the run), and
//   3. normal YouTube Data API error objects are unchanged and NOT flagged.
//
// Run: node --test tests/youtube-auth-error.test.mjs

import test from 'node:test'
import assert from 'node:assert/strict'

// Env must exist before the module is imported (youtube.js reads it at top level).
process.env.YOUTUBE_CLIENT_ID = 'test-client-id'
process.env.YOUTUBE_CLIENT_SECRET = 'test-client-secret'
process.env.YOUTUBE_REFRESH_TOKEN = 'test-refresh-token'
process.env.YOUTUBE_REDIRECT_URI = 'http://localhost:3001/api/auth/youtube/callback'

const OrigFetch = globalThis.fetch

function mockFetch(handler) {
  globalThis.fetch = async (url, opts) => handler(String(url), opts)
}

function jsonResponse(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 400 ? 'Bad Request' : 'OK',
    headers: { get: () => null, has: () => false },
    json: async () => body,
    text: async () => JSON.stringify(body),
    arrayBuffer: async () => new ArrayBuffer(0),
  }
}

test.afterEach(() => {
  globalThis.fetch = OrigFetch
})

const youtube = await import('../apps/api/publishers/youtube.js')

test('getAccessToken — invalid_grant surfaces the OAuth code (not a bare "HTTP 400")', async () => {
  mockFetch(() => jsonResponse(400, { error: 'invalid_grant', error_description: 'Bad Request' }))

  await assert.rejects(
    () => youtube.getAccessToken({ force: true }),
    (err) => {
      assert.match(err.message, /invalid_grant/, `expected invalid_grant in: ${err.message}`)
      assert.doesNotMatch(err.message, /^YOUTUBE_API_ERROR: HTTP 400$/, 'must not collapse to bare HTTP 400')
      assert.equal(err.reason, 'invalid_grant')
      assert.equal(err.isAuthError, true, 'systemic credential failure must be flagged')
      return true
    }
  )
})

test('getAccessToken — 401 with object error is flagged as auth error', async () => {
  mockFetch(() => jsonResponse(401, { error: { message: 'Unauthorized', status: 'UNAUTHENTICATED' } }))

  await assert.rejects(
    () => youtube.getAccessToken({ force: true }),
    (err) => {
      assert.equal(err.isAuthError, true)
      assert.match(err.message, /Unauthorized/)
      return true
    }
  )
})

test('getAccessToken — transient 500 is NOT flagged as an auth error', async () => {
  mockFetch(() => jsonResponse(500, { error: { message: 'Backend Error', status: 'INTERNAL' } }))

  await assert.rejects(
    () => youtube.getAccessToken({ force: true }),
    (err) => {
      assert.equal(err.isAuthError, false, 'a 5xx must not be treated as an auth failure')
      return true
    }
  )
})

test('deleteVideo — YouTube API error object keeps message/reason and is not auth', async () => {
  mockFetch((url) => {
    if (url.includes('oauth2.googleapis.com/token')) {
      return jsonResponse(200, { access_token: 'tok', expires_in: 3600 })
    }
    return jsonResponse(403, {
      error: {
        code: 403,
        message: 'The request cannot be completed because you have exceeded your quota.',
        errors: [{ reason: 'quotaExceeded' }],
        status: 'PERMISSION_DENIED',
      },
    })
  })

  await assert.rejects(
    () => youtube.deleteVideo('vid'),
    (err) => {
      assert.match(err.message, /quota/i)
      assert.equal(err.reason, 'quotaExceeded')
      assert.equal(err.isAuthError, false)
      return true
    }
  )
})
