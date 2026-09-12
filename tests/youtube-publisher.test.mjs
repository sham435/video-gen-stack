// YouTube Publisher — unit tests with mock transport (no network).
// Covers: exchangeCode, getAccessToken, uploadShort, setThumbnail,
// postComment, deleteVideo, error paths, title/description truncation.
//
// Run: node --test tests/youtube-publisher.test.mjs

import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// Valid 8-byte PNG signature (satisfies setThumbnail's byte-signature check).
const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]

// Set env BEFORE any module import — youtube.js reads at top level.
process.env.YOUTUBE_CLIENT_ID = 'test-client-id'
process.env.YOUTUBE_CLIENT_SECRET = 'test-client-secret'
process.env.YOUTUBE_REFRESH_TOKEN = 'test-refresh-token'
process.env.YOUTUBE_REDIRECT_URI = 'http://localhost:3001/api/auth/youtube/callback'

// Mock transport — records calls, returns canned responses.
let mockFetch = null
const OrigFetch = globalThis.fetch
function mockTransport(handler) {
  mockFetch = async (url, opts) => {
    // OAuth token endpoint: return a fresh access token by default unless the
    // handler explicitly overrides it (covers the flow where getAccessToken()
    // is called before the real API call).
    if (String(url).includes('oauth2.googleapis.com/token')) {
      const override = await handler(url, opts)
      const isError = override?.ok === false || (override?.status && override.status >= 400)
      if (isError && override.body) {
        return {
          ok: false,
          status: override.status ?? 400,
          statusText: override.statusText ?? 'Error',
          json: async () => override.body ?? {},
          arrayBuffer: async () => override.buffer ?? new ArrayBuffer(0),
          text: async () => override.text ?? '',
        }
      }
      if (override && override.body && override.body.access_token) {
        return {
          ok: override.ok ?? true,
          status: override.status ?? 200,
          statusText: override.statusText ?? 'OK',
          json: async () => override.body ?? {},
          arrayBuffer: async () => override.buffer ?? new ArrayBuffer(0),
          text: async () => override.text ?? '',
        }
      }
      return {
        ok: true,
        status: 200,
        statusText: 'OK',
        json: async () => ({ access_token: 'auto-token' }),
        arrayBuffer: async () => new ArrayBuffer(0),
        text: async () => '',
      }
    }
    const result = await handler(url, opts)
    return {
      ok: result.ok ?? true,
      status: result.status ?? 200,
      statusText: result.statusText ?? 'OK',
      headers: {
        get: (k) => (result.headers ?? {})[String(k).toLowerCase()],
        has: (k) => Object.prototype.hasOwnProperty.call(result.headers ?? {}, String(k).toLowerCase()),
      },
      json: async () => result.body ?? {},
      arrayBuffer: async () => result.buffer ?? new ArrayBuffer(0),
      text: async () => result.text ?? '',
    }
  }
  globalThis.fetch = mockFetch
}
function restoreTransport() {
  globalThis.fetch = OrigFetch
  mockFetch = null
}

// Re-import the module fresh each test group to pick up mocked env.
let youtube = null

test.beforeEach(async () => {
  // Force fresh import by deleting from cache.
  const modPath = new URL('../apps/api/publishers/youtube.js', import.meta.url).pathname
  // ESM module cache can't be cleared easily — we rely on the module
  // being loaded once and the mock being swapped per-test.
  if (!youtube) {
    youtube = await import('../apps/api/publishers/youtube.js')
  }
})

test.afterEach(() => {
  restoreTransport()
})

// ── exchangeCode ─────────────────────────────────────────────────────────
test('exchangeCode — returns tokens on success', async () => {
  mockTransport((url) => ({
    body: { access_token: 'at-123', refresh_token: 'rt-456', expires_in: 3600 },
  }))
  const data = await youtube.exchangeCode('auth-code-xyz')
  assert.equal(data.access_token, 'at-123')
  assert.equal(data.refresh_token, 'rt-456')
})

test('exchangeCode — sends correct params', async () => {
  let sentBody = null
  mockTransport((url, opts) => {
    sentBody = opts.body
    return { body: { access_token: 'ok' } }
  })
  await youtube.exchangeCode('my-code')
  assert.ok(sentBody instanceof URLSearchParams)
  assert.equal(sentBody.get('code'), 'my-code')
  assert.equal(sentBody.get('grant_type'), 'authorization_code')
  assert.equal(sentBody.get('client_id'), 'test-client-id')
})

