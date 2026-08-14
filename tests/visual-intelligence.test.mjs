import { test } from 'node:test'
import assert from 'node:assert'
import { createCanvas } from '@napi-rs/canvas'
import { extractImageMetadata, dHashDistance, dHashSimilarity, pHashDistance, pHashSimilarity } from '../src/assets/ImageMetadata.mjs'
import { compareAssets, rejectDuplicates, clusterDuplicates, DUP_THRESHOLD } from '../src/assets/DuplicateDetector.mjs'
import { ImageDatabase } from '../src/assets/ImageDatabase.mjs'
import { AssetUsageTracker } from '../src/assets/AssetUsageTracker.mjs'
import { ImageRanker } from '../src/assets/ImageRanker.mjs'
import { SceneVisualPlanner, DIVERSITY } from '../src/assets/SceneVisualPlanner.mjs'

function pngBytes(color = '#ff0000', w = 64, h = 64) {
  const c = createCanvas(w, h)
  const g = c.getContext('2d')
  g.fillStyle = color
  g.fillRect(0, 0, w, h)
  return c.toBuffer('image/png')
}

// Structured image so dHash has content (flat colors all hash to 0)
function patternBytes({ left = '#ff0000', right = '#0000ff', w = 64, h = 64 } = {}) {
  const c = createCanvas(w, h)
  const g = c.getContext('2d')
  g.fillStyle = left
  g.fillRect(0, 0, w / 2, h)
  g.fillStyle = right
  g.fillRect(w / 2, 0, w / 2, h)
  return c.toBuffer('image/png')
}

test('ImageMetadata — sha256 + dHash deterministic and content-sensitive', async () => {
  const a = patternBytes()
  const b = patternBytes()
  const c = patternBytes({ left: '#00ff00', right: '#ffff00' })

  const ma = await extractImageMetadata(a, { url: 'https://x/a.png' })
  const mb = await extractImageMetadata(b, { url: 'https://x/b.png' })
  const mc = await extractImageMetadata(c, { url: 'https://x/c.png' })

  assert.ok(ma.sha256.length === 64, 'sha256 hex')
  assert.ok(ma.dHash.length === 16, '64-bit dHash hex')
  assert.equal(ma.sha256, mb.sha256, 'identical bytes → same sha256')
  assert.equal(ma.dHash, mb.dHash, 'identical bytes → same dHash')
  assert.notEqual(ma.dHash, mc.dHash, 'different color → different dHash')
  assert.equal(ma.width, 64)
  assert.equal(ma.height, 64)
  assert.equal(ma.aspect, 1)
  assert.equal(ma.entity, null)
  assert.deepEqual(ma.tags, [])
})

test('ImageMetadata — dHash robust to resize (near-duplicate)', async () => {
  // brightness DECREASES left→right here (red 76 > blue 29) → non-zero hash bits
  const big = patternBytes({ left: '#ff0000', right: '#0000ff', w: 320, h: 480 })
  const small = patternBytes({ left: '#ff0000', right: '#0000ff', w: 64, h: 96 })
  // brightness INCREASES left→right → opposite bit pattern
  const other = patternBytes({ left: '#0000ff', right: '#ff0000', w: 320, h: 480 })

  const mBig = await extractImageMetadata(big)
  const mSmall = await extractImageMetadata(small)
  const mOther = await extractImageMetadata(other)

  const dSame = dHashDistance(mBig.dHash, mSmall.dHash)
  const dDiff = dHashDistance(mBig.dHash, mOther.dHash)
  assert.ok(dSame <= DUP_THRESHOLD.near, `resized same content is near-dup (got ${dSame})`)
  assert.ok(dDiff > DUP_THRESHOLD.near, `different content is not near-dup (got ${dDiff})`)
  assert.ok(dHashSimilarity(mBig.dHash, mBig.dHash) === 1, 'self similarity = 1')
})

