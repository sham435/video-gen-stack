// Caption track upload — unit tests (no network, no quota).
//
// Covers: youtube.js captions.list / captions.insert (mock transport),
// classification ladder, CaptionsStateStore idempotency ledger, and the
// CaptionTrackPublisher orchestration contract (non-fatal, retry only
// transient, per-language state recording) via dependency injection.
//
// Run: node --test tests/captions-upload.test.mjs

import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const YOUTUBE_JS = '../apps/api/publishers/youtube.js'

// Set env BEFORE module import — youtube.js reads at top level.
process.env.YOUTUBE_CLIENT_ID = 'test-client-id'
process.env.YOUTUBE_CLIENT_SECRET = 'test-client-secret'
process.env.YOUTUBE_REFRESH_TOKEN = 'test-refresh-token'
process.env.YOUTUBE_REDIRECT_URI = 'http://localhost:3001/api/auth/youtube/callback'

// Same mock-transport shape as tests/youtube-publisher.test.mjs.
const OrigFetch = globalThis.fetch
function mockTransport(handler) {
  globalThis.fetch = async (url, opts) => {
    if (String(url).includes('oauth2.googleapis.com/token')) {
      return {
        ok: true, status: 200, statusText: 'OK',
        json: async () => ({ access_token: 'auto-token' }),
        arrayBuffer: async () => new ArrayBuffer(0),
        text: async () => '',
      }
    }
    const result = await handler(url, opts)
    return {
      ok: (result.status ?? 200) < 400,
      status: result.status ?? 200,
      statusText: (result.status ?? 200) < 400 ? 'OK' : 'Error',
      headers: { get: (k) => (result.headers ?? {})[String(k).toLowerCase()] },
      json: async () => result.body ?? {},
      arrayBuffer: async () => new ArrayBuffer(0),
      text: async () => result.text ?? '',
    }
  }
  function restore() { globalThis.fetch = OrigFetch }
  return restore
}

function tmpDir() {
  return mkdtempSync(join(tmpdir(), 'captions-test-'))
}

function writeSidecar(dir, content = '1\n00:00:00,000 --> 00:00:03,528\nதொடக்கக் கோடு\n') {
  const p = join(dir, 'captions.srt')
  writeFileSync(p, content)
  return p
}

function parseMultipart(body, boundary) {
  const raw = Buffer.isBuffer(body) ? body : Buffer.from(body)
  const text = raw.toString('utf8')
  const metaMatch = text.match(/Content-Type: application\/json; charset=UTF-8\r\n\r\n(\{[\s\S]*?\})\r\n/)
  const meta = metaMatch ? JSON.parse(metaMatch[1]) : null
  // BYTE offsets only — the metadata part carries multi-byte UTF-8 (native
  // labels), so string indices and byte positions diverge past it.
  const marker = Buffer.from('Content-Transfer-Encoding: binary\r\n\r\n')
  const mediaStart = raw.indexOf(marker) + marker.length
  const mediaEnd = raw.indexOf(Buffer.from(`\r\n--${boundary}--`), mediaStart)
  const media = mediaEnd > mediaStart ? raw.subarray(mediaStart, mediaEnd) : null
  return { meta, media }
}

const youtube = await import(new URL(YOUTUBE_JS, import.meta.url).href)
const { publishCaptionTrack, sidecarLooksValid } = await import('../src/publishing/CaptionTrackPublisher.mjs')
const { CaptionsStateStore } = await import('../src/publishing/CaptionsStateStore.mjs')

// ── youtube.js: captions.list ───────────────────────────────────────────────
test('captions.list — GET with part+videoId, maps snippet + trackKind', async () => {
  let seenUrl = null
  let auth = null
  const restore = mockTransport(async (url, opts) => {
    seenUrl = String(url)
    auth = opts.headers?.Authorization
    return {
      status: 200,
      body: {
        kind: 'youtube#captionListResponse',
        items: [
          { id: 'AUh-1', trackKind: 'asr', snippet: { videoId: 'vid1', language: 'ta', status: { uploadStatus: 'serving' } } },
          { id: 'AUh-2', trackKind: 'standard', snippet: { videoId: 'vid1', language: 'ta', name: 'தமிழ்' } },
        ],
      },
    }
  })
  try {
    const tracks = await youtube.listCaptionTracks('vid1')
    assert.match(seenUrl, /^https:\/\/www\.googleapis\.com\/youtube\/v3\/captions\?/)
    assert.match(seenUrl, /part=snippet/)
    assert.match(seenUrl, /videoId=vid1/)
    assert.match(String(auth), /^Bearer /)
    assert.equal(tracks.length, 2)
    assert.equal(tracks[0].trackKind, 'asr')
    assert.equal(tracks[1].language, 'ta')
    assert.equal(tracks[1].name, 'தமிழ்')
  } finally { restore() }
})