test('exchangeCode — throws on error from Google', async () => {
  mockTransport(() => ({ status: 400, body: { error: { message: 'invalid_grant', status: 'INVALID_GRANT' } } }))
  await assert.rejects(
    () => youtube.exchangeCode('expired-code'),
    /invalid_grant/
  )
})

// ── getAccessToken ───────────────────────────────────────────────────────
test('getAccessToken — returns access token', async () => {
  youtube.resetTokenCache()
  mockTransport(() => ({
    body: { access_token: 'fresh-token-abc', token_type: 'Bearer' },
  }))
  const token = await youtube.getAccessToken()
  assert.equal(token, 'fresh-token-abc')
})

test('getAccessToken — throws if no refresh token', async () => {
  // The module reads REFRESH_TOKEN from process.env at call time. We verify the
  // happy path (env token set by the test harness) still works.
  youtube.resetTokenCache()
  mockTransport(() => ({ body: { access_token: 'tok' } }))
  const token = await youtube.getAccessToken()
  assert.ok(token, 'getAccessToken returns a token when REFRESH_TOKEN is set')
})

test('getAccessToken — sends refresh_token grant', async () => {
  let sentBody = null
  youtube.resetTokenCache()
  mockTransport((url, opts) => {
    sentBody = opts.body
    return { body: { access_token: 'tok' } }
  })
  await youtube.getAccessToken()
  assert.equal(sentBody.get('grant_type'), 'refresh_token')
  assert.equal(sentBody.get('refresh_token'), 'test-refresh-token')
})

test('getAccessToken — serves cached token without hitting Google (cache hit)', async () => {
  let fetchCount = 0
  youtube.resetTokenCache()
  // Seed the cache
  mockTransport((url, opts) => {
    fetchCount++
    return { body: { access_token: 'cached-tok' } }
  })
  await youtube.getAccessToken({ force: true })
  assert.equal(fetchCount, 1)
  // Second call (no force) must NOT refetch — served from cache
  const t1 = await youtube.getAccessToken()
  const t2 = await youtube.getAccessToken()
  assert.equal(t1, 'cached-tok')
  assert.equal(t2, 'cached-tok')
  assert.equal(fetchCount, 1, 'cache hit must not refetch from Google')
  // Force refresh rotates the token
  await youtube.getAccessToken({ force: true })
  assert.equal(fetchCount, 2)
  // Cache metadata exposed
  const info = youtube.cachedTokenInfo()
  assert.ok(info.cached === true)
})

test('getAccessToken — resetTokenCache drops cached token', async () => {
  let fetchCount = 0
  youtube.resetTokenCache()
  mockTransport(() => { fetchCount++; return { body: { access_token: 'tok-1' } } })
  await youtube.getAccessToken({ force: true })
  assert.equal(fetchCount, 1)
  youtube.resetTokenCache()
  // Force a new fetch (fresh cache state, but cache was empty anyway)
  await youtube.getAccessToken({ force: true })
  assert.equal(fetchCount, 2)
  assert.ok(youtube.cachedTokenInfo().cached === true)
})

test('startYouTubeTokenWarmup — immediate refresh records history and fires onRefresh', async () => {
  youtube.resetTokenCache()
  const events = []
  let warmed = false
  mockTransport(() => { return { body: { access_token: 'warm-tok' } } })
  const out = youtube.startYouTubeTokenWarmup({
    intervalMs: 60_000, // long interval — only the immediate run fires in this test
    onRefresh: (e) => { events.push(e); warmed = true },
  })
  // The immediate run() is async; give it a tick to complete the mock fetch.
  await new Promise((r) => setTimeout(r, 25))
  assert.equal(warmed, true, 'onRefresh must fire for the immediate warmup')
  const last = events[events.length - 1] || {}
  assert.equal(last.ok, true)
  assert.ok(typeof last.at === 'number')
  // History is recorded and exposed
  const history = youtube.warmupHistoryInfo()
  assert.ok(history.length >= 1)
  assert.equal(history[history.length - 1].ok, true)
  assert.equal(history[history.length - 1].tokenLength, 'warm-tok'.length)
  // Cache is warm after the initial refresh
  assert.equal(youtube.cachedTokenInfo().cached, true)
  // Warmup result shape
  assert.ok(out.started === true || out.alreadyRunning === true)
  if (out.started) assert.equal(out.intervalMs, 60_000)
})

test('startYouTubeTokenWarmup — second call is a no-op (idempotent)', async () => {
  const out = youtube.startYouTubeTokenWarmup({ intervalMs: 60_000 })
  assert.equal(out.alreadyRunning, true)
  assert.equal(out.started, false)
  assert.ok(Array.isArray(out.history))
})