test('DuplicateDetector — exact / near / derived tiers', () => {
  const a = { sha256: 'aa', dHash: '0'.repeat(16), url: 'a' }
  const b = { sha256: 'bb', dHash: '0'.repeat(16), url: 'b' }
  const c = { sha256: 'cc', dHash: 'f'.repeat(16), url: 'c' }
  const d = { sha256: 'aa', dHash: '1'.repeat(16), url: 'd' }

  assert.equal(compareAssets(a, d).kind, 'exact')
  assert.equal(compareAssets(a, d).dup, true)
  assert.equal(compareAssets(a, b).kind, 'near')
  assert.equal(compareAssets(a, b).dup, true)
  assert.equal(compareAssets(a, c).dup, false)
})

test('DuplicateDetector — rejectDuplicates filters candidates against known set', () => {
  const known = [
    { sha256: 'k1', dHash: '0'.repeat(16) },
    { sha256: 'k2', dHash: 'e'.repeat(16) },
  ]
  const candidates = [
    { sha256: 'c1', dHash: '0'.repeat(16), url: 'dup-near' },
    { sha256: 'c2', dHash: 'c'.repeat(16), url: 'fresh' },
    { sha256: 'k1', dHash: '1'.repeat(16), url: 'dup-exact' },
  ]
  const out = rejectDuplicates(candidates, known)
  assert.equal(out.length, 1)
  assert.equal(out[0].url, 'fresh')
})

test('DuplicateDetector — clusterDuplicates groups content families', () => {
  const assets = [
    { sha256: 'a', dHash: '0'.repeat(16), url: '1' },
    { sha256: 'b', dHash: '0'.repeat(16), url: '2' },
    { sha256: 'c', dHash: 'f'.repeat(16), url: '3' },
  ]
  const clusters = clusterDuplicates(assets)
  assert.equal(clusters.length, 2)
  assert.equal(clusters[0].members.length, 2)
  assert.equal(clusters[1].members.length, 1)
})

test('ImageDatabase — upsert/get/usage round-trip (in-memory)', async () => {
  const db = new ImageDatabase(':memory:')
  const meta = await extractImageMetadata(pngBytes('#ff0000'), { url: 'https://pexels.com/1', entity: 'apple' })
  const row = db.upsert(meta)
  assert.equal(row.sha256, meta.sha256)
  assert.equal(db.count(), 1)
  assert.ok(db.get(meta.sha256))
  assert.ok(db.getByUrl('https://pexels.com/1'))

  const used = db.recordUsage(meta.sha256, { videoId: 'v1', sceneIndex: 0 })
  assert.equal(used.usage_count, 1)
  assert.ok(used.last_used)
  assert.equal(db.usageHistory(meta.sha256).length, 1)
  db.close()
})

test('ImageDatabase — searchByTerm finds entity/tag/url matches', async () => {
  const db = new ImageDatabase(':memory:')
  const meta = await extractImageMetadata(pngBytes('#00ff00'), {
    url: 'https://pexels.com/apple-park', entity: 'apple', tags: ['hook', 'technology'],
  })
  db.upsert(meta)
  assert.ok(db.searchByTerm('apple').length === 1)
  assert.ok(db.searchByTerm('hook').length === 1)
  assert.ok(db.searchByTerm('nope').length === 0)
  db.close()
})

test('AssetUsageTracker — recency + near-twin detection', async () => {
  const db = new ImageDatabase(':memory:')
  const meta = await extractImageMetadata(pngBytes('#0000ff'), { url: 'https://x/used.png' })
  db.upsert(meta)
  db.recordUsage(meta.sha256, { videoId: 'v1' })
  const tracker = new AssetUsageTracker(db)

  const hot = tracker.status({ sha256: meta.sha256, dHash: meta.dHash }, { cooldownDays: 7 })
  assert.equal(hot.hot, true)
  assert.equal(hot.useCount, 1)
  assert.ok(hot.usedInDays !== null)

  const twin = tracker.status({ sha256: 'zz', dHash: meta.dHash }, { cooldownDays: 7 })
  assert.equal(twin.nearTwin, true, 'same dHash → near-twin recency')

  const fresh = tracker.status({ sha256: 'ff', dHash: 'a'.repeat(16) }, { cooldownDays: 7 })
  assert.equal(fresh.hot, false)
  assert.equal(fresh.usedInDays, null)
  db.close()
})