test('captions.list — API error carries .status for retry classification', async () => {
  const restore = mockTransport(async () => ({
    status: 403,
    body: { error: { code: 403, message: 'forbidden', errors: [{ reason: 'forbidden' }] } },
  }))
  try {
    await assert.rejects(
      () => youtube.listCaptionTracks('vidX'),
      (e) => e.status === 403 && /forbidden/i.test(e.message),
    )
  } finally { restore() }
})

// ── youtube.js: captions.insert ─────────────────────────────────────────────
test('captions.insert — success POSTs multipart with snippet resource + exact track bytes', async () => {
  let seenUrl = null
  let seenMethod = null
  let seenBody = null
  let seenHeaders = null
  const srt = '1\n00:00:00,000 --> 00:00:01,500\nமுதல் வரி\n'
  const restore = mockTransport(async (url, opts) => {
    seenUrl = String(url)
    seenMethod = opts.method
    seenBody = opts.body
    seenHeaders = opts.headers
    return {
      status: 200,
      body: { kind: 'youtube#caption', id: 'AUh-new-1', snippet: { videoId: 'vid1', language: 'ta', name: 'தமிழ்', status: { uploadStatus: 'processing' } } },
    }
  })
  try {
    const dir = tmpDir()
    const srtPath = writeSidecar(dir, srt)
    const result = await youtube.insertCaptionTrack({ videoId: 'vid1', language: 'ta', name: 'தமிழ்', filePath: srtPath })

    assert.equal(seenMethod, 'POST')
    assert.match(seenUrl, /upload\/youtube\/v3\/captions\?part=snippet/)
    assert.match(String(seenHeaders['Content-Type']), /^multipart\/related; boundary=/)
    const boundary = String(seenHeaders['Content-Type']).match(/boundary="?([^"\s]+)"?/)[1]
    const { meta, media } = parseMultipart(seenBody, boundary)
    assert.equal(meta.snippet.videoId, 'vid1')
    assert.equal(meta.snippet.language, 'ta')
    assert.equal(meta.snippet.name, 'தமிழ்')
    assert.equal(meta.snippet.isDraft, false)
    assert.ok(Buffer.isBuffer(media))
    assert.equal(media.toString('utf8'), srt)
    assert.equal(result.id, 'AUh-new-1')
    assert.equal(result.bytes, Buffer.byteLength(srt))
  } finally { restore() }
})

test('captions.insert — 409 captionExists is classified as SKIP and carries status', async () => {
  const restore = mockTransport(async () => ({
    status: 409,
    body: { error: { code: 409, message: 'The video already has a caption track with the given language and name.', errors: [{ reason: 'captionExists' }], status: 'CONFLICT' } },
  }))
  try {
    const dir = tmpDir()
    const srtPath = writeSidecar(dir)
    await assert.rejects(
      () => youtube.insertCaptionTrack({ videoId: 'vid1', language: 'ta', name: 'தமிழ்', filePath: srtPath }),
      (e) => e.status === 409 && e.captionFailure.class === 'CAPTION_TRACK_EXISTS' && e.captionFailure.action === 'SKIP',
    )
  } finally { restore() }
})

test('captions.insert — input validation', async () => {
  const restore = mockTransport(async () => ({ status: 200, body: {} }))
  try {
    const dir = tmpDir()
    await assert.rejects(() => youtube.insertCaptionTrack({ language: 'ta', name: 'x', filePath: join(dir, 'a.srt') }), /YOUTUBE_VIDEO_ID_REQUIRED/)
    await assert.rejects(() => youtube.insertCaptionTrack({ videoId: 'v', name: 'x', filePath: join(dir, 'a.srt') }), /CAPTION_LANGUAGE_REQUIRED/)
    await assert.rejects(() => youtube.insertCaptionTrack({ videoId: 'v', language: 'ta', filePath: join(dir, 'a.srt') }), /CAPTION_NAME_REQUIRED/)
    await assert.rejects(() => youtube.insertCaptionTrack({ videoId: 'v', language: 'ta', name: 'x'.repeat(151), filePath: join(dir, 'a.srt') }), /CAPTION_NAME_TOO_LONG/)
    await assert.rejects(() => youtube.insertCaptionTrack({ videoId: 'v', language: 'ta', name: 'x', filePath: join(dir, 'missing.srt') }), /CAPTION_FILE_NOT_FOUND/)
    const empty = join(dir, 'empty.srt')
    writeFileSync(empty, '')
    await assert.rejects(() => youtube.insertCaptionTrack({ videoId: 'v', language: 'ta', name: 'x', filePath: empty }), /CAPTION_SIDECAR_EMPTY/)
  } finally { restore() }
})

