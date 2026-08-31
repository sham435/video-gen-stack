// LEARN query surface — per-video structured performance lookups.
//
// Extends PerformanceMemory with time-windowed, compound-filter "what worked?"
// queries. Fully offline — aggregates the records already stored by record().
//
// Covers: query filters (niche / time window / impressions / views),
// since()/interval() sugar, windowPerformance() ("what worked for SAMSUNG in
// the last 30 days"), whatWorked() leaderboard, trend() time-series, metric
// resolution, and determinism.
//
// Run: node --test tests/learn-query.test.mjs

import test from 'node:test'
import assert from 'node:assert/strict'
import { PerformanceObservation } from '../src/production/PerformanceObservation.mjs'
import { PerformanceMemory } from '../src/production/PerformanceMemory.mjs'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const DAY = 86400000
const NOW = Date.now()

function tmp() { return path.join(os.tmpdir(), `learn-${Date.now()}-${Math.random().toString(36).slice(2)}.json`) }
function safeUnlink(p) { try { fs.unlinkSync(p) } catch {} }

// obs helper: immutable pull of a video with fixed age + niche + styles.
function obs({
  videoId, niche = 'AI', daysAgo = 1, hookStyle = 'breaking',
  thumbnailStyle = 'split', musicTrack = 'synth', analytics = {},
}) {
  return new PerformanceObservation({
    videoId,
    niche,
    publishedAt: new Date(NOW - daysAgo * DAY).toISOString(),
    hookStyle,
    thumbnailStyle,
    musicTrack,
    analytics,
  })
}

// Seeded corpus the tests share, spread across niches/styles/ages.
function seed(mem) {
  // SAMSUNG — good CTR + retention, recent (5–20 days ago).
  for (let i = 0; i < 4; i++) {
    mem.record(obs({ videoId: `ss-${i}`, niche: 'SAMSUNG', daysAgo: 5 + i * 3, hookStyle: 'curiosity_gap', thumbnailStyle: 'split', analytics: { impressions: 1000, views: 120, avgPercentViewed: 75, likes: 30, shares: 5 } }))
  }
  // generic AI — lower retention, older (35–90 days ago).
  for (let i = 0; i < 4; i++) {
    mem.record(obs({ videoId: `ai-${i}`, niche: 'AI', daysAgo: 35 + i * 15, hookStyle: 'breaking', thumbnailStyle: 'full', analytics: { impressions: 1000, views: 60, avgPercentViewed: 40, likes: 5 } }))
  }
  // TESLA — mid retention, recent but fewer samples.
  for (let i = 0; i < 2; i++) {
    mem.record(obs({ videoId: `ts-${i}`, niche: 'TESLA', daysAgo: 8 + i * 2, hookStyle: 'question', thumbnailStyle: 'split', analytics: { impressions: 800, views: 90, avgPercentViewed: 60 } }))
  }
}

// ─── query ──────────────────────────────────────────────────────────────────

test('query — filters by niche only', () => {
  const p = tmp(); const mem = new PerformanceMemory(p)
  seed(mem)
  const rows = mem.query({ niche: 'SAMSUNG' })
  assert.equal(rows.length, 4)
  assert.ok(rows.every(r => r.niche === 'SAMSUNG'))
  // newest first (sorted)
  assert.ok(new Date(rows[0].publishedAt) >= new Date(rows[1].publishedAt))
  safeUnlink(p)
})

test('query — time window (sinceDays) excludes old records', () => {
  const p = tmp(); const mem = new PerformanceMemory(p)
  seed(mem)
  const last30 = mem.query({ sinceDays: 30 })       // SAMSUNG(4)+TESLA(2), AI dropped
  assert.equal(last30.length, 6)
  const last10 = mem.query({ sinceDays: 10 })       // only SAMSUNG? no: TESLA 8,2; SAMSUNG 5,8,11,14
  assert.ok(last10.length >= 2)
  const last100 = mem.query({ sinceDays: 100 })
  assert.equal(last100.length, 10)                  // everything
  safeUnlink(p)
})

test('query — compound niche + hookStyle + minViewQuality', () => {
  const p = tmp(); const mem = new PerformanceMemory(p)
  seed(mem)
  // "Samsung AI videos" — SAMSUNG niched, within 30d, with hook style applied.
  const rows = mem.query({ niche: 'SAMSUNG', sinceDays: 30, hookStyle: 'curiosity_gap' })
  assert.equal(rows.length, 4)
  // minViews gate: all SAMSUNG have views=120 >= 100
  const gated = mem.query({ niche: 'SAMSUNG', sinceDays: 30, minViews: 100 })
  assert.equal(gated.length, 4)
  // minViews gate rejects TESLA (views=90) at a higher bar
  const gatedTs = mem.query({ niche: 'TESLA', sinceDays: 30, minViews: 100 })
  assert.equal(gatedTs.length, 0)
  safeUnlink(p)
})

test('query — explicit from/to interval', () => {
  const p = tmp(); const mem = new PerformanceMemory(p)
  seed(mem)
  const from = new Date(NOW - 20 * DAY).toISOString()
  const to = new Date(NOW - 1 * DAY).toISOString()
  const rows = mem.interval(from, to)
  // SAMSUNG: 5,8,11,14 → all in [20d,1d] window; TESLA 8,2 in; AI none
  assert.equal(rows.length, 6)
  safeUnlink(p)
})

// ─── since ──────────────────────────────────────────────────────────────────

test('since — convenience wrapper', () => {
  const p = tmp(); const mem = new PerformanceMemory(p)
  seed(mem)
  assert.equal(mem.since(30).length, 6)
  assert.equal(mem.since(30, { niche: 'SAMSUNG' }).length, 4)
  safeUnlink(p)
})