test('ImageRanker — relevance/entity/quality dominate; hot assets penalized', () => {
  const tracker = {
    status: (a) => {
      if (a.url === 'hot') return { hot: true, useCount: 5, usedInDays: 1 }
      return { hot: false, useCount: 0, usedInDays: null }
    },
  }
  const ranker = new ImageRanker({ usageTracker: tracker })

  const candidates = [
    { url: 'pexels.com/apple-park-1920', width: 1080, height: 1920, tags: ['apple'], entity: 'apple' },
    { url: 'pexels.com/generic-tech', width: 1080, height: 1920, tags: [], entity: null },
    { url: 'hot', width: 1080, height: 1920, tags: ['apple'], entity: 'apple' },
  ]
  const ranked = ranker.rank(candidates, { subject: 'apple park', entities: ['apple'] }, { cooldownDays: 7 })

  assert.equal(ranked[0].url, 'pexels.com/apple-park-1920', 'entity+relevance+quality win')
  assert.ok(ranked[2].url === 'hot' || ranked[1].url === 'hot', 'hot asset pushed down')
})

test('SceneVisualPlanner — never reuses an entity past the cap, prefers distinct assets', () => {
  const planner = new SceneVisualPlanner()
  const ctx = { usedScenes: [], entityCounts: new Map() }
  const shots = [
    { sha256: 's1', dHash: '0'.repeat(16), url: 'a', rankScore: 1 },
    { sha256: 's2', dHash: '1'.repeat(16), url: 'b', rankScore: 0.9 },
    { sha256: 's1b', dHash: '2'.repeat(16), url: 'a2', rankScore: 0.8 },
  ]

  const p1 = planner.pick({ index: 1, entity: 'apple', images: shots }, ctx)
  assert.equal(p1.asset.url, 'a')
  ctx.usedScenes.push({ sha256: 's1', dHash: '0'.repeat(16) })
  ctx.entityCounts.set('apple', 1)

  const p2 = planner.pick({ index: 2, entity: 'apple', images: shots }, ctx)
  assert.notEqual(p2.asset.url, 'a', 'twin of used asset rejected')
  assert.equal(p2.asset.url, 'b')
  ctx.usedScenes.push({ sha256: 's2', dHash: '1'.repeat(16) })
  ctx.entityCounts.set('apple', 2)

  const p3 = planner.pick({ index: 3, entity: 'apple', images: shots }, ctx)
  assert.equal(p3.asset.url, 'a2', 'third scene falls back to remaining candidate')
  ctx.entityCounts.set('apple', 3)

  const p4 = planner.pick({ index: 4, entity: 'apple', images: shots }, ctx)
  assert.ok(p4.fallback === true, 'entity cap triggers fallback, not a 4th same-entity shot')
})

test('SceneVisualPlanner — diversity policy constants sane', () => {
  assert.equal(DIVERSITY.maxScenesPerEntity, 3)
  assert.equal(DIVERSITY.adjacentTwinDistance, 6)
})

test('ImageMetadata — pHash (DCT) deterministic, content-sensitive, resize-robust', async () => {
  const a = patternBytes()
  const b = patternBytes()
  const c = patternBytes({ left: '#00ff00', right: '#ffff00' })

  const ma = await extractImageMetadata(a)
  const mb = await extractImageMetadata(b)
  const mc = await extractImageMetadata(c)
  const mBig = await extractImageMetadata(patternBytes({ left: '#ff0000', right: '#0000ff', w: 320, h: 480 }))
  const mSmall = await extractImageMetadata(patternBytes({ left: '#ff0000', right: '#0000ff', w: 64, h: 96 }))

  assert.ok(ma.pHash.length === 16, '64-bit pHash hex')
  assert.equal(ma.pHash, mb.pHash, 'identical bytes → same pHash')
  assert.notEqual(ma.pHash, mc.pHash, 'different color → different pHash')
  assert.ok(pHashDistance(mBig.pHash, mSmall.pHash) <= DUP_THRESHOLD.phash, `resized same content stays close (got ${pHashDistance(mBig.pHash, mSmall.pHash)})`)
  assert.ok(pHashDistance(ma.pHash, mc.pHash) > DUP_THRESHOLD.phash, 'different content diverges')
  assert.equal(pHashSimilarity(ma.pHash, ma.pHash), 1, 'self similarity = 1')
})