// ── classifyCaptionInsertError ladder ──────────────────────────────────────
test('classification ladder — 409 SKIP, 400 FIX_INPUT, 404 SKIP_AUDIT, 403 QUARANTINE, unknown QUARANTINE', () => {
  assert.deepEqual(youtube.classifyCaptionInsertError({ reason: 'captionExists' }, 409), { class: 'CAPTION_TRACK_EXISTS', action: 'SKIP', reason: 'identical language+name track already uploaded' })
  assert.deepEqual(youtube.classifyCaptionInsertError({ reason: 'contentRequired' }, 400).action, 'FIX_INPUT')
  assert.deepEqual(youtube.classifyCaptionInsertError({ reason: 'invalidMetadata' }, 400).action, 'FIX_INPUT')
  assert.deepEqual(youtube.classifyCaptionInsertError({ reason: 'nameTooLong' }, 400).class, 'CAPTION_INVALID_METADATA')
  assert.deepEqual(youtube.classifyCaptionInsertError({ reason: 'videoNotFound' }, 404).action, 'SKIP_AUDIT')
  assert.deepEqual(youtube.classifyCaptionInsertError({ reason: 'forbidden' }, 403).action, 'QUARANTINE')
  assert.equal(youtube.classifyCaptionInsertError({ reason: '' }, 500).class, 'CAPTION_UPLOAD_FAILED')
})

// ── CaptionsStateStore ledger ───────────────────────────────────────────────
test('store — record/get roundtrip with videoId|language keying', () => {
  const dir = tmpDir()
  const store = new CaptionsStateStore({ file: join(dir, 'state.json') })
  store.record({ videoId: 'A', language: 'si', name: 'සිංහල', status: 'uploaded', trackId: 't-1', file: 'output-si/captions.srt' })
  store.record({ videoId: 'A', language: 'ta', name: 'தமிழ்', status: 'exists', file: 'output-ta/captions.srt' })
  assert.equal(store.get('A', 'si').status, 'uploaded')
  assert.equal(store.get('A', 'si').trackId, 't-1')
  assert.equal(store.get('A', 'ta').status, 'exists')
  assert.equal(store.get('A', 'en'), null)
  assert.equal(CaptionsStateStore.key('V', 'ta'), 'V|ta')
  assert.ok(store.isUploaded('A', 'si'))
  assert.ok(!store.isUploaded('A', 'ta'))
  const copy = store.all()
  delete copy['A|si']
  assert.equal(store.get('A', 'si').status, 'uploaded') // defensive copy honored
})

test('store — attempts accumulate, errors clear on success, corrupt file regenerates', () => {
  const dir = tmpDir()
  const file = join(dir, 'state.json')
  const s1 = new CaptionsStateStore({ file })
  s1.record({ videoId: 'V', language: 'ta', status: 'failed', attempts: 2, lastError: 'HTTP 500' })
  const s2 = new CaptionsStateStore({ file })
  s2.record({ videoId: 'V', language: 'ta', status: 'failed', attempts: 1, lastError: 'HTTP 429' })
  const mid = s2.get('V', 'ta')
  assert.equal(mid.status, 'failed')
  assert.equal(mid.attempts, 3)
  assert.equal(mid.lastError, 'HTTP 429')
  s2.record({ videoId: 'V', language: 'ta', name: 'தமிழ்', status: 'uploaded', trackId: 't-9' })
  const done = s2.get('V', 'ta')
  assert.equal(done.attempts, 4) // failed history preserved
  assert.equal(done.lastError, null)
  assert.equal(done.trackId, 't-9')
  assert.equal(new CaptionsStateStore({ file }).get('V', 'ta').status, 'uploaded')
  // Corrupt → regenerate, no throw
  writeFileSync(file, '{not json')
  const s3 = new CaptionsStateStore({ file })
  assert.deepEqual(s3.all(), {})
  s3.record({ videoId: 'V', language: 'si', status: 'exists' })
  assert.equal(s3.get('V', 'si').status, 'exists')
  // Invalid record args throw
  assert.throws(() => new CaptionsStateStore({ file: join(dir, 'x.json') }).record({ language: 'ta', status: 'uploaded' }), /CAPTION_STATE_RECORD_INVALID/)
})

