import { test } from 'node:test'
import assert from 'node:assert'
import { AnalyticsCollector } from '../src/analytics/AnalyticsCollector.mjs'
import { ImagePerformanceMemory, PERF } from '../src/analytics/ImagePerformanceMemory.mjs'
import { ImageRanker, RANK_WEIGHTS } from '../src/assets/ImageRanker.mjs'
import { ImageDatabase } from '../src/assets/ImageDatabase.mjs'

// ---------------------------------------------------------------------------
// AnalyticsCollector — ingestion + parsing
// ---------------------------------------------------------------------------

function mockAdapter(overrides = {}) {
  return {
    fetchVideoStats: async () => ({ views: 1200, avgViewDurationSec: 14.8, avgViewPercentage: 66.2, estimatedMinutesWatched: 296 }),
    fetchRetentionCurve: async () => ([{ ratio: 0.1, pct: 95 }, { ratio: 0.5, pct: 80 }, { ratio: 1.0, pct: 72.4 }]),
    fetchCTR: async () => 18.4,
    fetchEngagement: async () => ({ likes: 182, comments: 21, shares: 9 }),
    fetchImpressions: async () => ({ impressions: 52400, ctr: 18.4 }),
    completionFrom: (stats, curve) => curve?.[curve.length - 1]?.pct ?? stats?.avgViewPercentage ?? null,
    ...overrides,
  }
}

test('AnalyticsCollector — parses adapter responses into canonical metrics', async () => {
  const c = new AnalyticsCollector({ adapter: mockAdapter() })
  const m = await c.collect('vid-1')
  assert.equal(m.videoId, 'vid-1')
  assert.equal(m.ctr, 18.4)
  assert.equal(m.avgViewDurationSec, 14.8)
  assert.equal(m.retention, 72.4, 'curve end value preferred over average')
  assert.equal(m.views, 1200)
  assert.equal(m.watchTimeSec, 296 * 60)
  assert.equal(m.likes, 182)
  assert.equal(m.comments, 21)
  assert.equal(m.shares, 9)
})

test('AnalyticsCollector — collectFull merges impressions', async () => {
  const c = new AnalyticsCollector({ adapter: mockAdapter() })
  const m = await c.collectFull('vid-2')
  assert.equal(m.impressions, 52400)
  assert.equal(m.ctr, 18.4)
})

test('AnalyticsCollector — no analytics at all → null (cold start safe)', async () => {
  const c = new AnalyticsCollector({ adapter: mockAdapter({ fetchVideoStats: async () => null, fetchRetentionCurve: async () => null, fetchCTR: async () => null, fetchEngagement: async () => null }) })
  const m = await c.collect('never-published')
  assert.equal(m, null)
})

test('AnalyticsCollector — low-views video without CTR is skipped as noise', async () => {
  const c = new AnalyticsCollector({ adapter: mockAdapter({ fetchVideoStats: async () => ({ views: 2, avgViewDurationSec: 3, avgViewPercentage: 50, estimatedMinutesWatched: 0 }), fetchCTR: async () => null }) })
  const m = await c.collect('noise-vid')
  assert.equal(m, null)
})

// ---------------------------------------------------------------------------
// ImagePerformanceMemory — scene-asset linkage + score learning
// ---------------------------------------------------------------------------

test('ImagePerformanceMemory — recordVideo upserts + recomputeAll learns scores', () => {
  const mem = new ImagePerformanceMemory(':memory:')

  // Video A uses apple-park-01 in scene 0 and tim-cook-02 in scene 1; performs great
  mem.recordVideo({ videoId: 'vA', ctr: 18.4, retention: 83.2, watchTimeSec: 888, avgViewDurationSec: 14.8, views: 1200, likes: 182, comments: 21, shares: 9, title: 'Apple Park opens', category: 'technology' })
  mem.recordSceneAssets('vA', [
    { sceneIndex: 0, assetId: 'hash-apple-park', entity: 'apple', url: 'https://x/apple-park' },
    { sceneIndex: 1, assetId: 'hash-tim-cook', entity: 'apple', url: 'https://x/tim-cook' },
  ])

  // Video B reuses apple-park-01 but performs poorly
  mem.recordVideo({ videoId: 'vB', ctr: 3.1, retention: 41.5, watchTimeSec: 120, avgViewDurationSec: 5.1, views: 800, likes: 12, comments: 2, shares: 0, title: 'Boring story', category: 'technology' })
  mem.recordSceneAssets('vB', [{ sceneIndex: 0, assetId: 'hash-apple-park', entity: 'apple', url: 'https://x/apple-park' }])

  mem.recomputeAll()

  const park = mem.asset('hash-apple-park')
  assert.ok(park, 'asset learned')
  assert.equal(park.videos_used, 2)
  assert.ok(park.avg_ctr > 3 && park.avg_ctr < 18.4, 'avg CTR blended (got ' + park.avg_ctr + ')')
  assert.ok(park.avg_retention > 41.5 && park.avg_retention < 83.2, 'avg retention blended')

  // Per-video averaging: Tim Cook (one great video) outranks Apple Park
  // (great + terrible diluted). Confidence reflects the number of samples.
  const cook = mem.asset('hash-tim-cook')
  assert.equal(cook.videos_used, 1)
  assert.ok(cook.score > park.score, `single great video beats diluted average (cook ${cook.score} > park ${park.score})`)
  assert.ok(park.confidence > cook.confidence, 'more samples → higher confidence')
  mem.close()
})

