// ThumbnailLifecycleManager — Milestone C3 tests.
//
// Covers:
//   1. Adaptive policy gates (impressions, age, cooldown, category-relative gap)
//   2. Monitor loop skips no-analytics videos
//   3. Candidate generation + ranking with learned style order tie-break
//   4. Full run loop records thumbnail_versions rows with outcome
//   5. Dry-run mode never touches the publisher
//
// Run: node --test tests/thumbnail-lifecycle.test.mjs

import { test } from 'node:test'
import assert from 'node:assert'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { ThumbnailLifecycleManager, REFRESH_POLICY } from '../src/thumbnails/ThumbnailLifecycleManager.mjs'
import { ImagePerformanceMemory } from '../src/analytics/ImagePerformanceMemory.mjs'

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'nm-lifecycle-'))
const NOW = 1750000000000 // fixed clock

function makeManager({ policy, dryRun, metrics, generator, publisher, events } = {}) {
  const memory = new ImagePerformanceMemory(':memory:')
  // Seed category baseline so categoryAvgCtr has data.
  memory.recordVideo({ videoId: 'baseline-1', category: 'technology', ctr: 6.0, impressions: 5000, views: 500 })
  memory.recordVideo({ videoId: 'baseline-2', category: 'technology', ctr: 5.0, impressions: 5000, views: 400 })

  const collector = {
    collectFull: async () => metrics ?? { videoId: 'v1', ctr: 3.1, impressions: 2000, publishedAt: new Date(NOW - 3 * 86400000).toISOString() },
  }
  const noopPublisher = {
    calls: 0,
    getAccessToken: async () => 'tok',
    setThumbnail: async () => { noopPublisher.calls++; return true },
  }
  const fakeGenerator = generator ?? {
    calls: 0,
    async generateTournament(article, outDir, opts) {
      fakeGenerator.calls++
      return {
        winner: 'reaction',
        winnerCtr: 85,
        variants: [
          { style: 'breaking', ctr: 80, ok: true, path: path.join(outDir, 'cover_breaking.png') },
          { style: 'reaction', ctr: 85, ok: true, path: path.join(outDir, 'cover_reaction.png') },
          { style: 'minimal', ctr: 82, ok: true, path: path.join(outDir, 'cover_minimal.png') },
        ],
        path: path.join(outDir, 'cover.png'),
      }
    },
  }

  return {
    manager: new ThumbnailLifecycleManager({
      memory,
      collector,
      brandMemory: null,
      events: { recent: () => events ?? [{ videoId: 'v1', title: 'Apple Launches Vision Pro', category: 'technology', publishedAt: new Date(NOW - 3 * 86400000).toISOString() }] },
      generator: fakeGenerator,
      publisher: dryRun ? null : noopPublisher,
      dryRun: !!dryRun,
      now: () => NOW,
      policy,
    }),
    memory,
    publisher: noopPublisher,
    generator: fakeGenerator,
  }
}

const EV = {
  videoId: 'v1',
  title: 'Apple Launches Vision Pro',
  category: 'technology',
  publishedAt: new Date(NOW - 3 * 86400000).toISOString(),
}

// ---------------------------------------------------------------------------
// Adaptive policy
// ---------------------------------------------------------------------------

test('policy — refresh fires when CTR is 1.5pp below category average', () => {
  const { manager } = makeManager()
  // technology avg = 5.5; ctr 3.1 → gap -2.4pp → refresh
  const v = manager.evaluate(EV, { ctr: 3.1, impressions: 2000, publishedAt: EV.publishedAt })
  assert.equal(v.decision, true, v.reason)
  assert.equal(v.categoryAvg, 5.5)
  assert.ok(v.ctrGap <= -1.5)
})

test('policy — refuses when CTR is within 1.5pp of category average', () => {
  const { manager } = makeManager()
  const v = manager.evaluate(EV, { ctr: 5.0, impressions: 2000, publishedAt: EV.publishedAt })
  assert.equal(v.decision, false)
  assert.match(v.reason, /ok/)
})

test('policy — refuses below impression floor', () => {
  const { manager } = makeManager()
  const v = manager.evaluate(EV, { ctr: 2.0, impressions: 50, publishedAt: EV.publishedAt })
  assert.equal(v.decision, false)
  assert.match(v.reason, /impressions 50 < 1000/)
})

test('policy — refuses too-young videos (age < 24h)', () => {
  const { manager } = makeManager()
  const young = { ...EV, publishedAt: new Date(NOW - 2 * 3600000).toISOString() }
  const v = manager.evaluate(young, { ctr: 2.0, impressions: 5000, publishedAt: young.publishedAt })
  assert.equal(v.decision, false)
  assert.match(v.reason, /age .*h < 24h/)
})

test('policy — cooldown: refuses when refreshed < 48h ago', () => {
  const { manager, memory } = makeManager()
  memory.db.db.prepare(`INSERT INTO thumbnail_versions (video_id, status, replaced, attempted_at)
    VALUES (?, 'attempted', 0, ?)`).run('v1', new Date(NOW - 10 * 3600000).toISOString())
  const v = manager.evaluate(EV, { ctr: 3.0, impressions: 2000, publishedAt: EV.publishedAt })
  assert.equal(v.decision, false)
  assert.match(v.reason, /cooldown/)
})

test('policy — cooldown expired: refresh allowed after 48h', () => {
  const { manager, memory } = makeManager()
  memory.db.db.prepare(`INSERT INTO thumbnail_versions (video_id, status, replaced, attempted_at)
    VALUES (?, 'attempted', 0, ?)`).run('v1', new Date(NOW - 100 * 3600000).toISOString())
  const v = manager.evaluate(EV, { ctr: 3.0, impressions: 2000, publishedAt: EV.publishedAt })
  assert.equal(v.decision, true, v.reason)
})