// ── CaptionTrackPublisher orchestration (injected publisher) ────────────────
function fakePublisher({ list = [], listError = null, insertImpl = null, insertFailures = [] }) {
  const counts = { list: 0, insert: 0, insertPayloads: [] }
  return {
    counts,
    listCaptionTracks: async () => {
      counts.list++
      if (listError) throw listError
      return list
    },
    insertCaptionTrack: async (payload) => {
      counts.insert++
      counts.insertPayloads.push(payload)
      if (insertFailures.length) {
        const fail = insertFailures.shift()
        if (fail) throw fail
      }
      if (insertImpl) return insertImpl(payload)
      return { id: 'AUh-fake-1', bytes: 128 }
    },
    classifyCaptionInsertError: youtube.classifyCaptionInsertError,
  }
}

test('orchestrator — happy path: verify remote, insert, record uploaded', async () => {
  const dir = tmpDir()
  const srtPath = writeSidecar(dir)
  const storeFile = join(dir, 'state.json')
  const fake = fakePublisher({})
  const r = await publishCaptionTrack(
    { videoId: 'V1', srtPath, language: 'ta', name: 'தமிழ்', storeFile },
    { _publisher: fake },
  )
  assert.equal(r.status, 'uploaded')
  assert.equal(r.trackId, 'AUh-fake-1')
  assert.equal(r.attempts, 1)
  assert.equal(fake.counts.list, 1)
  assert.equal(fake.counts.insert, 1)
  assert.equal(fake.counts.insertPayloads[0].language, 'ta')
  const entry = new CaptionsStateStore({ file: storeFile }).get('V1', 'ta')
  assert.equal(entry.status, 'uploaded')
  assert.equal(entry.trackId, 'AUh-fake-1')
})

test('orchestrator — transient 5xx retried to success; attempts recorded', async () => {
  const dir = tmpDir()
  const srtPath = writeSidecar(dir)
  const storeFile = join(dir, 'state.json')
  const fail500 = Object.assign(new Error('server 500'), { status: 500 })
  const fake = fakePublisher({ insertFailures: [fail500, fail500] })
  const r = await publishCaptionTrack(
    { videoId: 'V2', srtPath, language: 'si', name: 'සිංහල', storeFile, retryBaseMs: 1, retryMaxMs: 2 },
    { _publisher: fake },
  )
  assert.equal(r.status, 'uploaded')
  assert.equal(r.attempts, 3)
  const entry = new CaptionsStateStore({ file: storeFile }).get('V2', 'si')
  assert.equal(entry.status, 'uploaded')
  assert.equal(entry.attempts, 3)
})

test('orchestrator — 409 on insert → exists (no retry), never fails the call', async () => {
  const dir = tmpDir()
  const srtPath = writeSidecar(dir)
  const storeFile = join(dir, 'state.json')
  const fail409 = Object.assign(new Error('captionExists'), { status: 409, reason: 'captionExists' })
  const fake = fakePublisher({ insertFailures: [fail409] })
  const r = await publishCaptionTrack(
    { videoId: 'V3', srtPath, language: 'ta', name: 'தமிழ்', storeFile, retryBaseMs: 1 },
    { _publisher: fake },
  )
  assert.equal(r.status, 'exists')
  assert.equal(fake.counts.insert, 1) // 409 never retried
  assert.equal(new CaptionsStateStore({ file: storeFile }).get('V3', 'ta').status, 'exists')
})

test('orchestrator — remote manual track for the language → exists, insert never called', async () => {
  const dir = tmpDir()
  const srtPath = writeSidecar(dir)
  const storeFile = join(dir, 'state.json')
  const fake = fakePublisher({
    list: [
      { id: 'AUh-1', trackKind: 'asr', language: 'ta', name: 'Tamil (auto)' },
      { id: 'AUh-2', trackKind: 'standard', language: 'ta', name: 'தமிழ்' },
    ],
  })
  const r = await publishCaptionTrack(
    { videoId: 'V4', srtPath, language: 'ta', name: 'தமிழ்', storeFile },
    { _publisher: fake },
  )
  assert.equal(r.status, 'exists')
  assert.equal(r.trackId, 'AUh-2')
  assert.equal(fake.counts.insert, 0)
})