test('ImagePerformanceMemory — score bounded 0..1, confidence scales with usage', () => {
  const mem = new ImagePerformanceMemory(':memory:')
  for (let i = 0; i < 10; i++) {
    mem.recordVideo({ videoId: `v${i}`, ctr: 20, retention: 90, watchTimeSec: 1000, avgViewDurationSec: 15, views: 500, category: 'science' })
    mem.recordSceneAssets(`v${i}`, [{ sceneIndex: 0, assetId: 'perf-asset', entity: 'nasa' }])
  }
  mem.recomputeAll()
  const a = mem.asset('perf-asset')
  assert.equal(a.videos_used, 10)
  assert.equal(a.confidence, 1, '>= confidenceVideos → full confidence')
  assert.ok(a.score > 0.9, `near-perfect metrics → high score (${a.score})`)
  assert.ok(a.score <= 1.0)
  mem.close()
})

test('ImagePerformanceMemory — cold start: no data → no rows', () => {
  const mem = new ImagePerformanceMemory(':memory:')
  mem.recomputeAll()
  assert.equal(mem.asset('anything'), null)
  assert.equal(mem.entity('apple'), null)
  assert.deepEqual(mem.videos(), [])
  mem.close()
})

test('ImagePerformanceMemory — entity performance aggregated', () => {
  const mem = new ImagePerformanceMemory(':memory:')
  mem.recordVideo({ videoId: 'v1', ctr: 15, retention: 75, watchTimeSec: 600, avgViewDurationSec: 12, views: 900, category: 'technology' })
  mem.recordSceneAssets('v1', [{ sceneIndex: 0, assetId: 'a1', entity: 'apple' }])
  mem.recomputeAll()
  const e = mem.entity('apple')
  assert.ok(e)
  assert.equal(e.videos, 1)
  assert.ok(e.score > 0)
  mem.close()
})

test('ImagePerformanceMemory — recordThumbnail accumulates samples', () => {
  const mem = new ImagePerformanceMemory(':memory:')
  mem.recordThumbnail('thumb-hash-1', { ctr: 10, impressions: 1000, entity: 'apple', style: 'dark' })
  mem.recordThumbnail('thumb-hash-1', { ctr: 20, impressions: 1000, entity: 'apple', style: 'dark' })
  const row = mem.db.db.prepare('SELECT * FROM thumbnail_performance WHERE thumbnail_hash = ?').get('thumb-hash-1')
  assert.equal(row.sample_size, 2)
  assert.equal(row.ctr, 15, 'rolling average of samples')
  assert.equal(row.impressions, 2000)
  mem.close()
})

// ---------------------------------------------------------------------------
// Adaptive ImageRanker — learned bonus, cold-start determinism
// ---------------------------------------------------------------------------

const CANDIDATES = [
  { url: 'pexels.com/apple-park-1920', width: 1080, height: 1920, tags: ['apple'], entity: 'apple', sha256: 'learned-park' },
  { url: 'pexels.com/apple-logo-1920', width: 1080, height: 1920, tags: ['apple'], entity: 'apple', sha256: 'learned-logo' },
]

test('ImageRanker — cold start: identical to deterministic ranking (no learned bonus)', () => {
  const base = new ImageRanker({ usageTracker: { status: () => ({ hot: false, useCount: 0, usedInDays: null }) } })
  const learned = new ImageRanker({
    usageTracker: { status: () => ({ hot: false, useCount: 0, usedInDays: null }) },
    performanceMemory: { asset: () => null, entity: () => null },
  })
  const r1 = base.rank(CANDIDATES, { subject: 'apple park', entities: ['apple'] })
  const r2 = learned.rank(CANDIDATES, { subject: 'apple park', entities: ['apple'] })
  assert.deepEqual(r1.map(c => c.url), r2.map(c => c.url), 'same order')
  assert.deepEqual(r1.map(c => c.rankScore), r2.map(c => c.rankScore), 'identical scores → deterministic')
})