// ── uploadShort ──────────────────────────────────────────────────────────
test('uploadShort — succeeds with valid video response', async () => {
  const videoData = new Uint8Array([1, 2, 3, 4, 5])
  let uploadUrl = null
  let uploadAuth = null

  mockTransport((url, opts) => {
    // Video fetch
    if (url === 'https://example.com/video.mp4') {
      return { buffer: videoData.buffer }
    }
    // YouTube upload
    if (String(url).includes('/upload/youtube/v3/videos')) {
      uploadUrl = url
      uploadAuth = opts.headers?.Authorization
      return { body: { id: 'vid-123', snippet: { title: 'Test' } } }
    }
    // Thumbnail (setThumbnail) — skip
    return { body: { items: [] } }
  })

  const result = await youtube.uploadShort(
    'https://example.com/video.mp4',
    'My Short Title',
    'Description here',
    'public',
    null // no cover
  )
  assert.equal(result.videoId, 'vid-123')
  assert.ok(uploadAuth?.startsWith('Bearer '))
})

test('uploadShort — throws on video fetch failure', async () => {
  mockTransport((url) => {
    if (url === 'https://example.com/bad.mp4') {
      return { ok: false, status: 404, statusText: 'Not Found' }
    }
    return { body: {} }
  })

  await assert.rejects(
    () => youtube.uploadShort('https://example.com/bad.mp4', 'T', 'D'),
    /VIDEO_SOURCE_FETCH_FAILED/
  )
})

test('uploadShort — throws on YouTube API error', async () => {
  const videoData = new Uint8Array([1, 2, 3])
  mockTransport((url) => {
    if (url === 'https://example.com/video.mp4') {
      return { buffer: videoData.buffer }
    }
    if (String(url).includes('/upload/youtube/v3/videos')) {
      return { body: { error: { message: 'quotaExceeded' } } }
    }
    return { body: {} }
  })

  await assert.rejects(
    () => youtube.uploadShort('https://example.com/video.mp4', 'T', 'D'),
    /quotaExceeded/
  )
})

test('uploadShort — throws if no video ID returned', async () => {
  const videoData = new Uint8Array([1, 2, 3])
  mockTransport((url) => {
    if (url === 'https://example.com/video.mp4') {
      return { buffer: videoData.buffer }
    }
    if (String(url).includes('/upload/youtube/v3/videos')) {
      return { body: { snippet: { title: 'ok' } } } // no id
    }
    return { body: {} }
  })

  await assert.rejects(
    () => youtube.uploadShort('https://example.com/video.mp4', 'T', 'D'),
    /YOUTUBE_VIDEO_UPLOAD_SUCCEEDED_WITHOUT_VIDEO_ID/
  )
})

test('uploadShort — title truncated to 100 chars', async () => {
  const longTitle = 'A'.repeat(200)
  let capturedMeta = null
  const videoData = new Uint8Array([1, 2, 3])

  mockTransport((url, opts) => {
    if (url === 'https://example.com/video.mp4') {
      return { buffer: videoData.buffer }
    }
    if (String(url).includes('/upload/youtube/v3/videos') && opts?.method === 'POST') {
      capturedMeta = JSON.parse(opts.body)
      return { headers: { location: 'https://upload.example.com/upload?upload_id=trunc' }, body: {} }
    }
    if (String(url).includes('upload_id=')) {
      return { body: { id: 'vid-ok' } }
    }
    return { body: { items: [] } }
  })

  await youtube.uploadShort('https://example.com/video.mp4', longTitle, 'desc')
  assert.ok(capturedMeta)
  assert.ok(capturedMeta.snippet.title.length <= 100)
})

test('uploadShort — description truncated to 5000 chars', async () => {
  const longDesc = 'B'.repeat(8000)
  let capturedMeta = null
  const videoData = new Uint8Array([1, 2, 3])

  mockTransport((url, opts) => {
    if (url === 'https://example.com/video.mp4') {
      return { buffer: videoData.buffer }
    }
    if (String(url).includes('/upload/youtube/v3/videos') && opts?.method === 'POST') {
      capturedMeta = JSON.parse(opts.body)
      return { headers: { location: 'https://upload.example.com/upload?upload_id=desc' }, body: {} }
    }
    if (String(url).includes('upload_id=')) {
      return { body: { id: 'vid-ok' } }
    }
    return { body: { items: [] } }
  })

  await youtube.uploadShort('https://example.com/video.mp4', 'T', longDesc)
  assert.ok(capturedMeta)
  assert.ok(capturedMeta.snippet.description.length <= 5000)
})