// ─── windowPerformance ──────────────────────────────────────────────────────

test('windowPerformance — "what worked for SAMSUNG in last 30 days by hook"', () => {
  const p = tmp(); const mem = new PerformanceMemory(p)
  seed(mem)
  const perf = mem.windowPerformance({
    niche: 'SAMSUNG', sinceDays: 30,
    dimension: 'hookStyle', metric: 'hookRetention', minSamples: 2,
  })
  // only curiosity_gap (4 SAMSUNG, all curiosity_gap) qualifies
  assert.equal(perf.length, 1)
  assert.equal(perf[0].value, 'curiosity_gap')
  assert.equal(perf[0].sampleCount, 4)
  assert.equal(perf[0].grade, 'A')               // retention 75 → A
  assert.equal(perf[0].sufficient, true)
  safeUnlink(p)
})

test('windowPerformance — ranks dimensions best-first, gates on minSamples', () => {
  const p = tmp(); const mem = new PerformanceMemory(p)
  seed(mem)
  const perf = mem.windowPerformance({
    sinceDays: 100, dimension: 'niche', metric: 'hookRetention', minSamples: 3,
  })
  // SAMSUNG(4) retention .75 > AI(4) retention .40; TESLA(2) dropped (<3)
  const values = perf.map(x => x.value)
  assert.deepEqual(values, ['SAMSUNG', 'AI'])
  assert.ok(perf[0].avg > perf[1].avg)
  assert.ok(perf.every(x => x.sufficient))
  safeUnlink(p)
})

// ─── whatWorked ─────────────────────────────────────────────────────────────

test('whatWorked — leaderboard + best performer', () => {
  const p = tmp(); const mem = new PerformanceMemory(p)
  seed(mem)
  const { leaderboard, best } = mem.whatWorked({
    sinceDays: 30, dimension: 'niche', metric: 'hookRetention', minSamples: 2,
  })
  assert.equal(best.value, 'SAMSUNG')
  assert.ok(leaderboard.length >= 1)
  assert.equal(leaderboard[0], best)
  safeUnlink(p)
})

test('whatWorked — no sufficient data → no best', () => {
  const p = tmp(); const mem = new PerformanceMemory(p)
  seed(mem)
  const { best } = mem.whatWorked({ sinceDays: 3650, dimension: 'niche', metric: 'hookRetention', minSamples: 99 })
  assert.equal(best, null)
  safeUnlink(p)
})

// ─── trend ──────────────────────────────────────────────────────────────────

test('trend — per-month series for one dimension value', () => {
  const p = tmp(); const mem = new PerformanceMemory(p)
  seed(mem)
  const series = mem.trend({ trend: undefined, dimension: 'hookStyle', dimensionValue: 'breaking', sinceDays: 100, granularity: 'month', metric: 'hookRetention' })
  const breaking = series.filter(s => s.count > 0)
  assert.ok(breaking.length >= 1)
  for (const b of breaking) {
    assert.ok(/^\d{4}-\d{2}$/.test(b.bucket), `bucket ${b.bucket} is YYYY-MM`)
    assert.ok(b.avg >= 0 && b.avg <= 1)
  }
  safeUnlink(p)
})

test('trend — returns buckets sorted chronologically', () => {
  const p = tmp(); const mem = new PerformanceMemory(p)
  seed(mem)
  const series = mem.trend({ dimension: 'niche', dimensionValue: 'AI', sinceDays: 100, granularity: 'month', metric: 'hookRetention' })
  const buckets = series.map(s => s.bucket)
  assert.deepEqual(buckets, [...buckets].sort())
  safeUnlink(p)
})

// ─── metric resolution + determinism ────────────────────────────────────────

test('metric resolver — unknown metric leads to no aggregation', () => {
  const p = tmp(); const mem = new PerformanceMemory(p)
  seed(mem)
  const perf = mem.windowPerformance({ sinceDays: 100, dimension: 'niche', metric: 'not_a_metric', minSamples: 1 })
  assert.equal(perf.length, 0)
  safeUnlink(p)
})

test('deterministic — same corpus + query yields identical results', () => {
  const p1 = tmp(); const p2 = tmp()
  const m1 = new PerformanceMemory(p1); seed(m1)
  const m2 = new PerformanceMemory(p2); seed(m2)
  const a = m1.windowPerformance({ sinceDays: 30, dimension: 'niche', metric: 'hookRetention', minSamples: 2 })
  const b = m2.windowPerformance({ sinceDays: 30, dimension: 'niche', metric: 'hookRetention', minSamples: 2 })
  assert.deepEqual(a, b)
  safeUnlink(p1); safeUnlink(p2)
})

// ─── integration: record → LEARN query round-trip ──────────────────────────

test('integration — records seeded via record() are queryable offline', () => {
  const p = tmp(); const mem = new PerformanceMemory(p)
  seed(mem)
  const win = mem.whatWorked({ niche: 'SAMSUNG', sinceDays: 30, dimension: 'hookStyle', metric: 'engagement', minSamples: 2 })
  // engagementDensity = (likes+comments+shares)/views = 35/120 ≈ 0.29
  assert.ok(win.best.value === 'curiosity_gap')
  assert.ok(win.best.sampleCount === 4)
  // Persistence round-trip: reload from the same file and re-query.
  const reloaded = new PerformanceMemory(p)
  const again = reloaded.since(30, { niche: 'SAMSUNG' })
  assert.equal(again.length, 4)
  reloaded.close()
  safeUnlink(p)
})
