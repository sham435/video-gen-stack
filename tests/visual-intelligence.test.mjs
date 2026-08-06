import { test } from 'node:test'
import assert from 'node:assert'
import { createCanvas } from '@napi-rs/canvas'
import { extractImageMetadata, dHashDistance, dHashSimilarity } from '../src/assets/ImageMetadata.mjs'
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