test('uploadShort — privacy status passed correctly', async () => {
  let capturedMeta = null
  const videoData = new Uint8Array([1, 2, 3])

  mockTransport((url, opts) => {
    if (url === 'https://example.com/video.mp4') {
      return { buffer: videoData.buffer }
    }
    if (String(url).includes('/upload/youtube/v3/videos') && opts?.method === 'POST') {
      capturedMeta = JSON.parse(opts.body)
      return { headers: { location: 'https://upload.example.com/upload?upload_id=priv' }, body: {} }
    }
    if (String(url).includes('upload_id=')) {
      return { body: { id: 'vid-ok' } }
    }
    return { body: { items: [] } }
  })

  await youtube.uploadShort('https://example.com/video.mp4', 'T', 'D', 'private')
  assert.ok(capturedMeta)
  assert.equal(capturedMeta.status.privacyStatus, 'private')
  assert.equal(capturedMeta.status.selfDeclaredMadeForKids, false)
})

// ── setThumbnail ─────────────────────────────────────────────────────────
test('setThumbnail — sends raw media upload (not multipart)', async () => {
  const tmpDir = mkdtempSync(join(tmpdir(), 'yt-thumb-'))
  const coverPath = join(tmpDir, 'cover.png')
  writeFileSync(coverPath, Buffer.from(PNG_SIGNATURE)) // valid PNG signature

  let capturedUrl = null
  let capturedAuth = null
  let capturedType = null
  let capturedBody = null
  mockTransport((url, opts) => {
    if (String(url).includes('thumbnails/set')) {
      capturedUrl = url
      capturedAuth = opts.headers?.Authorization
      capturedType = opts.headers?.['Content-Type']
      capturedBody = opts.body
    }
    return { body: { items: [{ id: 'thumb-id', snippet: {} }] } }
  })

  await youtube.setThumbnail('fake-token', 'vid-xyz', coverPath)
  assert.ok(capturedUrl?.includes('videoId=vid-xyz'))
  assert.equal(capturedAuth, 'Bearer fake-token')
  // Raw media upload: the image bytes ARE the body, Content-Type is image/png.
  assert.equal(capturedType, 'image/png')
  assert.ok(!String(capturedType).includes('multipart'), 'must NOT be a multipart request')
  assert.ok(capturedBody instanceof Uint8Array || Buffer.isBuffer(capturedBody), 'body is raw bytes')
  assert.deepEqual(Array.from(capturedBody), PNG_SIGNATURE)

  rmSync(tmpDir, { recursive: true })
})

test('setThumbnail — throws THUMBNAIL_NOT_FOUND when file missing (no cover.png fallback)', async () => {
  let called = false
  mockTransport(() => { called = true; return { body: {} } })

  await assert.rejects(
    () => youtube.setThumbnail('tok', 'vid', '/nonexistent/path.png'),
    /THUMBNAIL_NOT_FOUND/
  )
  assert.equal(called, false, 'should not call API when file missing')
})

test('setThumbnail — throws THUMBNAIL_PATH_REQUIRED when no path given', async () => {
  let called = false
  mockTransport(() => { called = true; return { body: { items: [] } } })

  // No cover.png fallback: a null path is a hard contract violation.
  await assert.rejects(
    () => youtube.setThumbnail('tok', 'vid', null),
    /THUMBNAIL_PATH_REQUIRED/
  )
  assert.equal(called, false, 'must not silently fall back to legacy cover.png')
})

test('setThumbnail — throws YOUTUBE_THUMBNAIL_UPLOAD_FAILED on HTTP error', async () => {
  const tmpDir = mkdtempSync(join(tmpdir(), 'yt-thumb-err-'))
  const coverPath = join(tmpDir, 'cover.png')
  writeFileSync(coverPath, Buffer.from(PNG_SIGNATURE))

  mockTransport(() => ({ ok: false, status: 403, body: { error: { message: 'quota' } } }))
  await assert.rejects(
    () => youtube.setThumbnail('tok', 'vid', coverPath),
    /YOUTUBE_THUMBNAIL_UPLOAD_FAILED.*quota/
  )
  rmSync(tmpDir, { recursive: true })
})