test('DuplicateDetector — pHash corroborates derived/cropped content dHash misses', () => {
  // dHash far apart (>= 20) but pHash agrees strongly → derived
  const a = { sha256: 'aa', dHash: '0'.repeat(16), pHash: '0'.repeat(16) }
  const b = { sha256: 'bb', dHash: 'f'.repeat(16), pHash: '1'.repeat(16) }
  // dHash distance between '0..' and 'f..' = 64 > 20, so NOT flagged (phash needs d<=20)
  assert.equal(compareAssets(a, b).dup, false)
  // pHash close but dHash way out of range → not a false positive
  const c = { sha256: 'cc', dHash: 'e'.repeat(16), pHash: '0'.repeat(16) }
  assert.equal(compareAssets(a, c).dup, false)
  // pHash agrees AND dHash within 20 → derived flag
  const d = { sha256: 'dd', dHash: 'f'.repeat(2) + '0'.repeat(14), pHash: '1'.repeat(16) }
  const dr = compareAssets({ sha256: 'aa', dHash: '0'.repeat(16), pHash: '0'.repeat(16) }, d)
  assert.equal(dr.dup, true, 'pHash corroboration catches recolor/crop dHash misses')
  assert.equal(dr.kind, 'derived')
})

test('ImageDatabase — pHash column persisted on upsert', async () => {
  const db = new ImageDatabase(':memory:')
  const meta = await extractImageMetadata(pngBytes('#ff0000'))
  assert.ok(meta.pHash.length === 16)
  db.upsert(meta)
  const row = db.get(meta.sha256)
  assert.equal(row.pHash, meta.pHash, 'pHash stored in DB')
  db.close()
})

test('ImageDatabase — searchCategory + randomUnused', async () => {
  const db = new ImageDatabase(':memory:')
  const tech = await extractImageMetadata(pngBytes('#ff0000'), { tags: ['sports'], url: 'https://x/1.png' })
  const pol = await extractImageMetadata(pngBytes('#00ff00'), { tags: ['politics'], url: 'https://x/2.png' })
  db.upsert(tech)
  db.upsert(pol)

  assert.equal(db.searchCategory('sports').length, 1)
  assert.equal(db.searchCategory('politics').length, 1)
  assert.equal(db.searchCategory('sports')[0].url, 'https://x/1.png')
  assert.equal(db.searchCategory('ai').length, 0)

  // randomUnused prefers usage_count=0 assets
  const unused = db.randomUnused()
  assert.equal(unused.length, 2, 'both assets unused → random picks both')
  db.recordUsage(tech.sha256, { videoId: 'v1' })
  const unused2 = db.randomUnused()
  assert.equal(unused2.length, 1, 'only still-unused asset returned')
  assert.equal(unused2[0].url, 'https://x/2.png')
  db.close()
})

test('AssetUsageTracker + ImageRanker — last-50-videos reuse window hard-excludes', async () => {
  const db = new ImageDatabase(':memory:')
  // asset used in a recent video (structured pattern so dHash ≠ fresh's)
  const used = await extractImageMetadata(patternBytes(), { tags: ['apple'], url: 'https://x/used.png' })
  db.upsert(used)
  db.recordUsage(used.sha256, { videoId: 'v50' })
  // asset never used (different pattern → different dHash, not a near-twin)
  const fresh = await extractImageMetadata(patternBytes({ left: '#0000ff', right: '#00ff00' }), { tags: ['apple'], url: 'https://x/fresh.png' })
  db.upsert(fresh)

  const tracker = new AssetUsageTracker(db)
  const ranker = new ImageRanker({ usageTracker: tracker })

  const candidates = [
    { url: 'https://x/used.png', width: 1080, height: 1920, tags: ['apple'], entity: 'apple', sha256: used.sha256, dHash: used.dHash, pHash: used.pHash },
    { url: 'https://x/fresh.png', width: 1080, height: 1920, tags: ['apple'], entity: 'apple', sha256: fresh.sha256, dHash: fresh.dHash, pHash: fresh.pHash },
  ]
  const ranked = ranker.rank(candidates, { subject: 'apple', entities: ['apple'] }, { cooldownDays: 7, videoWindow: 50 })

  assert.equal(ranked[0].url, 'https://x/fresh.png', 'fresh asset wins over last-50-videos reuse')
  assert.equal(ranked[1]._excluded, true, 'used-in-recent-videos asset hard-excluded')
  assert.equal(ranked[1].rankScore, 0, 'excluded asset scores zero')

  // window of 0 disables the policy → used asset ranks again by score
  const rankedOff = ranker.rank(candidates, { subject: 'apple', entities: ['apple'] }, { cooldownDays: 0, videoWindow: 0 })
  assert.equal(rankedOff.some(r => r.url === 'https://x/used.png' && r._excluded === false), true, 'policy disabled when window=0')
  db.close()
})