test('orchestrator — ASR-only remote tracks do NOT block our insert', async () => {
  const dir = tmpDir()
  const srtPath = writeSidecar(dir)
  const storeFile = join(dir, 'state.json')
  const fake = fakePublisher({ list: [{ id: 'AUh-asr', trackKind: 'asr', language: 'si', name: 'Sinhala (auto)' }] })
  const r = await publishCaptionTrack(
    { videoId: 'V5', srtPath, language: 'si', name: 'සිංහල', storeFile, retryBaseMs: 1 },
    { _publisher: fake },
  )
  assert.equal(r.status, 'uploaded')
  assert.equal(fake.counts.insert, 1)
})

test('orchestrator — LIVE shape: name-less track with no trackKind is a machine row, insert proceeds', async () => {
  // Verified live via captions.list on the channel (2026-10-27): the API omits
  // trackKind and machine/ASR rows carry name:"" — these must never block our
  // named insert (this exact case is what the first backfill hit).
  const dir = tmpDir()
  const srtPath = writeSidecar(dir)
  const storeFile = join(dir, 'state.json')
  const fake = fakePublisher({ list: [{ id: 'AUh-live-1', language: 'si', name: '', isAutoSynced: false, isDraft: false, uploadStatus: 'serving' }] })
  const r = await publishCaptionTrack(
    { videoId: 'V5b', srtPath, language: 'si', name: 'සිංහල', storeFile, retryBaseMs: 1 },
    { _publisher: fake },
  )
  assert.equal(r.status, 'uploaded')
  assert.equal(fake.counts.insert, 1)
})

test('orchestrator — store fast path: uploaded state → zero API calls', async () => {
  const dir = tmpDir()
  const srtPath = writeSidecar(dir)
  const storeFile = join(dir, 'state.json')
  new CaptionsStateStore({ file: storeFile }).record({ videoId: 'V6', language: 'ta', status: 'uploaded', trackId: 't-0' })
  const fake = fakePublisher({})
  const r = await publishCaptionTrack(
    { videoId: 'V6', srtPath, language: 'ta', name: 'தமிழ்', storeFile },
    { _publisher: fake },
  )
  assert.equal(r.status, 'skipped')
  assert.equal(r.reason, 'ALREADY_UPLOADED_STATE')
  assert.equal(fake.counts.list, 0)
  assert.equal(fake.counts.insert, 0)
})

test('orchestrator — forceRemoteCheck heals store-vs-remote divergence via insert attempt', async () => {
  const dir = tmpDir()
  const srtPath = writeSidecar(dir)
  const storeFile = join(dir, 'state.json')
  new CaptionsStateStore({ file: storeFile }).record({ videoId: 'V7', language: 'ta', status: 'uploaded', trackId: 't-0' })
  const fake = fakePublisher({ list: [] }) // store says uploaded, YouTube disagrees
  const r = await publishCaptionTrack(
    { videoId: 'V7', srtPath, language: 'ta', name: 'தமிழ்', storeFile, forceRemoteCheck: true, skipFastWhenUploaded: true, retryBaseMs: 1 },
    { _publisher: fake },
  )
  assert.equal(r.status, 'uploaded')
  assert.equal(fake.counts.insert, 1)
})

test('orchestrator — exhausted transient failures → failed with attempts, video stays published', async () => {
  const dir = tmpDir()
  const srtPath = writeSidecar(dir)
  const storeFile = join(dir, 'state.json')
  const fail503 = Object.assign(new Error('unavailable'), { status: 503 })
  const fake = fakePublisher({ insertFailures: [fail503, fail503, fail503] })
  const r = await publishCaptionTrack(
    { videoId: 'V8', srtPath, language: 'ta', name: 'தமிழ்', storeFile, attempts: 3, retryBaseMs: 1, retryMaxMs: 2 },
    { _publisher: fake },
  )
  assert.equal(r.status, 'failed')
  assert.equal(r.attempts, 3)
  assert.match(String(r.error), /unavailable/)
  const entry = new CaptionsStateStore({ file: storeFile }).get('V8', 'ta')
  assert.equal(entry.status, 'failed')
  assert.equal(entry.attempts, 3)
})

