// Social Distribution — post-publish promotional posts.
// Covers: LinkedIn promo post, YouTube Community manual queue, idempotency,
// failure isolation, retry semantics, missing credentials, content shape.
//
// Run: node --test tests/social-distribution.test.mjs

import test from 'node:test'
import assert from 'node:assert/strict'
import Database from 'better-sqlite3'
import { mkdtempSync, writeFileSync, existsSync, readFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

import { SocialDistributionStore } from '../src/publishing/SocialDistributionStore.mjs'
import { SocialDistributionManager } from '../src/publishing/SocialDistributionManager.mjs'
import { SocialPostGenerator } from '../src/publishing/SocialPostGenerator.mjs'
import { LinkedInPublisher } from '../src/publishing/LinkedInPublisher.mjs'
import { YouTubeCommunityPublisher } from '../src/publishing/YouTubeCommunityPublisher.mjs'
import { withTransientRetry, isTransientError } from '../src/publishing/retry.mjs'

// Isolate the DB (in-memory) and the manual queue (temp dir) per test.
async function makeStore() {
  const db = new Database(':memory:')
  const { initSchema } = await import('../packages/database/news-engine.mjs')
  initSchema(db)
  return new SocialDistributionStore(db)
}

function makeQueueFile() {
  const dir = mkdtempSync(join(tmpdir(), 'ytq-'))
  return join(dir, 'manual-queue.json')
}

const VIDEO = {
  videoId: 'abc123xyz',
  title: 'Mall rink closes after 60 years of skate dates | NEWS-MONSTER',
  videoUrl: 'https://youtu.be/abc123xyz',
  youtubeShortsUrl: 'https://www.youtube.com/shorts/abc123xyz',
  thumbnailPath: null,
  category: 'business',
  hook: 'The rink where they fell in love is closing.',
  summary: 'A beloved mall skating rink shuts down after nearly 60 years.',
  hashtags: ['#mall', '#business', '#breaking', '#news-monster'],
}

// ── 8. generated post contains YouTube URL ────────────────────────────────
test('post generator — post contains YouTube URL', () => {
  const g = new SocialPostGenerator()
  const post = g.build(VIDEO)
  assert.ok(post.videoUrl === 'https://youtu.be/abc123xyz')
  assert.ok(post.platforms.linkedin.commentary.includes('https://www.youtube.com/shorts/abc123xyz'))
  assert.ok(post.platforms.youtubeCommunity.text.includes('https://youtu.be/abc123xyz'))
})

// ── 9. generated post contains hashtags ───────────────────────────────────
test('post generator — post contains hashtags', () => {
  const g = new SocialPostGenerator()
  const post = g.build(VIDEO)
  for (const tag of ['#mall', '#business']) {
    assert.ok(post.platforms.linkedin.commentary.includes(tag), `linkedin has ${tag}`)
    assert.ok(post.platforms.youtubeCommunity.text.includes(tag), `youtube has ${tag}`)
  }
})

// ── 10. thumbnail/image is attached (generator carries the path) ──────────
test('post generator — thumbnail path propagates to platforms', () => {
  const g = new SocialPostGenerator()
  const post = g.build({ ...VIDEO, thumbnailPath: 'output/cover.png' })
  assert.equal(post.thumbnailPath, 'output/cover.png')
  assert.equal(post.platforms.linkedin.thumbnailPath, 'output/cover.png')
  assert.equal(post.platforms.youtubeCommunity.thumbnailPath, 'output/cover.png')
})

// ── 1. successful YouTube video -> LinkedIn post ──────────────────────────
test('distribution — published video produces a LinkedIn promotional post', async () => {
  const store = await makeStore()
  let calls = 0
  const linkedIn = new LinkedInPublisher({
    accessToken: 'tok', memberUrn: 'urn:li:person:1',
    shareImage: async () => { calls++; return { id: 'urn:li:share:111', urn: 'urn:li:share:111' } },
  })
  // Provide a real thumbnail so pickThumbnail finds it
  const dir = mkdtempSync(join(tmpdir(), 'li-thumb-'))
  const thumbPath = join(dir, 'cover.png')
  writeFileSync(thumbPath, Buffer.from('fake-png'))
  linkedIn._shareImage = async () => { calls++; return { id: 'urn:li:share:111', urn: 'urn:li:share:111' } }

  const yt = new YouTubeCommunityPublisher({ queueFile: makeQueueFile() })
  const mgr = new SocialDistributionManager({ store, linkedIn, youtubeCommunity: yt })

  const out = await mgr.distribute({ ...VIDEO, thumbnailPath: thumbPath })
  assert.equal(out.results.linkedin.status, 'published')
  assert.equal(out.results.linkedin.postId, 'urn:li:share:111')
  assert.equal(calls, 1)
  // Persisted
  const row = store.get('abc123xyz', 'linkedin')
  assert.equal(row.status, 'published')
  assert.equal(row.post_id, 'urn:li:share:111')
  // YouTube Community correctly unsupported (NOT published)
  assert.equal(out.results['youtube-community'].status, 'unsupported')
})

// ── 2. YouTube Community unsupported + manual queue ────────────────────────
test('distribution — YouTube Community unsupported, payload queued for manual', async () => {
  const store = await makeStore()
  const queueFile = makeQueueFile()
  const linkedIn = new LinkedInPublisher({ accessToken: 'tok', memberUrn: 'urn', shareImage: async () => ({ id: 'urn:li:share:x' }) })
  const yt = new YouTubeCommunityPublisher({ queueFile })
  const mgr = new SocialDistributionManager({ store, linkedIn, youtubeCommunity: yt })
  const out = await mgr.distribute(VIDEO)

  assert.equal(out.results['youtube-community'].status, 'unsupported')
  assert.equal(out.results['youtube-community'].queued, true)
  const q = JSON.parse(readFileSync(queueFile, 'utf-8'))
  assert.equal(q.length, 1)
  assert.equal(q[0].videoId, 'abc123xyz')
  assert.ok(q[0].text.includes('https://youtu.be/abc123xyz'))
  const row = store.get('abc123xyz', 'youtube-community')
  assert.equal(row.status, 'unsupported')
})

// ── 3. LinkedIn failure does not fail YouTube publication ──────────────────
test('distribution — LinkedIn failure never fails the video/other platforms', async () => {
  const store = await makeStore()
  const linkedIn = new LinkedInPublisher({
    accessToken: 'tok', memberUrn: 'urn:li:person:1',
    shareImage: async () => { throw new Error('LinkedIn API exploded') },
  })
  const yt = new YouTubeCommunityPublisher({ queueFile: makeQueueFile(), support: { supported: true, reason: '' } })
  // Simulate official support => published
  yt.publish = async () => ({ platform: 'youtube-community', status: 'published', postId: 'post-1' })
  const mgr = new SocialDistributionManager({ store, linkedIn, youtubeCommunity: yt })

  const out = await mgr.distribute(VIDEO)
  // LinkedIn failed but recorded
  assert.equal(out.results.linkedin.status, 'failed')
  assert.equal(store.get('abc123xyz', 'linkedin').status, 'failed')
  // YouTube unaffected
  assert.equal(out.results['youtube-community'].status, 'published')
  assert.equal(store.get('abc123xyz', 'youtube-community').status, 'published')
})

// ── 4. duplicate worker execution does not create duplicate LinkedIn post ──
test('distribution — second run does NOT re-post (idempotent per video)', async () => {
  const store = await makeStore()
  let calls = 0
  const dir = mkdtempSync(join(tmpdir(), 'li-thumb-idempotent-'))
  const thumbPath = join(dir, 'cover.png')
  writeFileSync(thumbPath, Buffer.from('fake-png'))
  const linkedIn = new LinkedInPublisher({
    accessToken: 'tok', memberUrn: 'urn:li:person:1',
    shareImage: async () => { calls++; return { id: 'urn:li:share:222' } },
  })
  linkedIn._shareImage = async () => { calls++; return { id: 'urn:li:share:222' } }
  const yt = new YouTubeCommunityPublisher({ queueFile: makeQueueFile() })
  const mgr = new SocialDistributionManager({ store, linkedIn, youtubeCommunity: yt })

  const first = await mgr.distribute({ ...VIDEO, thumbnailPath: thumbPath })
  assert.equal(first.results.linkedin.status, 'published')
  assert.equal(calls, 1)

  const second = await mgr.distribute({ ...VIDEO, thumbnailPath: thumbPath })
  assert.equal(second.results.linkedin.status, 'published')
  assert.equal(second.results.linkedin.duplicate, true)
  assert.equal(calls, 1, 'shareImage called once across both runs')
  // Still one row
  const rows = store.db.prepare(`SELECT COUNT(*) c FROM social_distributions WHERE video_id='abc123xyz' AND platform='linkedin'`).get()
  assert.equal(rows.c, 1)
})

// ── 5. transient LinkedIn 429 retries ─────────────────────────────────────
test('retry — transient 429 is retried and eventually succeeds', async () => {
  let calls = 0
  const result = await withTransientRetry(async () => {
    calls++
    if (calls < 3) { const e = new Error('rate limited'); e.status = 429; throw e }
    return 'ok'
  }, { attempts: 3, baseMs: 1 })
  assert.equal(result, 'ok')
  assert.equal(calls, 3)
})

// ── 6. permanent 401 does NOT retry ──────────────────────────────────────
test('retry — permanent 401 throws immediately (no retry)', async () => {
  let calls = 0
  await assert.rejects(async () => {
    await withTransientRetry(async () => {
      calls++
      const e = new Error('unauthorized'); e.status = 401; throw e
    }, { attempts: 3, baseMs: 1 })
  }, /unauthorized/)
  assert.equal(calls, 1, '401 must not retry')
})

// ── 7. missing LinkedIn credentials -> clear skipped state ────────────────
test('distribution — missing LinkedIn credentials yields skipped state', async () => {
  const store = await makeStore()
  const linkedIn = new LinkedInPublisher({ accessToken: null, memberUrn: null })
  const yt = new YouTubeCommunityPublisher({ queueFile: makeQueueFile() })
  const mgr = new SocialDistributionManager({ store, linkedIn, youtubeCommunity: yt })
  const out = await mgr.distribute(VIDEO)
  assert.equal(out.results.linkedin.status, 'skipped')
  assert.ok(out.results.linkedin.reason?.includes('missing'), 'reason mentions missing credentials')
  const row = store.get('abc123xyz', 'linkedin')
  assert.equal(row.status, 'skipped')
})

// ── 11. YouTube Community unsupported is NOT reported as success ──────────
test('youtube-community — unsupported is not success', async () => {
  const yt = new YouTubeCommunityPublisher({ queueFile: makeQueueFile() })
  const out = await yt.publish({ videoId: 'abc', post: { title: 't', text: 't', thumbnailPath: null } })
  assert.equal(out.status, 'unsupported')
  assert.notEqual(out.status, 'published')
  assert.ok(out.reason.length > 0)
})

// ── extras ────────────────────────────────────────────────────────────────
test('store — begin is idempotent under UNIQUE conflict', async () => {
  const store = await makeStore()
  const a = store.begin({ videoId: 'dup1', platform: 'linkedin' })
  const b = store.begin({ videoId: 'dup1', platform: 'linkedin' })
  assert.equal(a.id, b.id)
})

test('youtube-community — support() reports official API status', () => {
  const yt = new YouTubeCommunityPublisher({ queueFile: makeQueueFile() })
  const sup = yt.support()
  assert.equal(sup.supported, false)
  assert.ok(sup.reason.toLowerCase().includes('community'))
})