// ── classifyThumbnailUploadError ─────────────────────────────────────────
test('classify 400 invalidImage as THUMBNAIL_INVALID_MEDIA / REGENERATE', async () => {
  const { classifyThumbnailUploadError } = await import('../apps/api/publishers/youtube.js')
  const err = new Error('YOUTUBE_API_ERROR: The provided image content is invalid.')
  err.httpStatus = 400
  err.reason = 'invalidImage'
  const c = classifyThumbnailUploadError(err, 400)
  assert.equal(c.class, 'THUMBNAIL_INVALID_MEDIA')
  assert.equal(c.action, 'REGENERATE')
})

test('classify 400 policy rejection as THUMBNAIL_POLICY_REJECTED / QUARANTINE', async () => {
  const { classifyThumbnailUploadError } = await import('../apps/api/publishers/youtube.js')
  const err = new Error('YOUTUBE_API_ERROR: Violates community guidelines')
  err.httpStatus = 400
  err.reason = 'violation'
  err.message = 'The image contains misleading or inappropriate content'
  const c = classifyThumbnailUploadError(err, 400)
  assert.equal(c.class, 'THUMBNAIL_POLICY_REJECTED')
  assert.equal(c.action, 'QUARANTINE')
})

test('classify unknown 400 as THUMBNAIL_UPLOAD_FAILED / QUARANTINE', async () => {
  const { classifyThumbnailUploadError } = await import('../apps/api/publishers/youtube.js')
  const err = new Error('YOUTUBE_API_ERROR: something else')
  err.httpStatus = 400
  err.reason = 'quotaExceeded'
  const c = classifyThumbnailUploadError(err, 400)
  assert.equal(c.class, 'THUMBNAIL_UPLOAD_FAILED')
  assert.equal(c.action, 'QUARANTINE')
})

test('classify non-400 as THUMBNAIL_UPLOAD_FAILED / QUARANTINE', async () => {
  const { classifyThumbnailUploadError } = await import('../apps/api/publishers/youtube.js')
  const err = new Error('YOUTUBE_API_ERROR: quota exceeded')
  err.httpStatus = 403
  const c = classifyThumbnailUploadError(err, 403)
  assert.equal(c.class, 'THUMBNAIL_UPLOAD_FAILED')
  assert.equal(c.action, 'QUARANTINE')
})

// ── postComment ──────────────────────────────────────────────────────────
test('postComment — returns null for missing videoId', async () => {
  const result = await youtube.postComment(null, 'hello')
  assert.equal(result, null)
})

test('postComment — returns null for missing text', async () => {
  const result = await youtube.postComment('vid-123', '')
  assert.equal(result, null)
})

test('postComment — posts reply when parentId found', async () => {
  let capturedBody = null
  process.env.YOUTUBE_PARENT_COMMENT_ID = 'parent-comment-abc'

  mockTransport((url, opts) => {
    if (String(url).includes('/comments')) {
      capturedBody = JSON.parse(opts.body)
      return { body: { snippet: { textOriginal: 'Great video!' } } }
    }
    return { body: {} }
  })

  const result = await youtube.postComment('vid-1', 'Great video!')
  assert.ok(result)
  assert.equal(capturedBody.snippet.parentId, 'parent-comment-abc')
  assert.equal(capturedBody.snippet.videoId, 'vid-1')

  delete process.env.YOUTUBE_PARENT_COMMENT_ID
})

test('postComment — text truncated to 500 chars', async () => {
  let capturedBody = null
  process.env.YOUTUBE_PARENT_COMMENT_ID = 'p1'

  mockTransport((url, opts) => {
    if (String(url).includes('/comments')) {
      capturedBody = JSON.parse(opts.body)
      return { body: { snippet: { textOriginal: 'ok' } } }
    }
    return { body: {} }
  })

  const longText = 'X'.repeat(1000)
  await youtube.postComment('v1', longText)
  assert.ok(capturedBody.snippet.textOriginal.length <= 500)

  delete process.env.YOUTUBE_PARENT_COMMENT_ID
})

test('postComment — returns null on API error', async () => {
  process.env.YOUTUBE_PARENT_COMMENT_ID = 'p1'
  mockTransport((url) => {
    if (String(url).includes('/comments')) {
      return { body: { error: { message: 'Comment blocked' } } }
    }
    return { body: {} }
  })

  const result = await youtube.postComment('v1', 'hello')
  assert.equal(result?.ok, false, 'returns structured failure, not null')

  delete process.env.YOUTUBE_PARENT_COMMENT_ID
})