test('ImageDatabase — music usage tracking + recent-window query', async () => {
  const db = new ImageDatabase(':memory:')
  db.recordMusicUsage('v1', 'nm-track-01-cinematic-tech-reveal-112.mp3', 'cinematic-tech-reveal')
  db.recordMusicUsage('v2', 'nm-track-02-emotional-story-72.mp3', 'emotional-story')
  db.recordMusicUsage('v1', 'nm-track-03-action-energy-158.mp3', 'action-energy')

  const recent = db.recentMusicTracks(50)
  assert.equal(recent.length, 3, 'three distinct tracks tracked')
  assert.ok(recent[0].track, 'track filename present')
  assert.ok(recent.every(r => r.family), 'family stored per track')
  assert.equal(db.musicUsedInVideos('nm-track-01-cinematic-tech-reveal-112.mp3', ['v1']), true)
  assert.equal(db.musicUsedInVideos('nm-track-99-nope.mp3', ['v1']), false)
  db.close()
})

test('RetentionPatternLearner — learn() correlates musicFamily → avg retention', async () => {
  const { RetentionPatternLearner } = await import('../src/analytics/RetentionPatternLearner.mjs')
  const { SNAPSHOTS_FILE } = await import('../src/analytics/RetentionPatternLearner.mjs')
  const fs = await import('node:fs')
  const os = await import('node:os')
  const path = await import('node:path')

  // Point the learner at a temp snapshots file so the real data/ is untouched.
  const tmp = path.join(os.tmpdir(), `music-ret-test-${Date.now()}.json`)
  fs.writeFileSync(tmp, JSON.stringify([
    { videoId: 'v1', title: 'a', category: 'politics', musicFamily: 'breaking-cinematic', retention: { completionRate: 70, dropRisks: [] } },
    { videoId: 'v2', title: 'b', category: 'politics', musicFamily: 'breaking-cinematic', retention: { completionRate: 80, dropRisks: [] } },
    { videoId: 'v3', title: 'c', category: 'tech', musicFamily: 'tech-ai', retention: { completionRate: 55, dropRisks: [] } },
  ]))

  // Stub SNAPSHOTS_FILE via the module's internal loader path: monkey-patch by
  // subclassing and overriding the file path through an env-free approach.
  const learner = new RetentionPatternLearner({
    adapter: {
      fetchVideoStats: async () => ({ views: 999 }),
      fetchRetentionCurve: async () => ([{ ratio: 1, pct: 70 }]),
      fetchCTR: async () => null,
      fetchEngagement: async () => ({}),
      completionFrom: () => 70,
    },
    minViews: 0,
    minObservations: 2,
  })
  learner._loadSnapshots = () => JSON.parse(fs.readFileSync(tmp, 'utf8'))
  const result = await learner.learn({ verbose: false })

  const fam = result.musicLearned.find(m => m.family === 'breaking-cinematic')
  assert.ok(fam, 'breaking-cinematic family present in musicLearned')
  assert.equal(fam.videos, 2)
  assert.equal(fam.avgRetention, 75, 'mean of 70 + 80')
  fs.rmSync(tmp, { force: true })
})