test('policy — null CTR (no analytics) → no decision', () => {
  const { manager } = makeManager({ metrics: { videoId: 'v1', ctr: null, impressions: 0 } })
  const v = manager.evaluate(EV, { ctr: null, impressions: 0 })
  assert.equal(v.decision, false)
  assert.match(v.reason, /no analytics/)
})

// ---------------------------------------------------------------------------
// Monitor + generation + ranking
// ---------------------------------------------------------------------------

test('monitor — collects analytics and returns refresh queue', async () => {
  const { manager } = makeManager()
  const { evaluated, refreshQueue } = await manager.monitor()
  assert.equal(evaluated.length, 1)
  assert.equal(evaluated[0].videoId, 'v1')
  assert.equal(evaluated[0].decision, true)
  assert.equal(refreshQueue.length, 1)
})

test('generateCandidates — A–E variants produced and winners filtered by ok', async () => {
  const { manager } = makeManager()
  const { candidates, winner } = await manager.generateCandidates(EV, path.join(TMP, 'gen'))
  assert.equal(manager.generator.calls, 1)
  assert.equal(winner, 'reaction')
  assert.ok(candidates.length >= 1)
  assert.ok(candidates.every(c => c.ok))
})

test('rankCandidates — learned style order breaks equal-CTR ties', () => {
  const { manager, memory } = makeManager()
  const withLearning = new ThumbnailLifecycleManager({
    memory,
    intel: { styleOrder: () => ['minimal', 'reaction', 'breaking'] },
    events: { recent: () => [] },
    now: () => NOW,
  })
  const tied = [
    { style: 'reaction', ctr: 80, ok: true },
    { style: 'minimal', ctr: 80, ok: true },
    { style: 'breaking', ctr: 90, ok: true },
  ]
  const ranked = withLearning.rankCandidates(tied)
  assert.equal(ranked[0].style, 'breaking') // higher ctr wins first
  assert.equal(ranked[1].style, 'minimal')  // then learned order
  assert.equal(ranked[2].style, 'reaction')
})

// ---------------------------------------------------------------------------
// Full loop
// ---------------------------------------------------------------------------

test('run — full loop replaces thumbnail and records version + learning', async () => {
  const { manager, memory, publisher, generator } = makeManager({ dryRun: false })
  // variant files must exist for hashing — write dummy files
  fs.mkdirSync(path.join(TMP, 'run'), { recursive: true })
  fs.writeFileSync(path.join(TMP, 'run', 'cover_reaction.png'), 'x')
  fs.writeFileSync(path.join(TMP, 'run', 'cover.png'), 'y')
  const result = await manager.run({ ...EV, outDir: path.join(TMP, 'run'), coverPath: path.join(TMP, 'run', 'cover.png') })

  assert.equal(result.verdict.decision, true)
  assert.equal(result.replaced, true)
  assert.equal(publisher.calls, 1)

  const row = memory.db.db.prepare(`SELECT * FROM thumbnail_versions WHERE video_id = 'v1' ORDER BY id DESC LIMIT 1`).get()
  assert.ok(row, 'version row recorded')
  assert.equal(row.style, 'reaction')
  assert.equal(row.replaced, 1)
  assert.ok(row.old_hash, 'old hash recorded')
  assert.ok(row.new_hash, 'new hash recorded')
  assert.equal(row.ctr_before, 3.1)
  assert.equal(row.impressions, 2000)
  assert.equal(generator.calls, 1)
})

test('run — dry run records planned version without touching publisher', async () => {
  const { manager, memory, publisher } = makeManager({ dryRun: true })
  const result = await manager.run({ ...EV, outDir: path.join(TMP, 'dry') })
  assert.equal(result.verdict.decision, true)
  assert.equal(result.replaced, true) // dryRun short-circuits → "planned"
  assert.equal(publisher.calls, 0, 'publisher never called in dry run')
  const row = memory.db.db.prepare(`SELECT * FROM thumbnail_versions WHERE video_id = 'v1' ORDER BY id DESC LIMIT 1`).get()
  assert.ok(row)
  assert.equal(row.replaced, 0)
})

test('run — no refresh decision → no version row, no generation', async () => {
  const { manager, memory, generator } = makeManager({ metrics: { videoId: 'v1', ctr: 6.0, impressions: 2000, publishedAt: EV.publishedAt } })
  const result = await manager.run({ ...EV })
  assert.equal(result.verdict.decision, false)
  const rows = memory.db.db.prepare(`SELECT COUNT(*) AS n FROM thumbnail_versions WHERE video_id = 'v1'`).get()
  assert.equal(rows.n, 0)
  assert.equal(generator.calls, 0)
})

test('categoryAvgCtr — channel fallback when category unknown', () => {
  const { manager } = makeManager()
  assert.equal(manager.categoryAvgCtr('technology'), 5.5)
  assert.equal(manager.categoryAvgCtr('unknown-cat'), 5.5) // falls back to channel avg
})

test('REFRESH_POLICY defaults — the documented adaptive gates', () => {
  assert.equal(REFRESH_POLICY.ctrGapPp, 1.5)
  assert.equal(REFRESH_POLICY.minImpressions, 1000)
  assert.equal(REFRESH_POLICY.minAgeHours, 24)
  assert.equal(REFRESH_POLICY.minHoursSinceRefresh, 48)
})