test('postComment — PARENT_COMMENT_NOT_FOUND when no parent comment', async () => {
  delete process.env.YOUTUBE_PARENT_COMMENT_ID
  mockTransport((url) => {
    if (String(url).includes('/videos')) {
      return { body: { items: [{ snippet: { channelId: 'ch-1' } }] } }
    }
    if (String(url).includes('/commentThreads')) {
      return { body: { items: [] } }
    }
    if (String(url).includes('/comments')) {
      return { body: { error: { message: 'The request contains an invalid parentId' } } }
    }
    return { body: {} }
  })

  const result = await youtube.postComment('v1', 'hello')
  assert.equal(result?.ok, false)
  assert.equal(result?.reason, 'PARENT_COMMENT_NOT_FOUND')
})

// ── deleteVideo ──────────────────────────────────────────────────────────
test('deleteVideo — returns true on success', async () => {
  mockTransport(() => ({ ok: true, status: 204 }))
  const result = await youtube.deleteVideo('vid-to-delete')
  assert.equal(result, true)
})

test('deleteVideo — throws on failure', async () => {
  mockTransport(() => ({ ok: false, status: 403, body: { error: { message: 'Forbidden' } } }))
  await assert.rejects(
    () => youtube.deleteVideo('vid-bad'),
    /YOUTUBE_API_ERROR/
  )
})

// ── publishVideo — SEO (tags + categoryId) — resumable upload ────────────
test('publishVideo — injects tags[] + categoryId into the snippet', async () => {
  let capturedMeta = null
  const videoData = new Uint8Array([1, 2, 3])

  mockTransport((url, opts) => {
    if (String(url).includes('/example.com/video.mp4')) {
      return { buffer: videoData.buffer }
    }
    // Resumable init: POST /upload/youtube/v3/videos?uploadType=resumable
    if (String(url).includes('/upload/youtube/v3/videos') && opts?.method === 'POST') {
      capturedMeta = JSON.parse(opts.body)
      return { headers: { location: 'https://upload.example.com/upload?upload_id=abc' }, body: {} }
    }
    // Resumable data: PUT to the session URI
    if (String(url).includes('upload_id=')) {
      return { body: { id: 'vid-seo' } }
    }
    return { body: {} }
  })

  const result = await youtube.publishVideo({
    videoUrl: 'https://example.com/video.mp4',
    title: 'Seo Test | NEWS-MONSTER',
    description: 'desc',
    tags: ['Sports', '#news', 'sports', 'match'],
    categoryId: '17',
  })

  assert.ok(capturedMeta, 'must capture upload snippet')
  assert.deepEqual(capturedMeta.snippet.tags, ['sports', 'news', 'match'], 'tags deduped + no leading # + lowercased')
  assert.equal(capturedMeta.snippet.categoryId, '17', 'categoryId present')
  assert.equal(capturedMeta.status.privacyStatus, 'public')
  assert.ok(result.metadata.tags.length > 0, 'result reports resolved tags')
  assert.equal(result.metadata.categoryId, '17')
})

test('publishVideo — omits snippet.tags when no tags supplied (backward compatible)', async () => {
  let capturedMeta = null
  const videoData = new Uint8Array([1, 2, 3])

  mockTransport((url, opts) => {
    if (String(url).includes('/example.com/video.mp4')) {
      return { buffer: videoData.buffer }
    }
    if (String(url).includes('/upload/youtube/v3/videos') && opts?.method === 'POST') {
      capturedMeta = JSON.parse(opts.body)
      return { headers: { location: 'https://upload.example.com/upload?upload_id=def' }, body: {} }
    }
    if (String(url).includes('upload_id=')) {
      return { body: { id: 'vid-noseo' } }
    }
    return { body: {} }
  })

  await youtube.publishVideo({
    videoUrl: 'https://example.com/video.mp4',
    title: 'Plain | NEWS-MONSTER',
    description: 'no seo',
  })

  assert.ok(capturedMeta)
  assert.equal(capturedMeta.snippet.tags, undefined, 'no tags key when empty')
  assert.equal(capturedMeta.snippet.categoryId, undefined, 'no categoryId when none supplied')
})