test('orchestrator — list failure does not block insert (409 backstop covers dupes)', async () => {
  const dir = tmpDir()
  const srtPath = writeSidecar(dir)
  const storeFile = join(dir, 'state.json')
  const fake = fakePublisher({ listError: new TypeError('fetch failed') })
  const r = await publishCaptionTrack(
    { videoId: 'V9', srtPath, language: 'ta', name: 'தமிழ்', storeFile, retryBaseMs: 1 },
    { _publisher: fake },
  )
  assert.equal(r.status, 'uploaded') // insert succeeded despite list failure
  assert.equal(fake.counts.insert, 1)
})

test('orchestrator — inserts that throw transport-ish errors without status are retried as transient', async () => {
  const dir = tmpDir()
  const srtPath = writeSidecar(dir)
  const storeFile = join(dir, 'state.json')
  // fetch-layer errors: TypeError without .status/'fetch failed' message — these
  // normalize onto a synthetic 5xx so withTransientRetry treats them transient.
  const fake = fakePublisher({ insertFailures: [new TypeError('fetch failed'), new TypeError('fetch failed')] })
  const r = await publishCaptionTrack(
    { videoId: 'V10', srtPath, language: 'si', name: 'සිංහල', storeFile, attempts: 3, retryBaseMs: 1, retryMaxMs: 2 },
    { _publisher: fake },
  )
  assert.equal(r.status, 'uploaded')
  assert.equal(r.attempts, 3)
})

test('orchestrator — skipped paths: no sidecar, empty sidecar, missing inputs', async () => {
  const dir = tmpDir()
  const storeFile = join(dir, 'state.json')
  const fake = fakePublisher({})
  let r = await publishCaptionTrack({ videoId: 'Va', srtPath: join(dir, 'nope.srt'), language: 'ta', storeFile }, { _publisher: fake })
  assert.equal(r.status, 'skipped')
  assert.equal(r.reason, 'NO_SIDECAR')
  const empty = join(dir, 'empty.srt')
  writeFileSync(empty, '')
  r = await publishCaptionTrack({ videoId: 'Va', srtPath: empty, language: 'ta', storeFile }, { _publisher: fake })
  assert.equal(r.status, 'skipped')
  assert.equal(r.reason, 'EMPTY_SIDECAR')
  r = await publishCaptionTrack({ videoId: 'Va', language: 'ta', storeFile }, { _publisher: fake })
  assert.equal(r.status, 'skipped')
  assert.equal(r.reason, 'NO_SIDECAR') // srtPath itself missing → sidecar gate, not input gate
  r = await publishCaptionTrack({ language: 'ta', srtPath: join(dir, 'a.srt'), storeFile }, { _publisher: fake })
  assert.equal(r.status, 'skipped')
  assert.equal(r.reason, 'CAPTION_INPUT_MISSING') // videoId missing
  assert.equal(fake.counts.list, 0)
  assert.equal(fake.counts.insert, 0)
})

test('orchestrator — never throws even when the injected publisher is broken', async () => {
  const dir = tmpDir()
  const srtPath = writeSidecar(dir)
  const storeFile = join(dir, 'state.json')
  const broken = { listCaptionTracks: null, insertCaptionTrack: null, classifyCaptionInsertError: null }
  const r = await publishCaptionTrack({ videoId: 'Vb', srtPath, language: 'ta', name: 'தமிழ்', storeFile }, { _publisher: broken })
  assert.equal(r.status, 'failed')
  assert.ok(r.error)
  const entry = new CaptionsStateStore({ file: storeFile }).get('Vb', 'ta')
  assert.equal(entry.status, 'failed')
})

test('sidecarLooksValid — SRT counter, WEBVTT header, junk, missing file', () => {
  const dir = tmpDir()
  const srtPath = writeSidecar(dir)
  assert.equal(sidecarLooksValid(srtPath), true)
  const vtt = join(dir, 'c.vtt')
  writeFileSync(vtt, 'WEBVTT\n\n1\n00:00:00.000 --> 00:00:01.000\nhi\n')
  assert.equal(sidecarLooksValid(vtt), true)
  const junk = join(dir, 'junk.srt')
  writeFileSync(junk, 'this is not a subtitle file\nmore junk')
  assert.equal(sidecarLooksValid(junk), false)
  assert.equal(sidecarLooksValid(join(dir, 'missing.srt')), false)
})

// afterAll cleanup: tmp dirs are in the OS temp — no cleanup required beyond
// the node test runner's process teardown.