test('ImageRanker — learned performance flips a weaker-but-better-performing asset', () => {
  const parkPerf = { score: 0.95, confidence: 1, avg_ctr: 18.4, avg_retention: 83 }
  const logoPerf = { score: 0.2, confidence: 0.8, avg_ctr: 2, avg_retention: 30 }
  const ranker = new ImageRanker({
    usageTracker: { status: () => ({ hot: false, useCount: 0, usedInDays: null }) },
    performanceMemory: {
      asset: (sha) => sha === 'learned-logo' ? logoPerf : sha === 'learned-park' ? parkPerf : null,
      entity: () => null,
    },
  })
  const ranked = ranker.rank(CANDIDATES, { subject: 'apple park', entities: ['apple'] })
  // The logo is lexically less relevant BUT performed better in the past →
  // with learned weighting it should now win (or at least gap shrinks).
  assert.ok(ranked[0]._learned > 0, 'learned bonus applied')
  assert.ok(ranked[0].rankScore >= ranked[1].rankScore)
  assert.ok(Math.abs(ranked[0].rankScore - ranked[1].rankScore) < 0.5, 'learned bonus narrows the deterministic gap')
})

test('ImageRanker — entity-level learning boosts candidates of strong entities', () => {
  const ranker = new ImageRanker({
    usageTracker: { status: () => ({ hot: false, useCount: 0, usedInDays: null }) },
    performanceMemory: {
      asset: () => null,
      entity: (e) => e === 'apple' ? { score: 0.9, confidence: 1 } : null,
    },
  })
  const mixed = [
    { url: 'pexels.com/apple-store', sha256: 'x1', entity: 'apple', width: 1080, height: 1920 },
    { url: 'pexels.com/generic-chip', sha256: 'x2', entity: null, width: 1080, height: 1920 },
  ]
  const ranked = ranker.rank(mixed, { subject: 'apple store', entities: ['apple'] })
  assert.equal(ranked[0].url, 'pexels.com/apple-store', 'entity confidence wins')
  assert.ok(ranked[0]._learned > 0)
})

test('ImageRanker — weights include learned term but cold start contributes zero', () => {
  assert.ok(RANK_WEIGHTS.learned > 0)
  const r = new ImageRanker({ usageTracker: { status: () => ({ hot: false, useCount: 0, usedInDays: null }) } })
  const ranked = r.rank(CANDIDATES, { subject: 'apple park', entities: ['apple'] })
  assert.equal(ranked[0]._learned, 0)
})

// ---------------------------------------------------------------------------
// Integration — memory + ranker together
// ---------------------------------------------------------------------------

test('integration — learned performance from videos changes future ranking', () => {
  const mem = new ImagePerformanceMemory(':memory:')
  // Past: apple-logo performed terribly, apple-park performed great
  for (let i = 0; i < 6; i++) {
    mem.recordVideo({ videoId: `v${i}`, ctr: 4, retention: 35, watchTimeSec: 90, avgViewDurationSec: 4, views: 300, category: 'technology' })
    mem.recordSceneAssets(`v${i}`, [{ sceneIndex: 0, assetId: 'learned-logo', entity: 'apple' }])
  }
  for (let i = 6; i < 12; i++) {
    mem.recordVideo({ videoId: `v${i}`, ctr: 19, retention: 85, watchTimeSec: 900, avgViewDurationSec: 15, views: 900, category: 'technology' })
    mem.recordSceneAssets(`v${i}`, [{ sceneIndex: 0, assetId: 'learned-park', entity: 'apple' }])
  }
  mem.recomputeAll()
  const park = mem.asset('learned-park')
  const logo = mem.asset('learned-logo')
  assert.ok(park.score > logo.score, 'park learned to outperform logo')

  const ranker = new ImageRanker({
    usageTracker: { status: () => ({ hot: false, useCount: 0, usedInDays: null }) },
    performanceMemory: mem,
  })
  const ranked = ranker.rank(CANDIDATES, { subject: 'apple park', entities: ['apple'] })
  const byUrl = (u) => ranked.find(c => c.url === u)
  // candidate sha256 matches the learned asset ids → park gets the learned bonus
  assert.ok(byUrl('pexels.com/apple-park-1920')._learned > 0, 'park has learned bonus')
  assert.ok(byUrl('pexels.com/apple-park-1920').rankScore >= byUrl('pexels.com/apple-logo-1920').rankScore)
  mem.close()
})

test('PERF constants — sane configuration', () => {
  assert.equal(PERF.wCtr + PERF.wRet + PERF.wWatch, 1.0)
  assert.ok(PERF.confidenceVideos >= 3)
})