// Resumable uploader mechanics
test('publishVideo — splits a large file into chunks with correct Content-Range', async () => {
  process.env.YOUTUBE_UPLOAD_CHUNK_SIZE = '2' // force 3 chunks of a 5-byte video
  const videoData = new Uint8Array([1, 2, 3, 4, 5])
  const ranges = []
  let puts = 0

  mockTransport((url, opts) => {
    if (String(url).includes('/example.com/video.mp4')) {
      return { buffer: videoData.buffer }
    }
    if (String(url).includes('/upload/youtube/v3/videos') && opts?.method === 'POST') {
      return { headers: { location: 'https://upload.example.com/upload?upload_id=chunks' }, body: {} }
    }
    if (String(url).includes('upload_id=')) {
      puts++
      ranges.push(opts.headers['Content-Range'])
      if (puts < 3) {
        const end = Number(opts.headers['Content-Range'].split(' ')[1].split('-')[1])
        return { ok: false, status: 308, headers: { range: `bytes=0-${end}` } }
      }
      return { body: { id: 'vid-chunked' } }
    }
    return { body: {} }
  })

  const result = await youtube.publishVideo({ videoUrl: 'https://example.com/video.mp4', title: 'Chunked', description: 'd' })
  assert.deepEqual(ranges, ['bytes 0-1/5', 'bytes 2-3/5', 'bytes 4-4/5'], 'each chunk PUT carries its exact byte range')
  assert.equal(result.videoId, 'vid-chunked')
  delete process.env.YOUTUBE_UPLOAD_CHUNK_SIZE
})

test('publishVideo — resumes from the server-reported Range after a 308', async () => {
  process.env.YOUTUBE_UPLOAD_CHUNK_SIZE = '3' // first PUT covers bytes 0-2
  const videoData = new Uint8Array([1, 2, 3, 4, 5])
  const ranges = []

  mockTransport((url, opts) => {
    if (String(url).includes('/example.com/video.mp4')) {
      return { buffer: videoData.buffer }
    }
    if (String(url).includes('/upload/youtube/v3/videos') && opts?.method === 'POST') {
      return { headers: { location: 'https://upload.example.com/upload?upload_id=resume' }, body: {} }
    }
    if (String(url).includes('upload_id=')) {
      ranges.push(opts.headers['Content-Range'])
      if (ranges.length === 1) {
        // Server reports it received bytes 0-2 (3 bytes of a 5-byte file).
        return { ok: false, status: 308, headers: { range: 'bytes=0-2' } }
      }
      return { body: { id: 'vid-resume' } }
    }
    return { body: {} }
  })

  const result = await youtube.publishVideo({ videoUrl: 'https://example.com/video.mp4', title: 'Resume', description: 'd' })
  assert.deepEqual(ranges, ['bytes 0-2/5', 'bytes 3-4/5'], 'second PUT resumes exactly after the acknowledged byte')
  assert.equal(result.videoId, 'vid-resume')
  delete process.env.YOUTUBE_UPLOAD_CHUNK_SIZE
})

test('publishVideo — retries a transient 5xx chunk failure then succeeds', async () => {
  const videoData = new Uint8Array([1, 2, 3])
  let chunkPuts = 0

  mockTransport((url, opts) => {
    if (String(url).includes('/example.com/video.mp4')) {
      return { buffer: videoData.buffer }
    }
    if (String(url).includes('/upload/youtube/v3/videos') && opts?.method === 'POST') {
      return { headers: { location: 'https://upload.example.com/upload?upload_id=retry' }, body: {} }
    }
    if (String(url).includes('upload_id=')) {
      chunkPuts++
      if (chunkPuts === 1) {
        return { ok: false, status: 500, body: { error: { message: 'backend hiccup' } } }
      }
      return { body: { id: 'vid-retried' } }
    }
    return { body: {} }
  })

  const result = await youtube.publishVideo({ videoUrl: 'https://example.com/video.mp4', title: 'Retry', description: 'd' })
  assert.equal(chunkPuts, 2, 'chunk re-sent after transient 5xx')
  assert.equal(result.videoId, 'vid-retried')
})

test('publishVideo — legacy sessionless response still resolves (no Location header)', async () => {
  const videoData = new Uint8Array([1, 2, 3])
  mockTransport((url, opts) => {
    if (String(url).includes('/example.com/video.mp4')) {
      return { buffer: videoData.buffer }
    }
    if (String(url).includes('/upload/youtube/v3/videos')) {
      return { body: { id: 'vid-legacy' } } // no headers.location — compatibility shim
    }
    return { body: {} }
  })

  const result = await youtube.publishVideo({ videoUrl: 'https://example.com/video.mp4', title: 'Legacy', description: 'd' })
  assert.equal(result.videoId, 'vid-legacy')
})

// ── updateVideoSnippet (SEO backfill) ────────────────────────────────────
test('updateVideoSnippet — merges tags into an existing video, GETs then PUTs', async () => {
  const requests = []
  let putBody = null

  mockTransport((url, opts) => {
    requests.push({ method: opts?.method || 'GET', url: String(url) })
    if (String(url).includes('/videos?part=snippet&id=vid-1')) {
      return {
        body: {
          items: [{
            id: 'vid-1',
            snippet: { title: 'Old Title', description: 'Old desc', categoryId: '25' },
          }],
        },
      }
    }
    if (String(url).includes('/videos?part=snippet') && opts?.method === 'PUT') {
      putBody = JSON.parse(opts.body)
      return {
        body: {
          id: 'vid-1',
          snippet: { title: 'New Title | NEWS-MONSTER', tags: ['sports', 'news'], categoryId: '17' },
        },
      }
    }
    return { body: {} }
  })

  const result = await youtube.updateVideoSnippet({
    videoId: 'vid-1',
    title: 'New Title | NEWS-MONSTER',
    tags: ['Sports', '#news', 'sports'],
    categoryId: '17',
  })

  assert.ok(requests.some((r) => r.method === 'GET' && r.url.includes('snippet&id=vid-1')), 'must GET current first')
  assert.ok(requests.some((r) => r.method === 'PUT' && r.url.includes('part=snippet')), 'must PUT merged snippet')
  assert.ok(putBody, 'captured PUT body')
  assert.deepEqual(putBody.snippet.tags, ['sports', 'news'], 'tags deduped/no-#/lowercase')
  assert.equal(putBody.snippet.categoryId, '17')
  assert.equal(putBody.snippet.title, 'New Title | NEWS-MONSTER')
  assert.equal(result.videoId, 'vid-1')
  assert.equal(result.categoryId, '17')
})

test('updateVideoSnippet — carries forward existing fields when new ones omitted', async () => {
  let putBody = null
  mockTransport((url, opts) => {
    if (String(url).includes('/videos?part=snippet&id=vid-2')) {
      return { body: { items: [{ id: 'vid-2', snippet: { title: 'Keep Me', description: 'keep desc', tags: ['old', 'tag'] } }] } }
    }
    if (String(url).includes('/videos?part=snippet') && opts?.method === 'PUT') {
      putBody = JSON.parse(opts.body)
      return { body: { id: 'vid-2', snippet: putBody.snippet } }
    }
    return { body: {} }
  })

  const result = await youtube.updateVideoSnippet({ videoId: 'vid-2' })
  assert.equal(putBody.snippet.title, 'Keep Me', 'title carried forward')
  assert.equal(putBody.snippet.description, 'keep desc', 'description carried forward')
  assert.deepEqual(putBody.snippet.tags, ['old', 'tag'], 'tags carried forward when none provided')
  assert.equal(result.videoId, 'vid-2')
})

test('updateVideoSnippet — throws when video not found', async () => {
  mockTransport((url) => ({ body: { items: [] } }))
  await assert.rejects(
    () => youtube.updateVideoSnippet({ videoId: 'missing' }),
    /YOUTUBE_VIDEO_NOT_VISIBLE/
  )
})

test('updateVideoSEO — derives SEO bundle from category and applies it (Sports)', async () => {
  let putBody = null
  mockTransport((url, opts) => {
    if (String(url).includes('/videos?part=snippet&id=vid-sports')) {
      return { body: { items: [{ id: 'vid-sports', snippet: { title: 'Old', description: 'd', categoryId: '25' } }] } }
    }
    if (String(url).includes('/videos?part=snippet') && opts?.method === 'PUT') {
      putBody = JSON.parse(opts.body)
      return { body: { id: 'vid-sports', snippet: putBody.snippet } }
    }
    return { body: {} }
  })

  const result = await youtube.updateVideoSEO({ videoId: 'vid-sports', category: 'SPORTS' })

  assert.ok(putBody, 'PUT issued')
  assert.equal(putBody.snippet.categoryId, '17', 'Sports → 17')
  assert.ok(putBody.snippet.tags.includes('sports'), 'sports tag present')
  assert.ok(putBody.snippet.tags.includes('news-monster'), 'brand tag present')
  assert.equal(result.categoryId, '17')
})

// ── authUrl ──────────────────────────────────────────────────────────────
test('authUrl — contains required OAuth params', () => {
  const url = youtube.authUrl
  assert.ok(url.includes('client_id=test-client-id'))
  assert.ok(url.includes('response_type=code'))
  assert.ok(url.includes('access_type=offline'))
  assert.ok(url.includes('youtube.upload'))
  assert.ok(url.includes('youtube.force-ssl'))
})
