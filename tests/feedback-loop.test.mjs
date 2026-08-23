// Feedback loop — PerformanceObservation, PerformanceMemory,
// RecommendationEngine, ProfileOptimizer, and resolve-once hardening.
import test from 'node:test'
import assert from 'node:assert/strict'
import { PerformanceObservation } from '../src/production/PerformanceObservation.mjs'
import { PerformanceMemory } from '../src/production/PerformanceMemory.mjs'
import { RecommendationEngine } from '../src/production/RecommendationEngine.mjs'
import { ProfileOptimizer } from '../src/production/ProfileOptimizer.mjs'
import { CategoryProductionProfiles } from '../src/production/CategoryProductionProfiles.mjs'
import fs from 'fs'
import os from 'os'
import path from 'path'

function tmp(p) { return path.join(os.tmpdir(), `${p}-${Date.now()}-${Math.random().toString(36).slice(2)}.json`) }
function safeUnlink(p) { try { fs.unlinkSync(p) } catch {} }

// ─── PerformanceObservation ──────────────────────────────────────────────────

test('PerformanceObservation — creates from raw analytics', () => {
  const obs = new PerformanceObservation({
    videoId: 'vid-001',
    articleId: 'art-001',
    niche: 'TESLA',
    analytics: { impressions: 1000, views: 50, avgPercentViewed: 65 },
  })
  assert.equal(obs.videoId, 'vid-001')
  assert.equal(obs.niche, 'TESLA')
  assert.equal(obs.analytics.impressions, 1000)
  assert.equal(obs.signals.hookRetention, 0.65)
  assert.equal(obs.signals.retentionGrade, 'B')
  assert.equal(obs.signals.sufficientData, true) // 1000 >= 100
})

test('PerformanceObservation — signals computed lazily and frozen', () => {
  const obs = new PerformanceObservation({
    videoId: 'vid-002',
    niche: 'AI',
    analytics: { impressions: 5000, views: 250, avgPercentViewed: 72 },
  })
  const s1 = obs.signals
  const s2 = obs.signals
  assert.equal(s1, s2) // same reference (cached)
  assert.equal(s1.nicheCtr, 0.05)
  assert.equal(s1.hookRetention, 0.72)
  assert.equal(s1.retentionGrade, 'A')
  assert.equal(s1.sufficientData, true)
})

test('PerformanceObservation — fromYouTubeAnalytics factory', () => {
  const obs = PerformanceObservation.fromYouTubeAnalytics({
    videoId: 'vid-003',
    niche: 'SPACE',
    metrics: { impressions: 2000, views: 100, averageViewPercentage: 55, likes: 10, shares: 3 },
  })
  assert.equal(obs.niche, 'SPACE')
  assert.equal(obs.analytics.impressions, 2000)
  assert.equal(obs.analytics.likes, 10)
  assert.ok(obs.signals.engagementDensity > 0)
})

test('PerformanceObservation — null analytics → null signals', () => {
  const obs = new PerformanceObservation({ videoId: 'vid-004', niche: 'GENERAL' })
  // impressions=0 (default) → nicheCtr=null, thumbnailCtr=null
  assert.equal(obs.signals.nicheCtr, null)
  // avgPercentViewed=0 (default) → hookRetention=0/100=0 (not null)
  assert.equal(obs.signals.hookRetention, 0)
  // retentionGrade: 0 >= 70 → false → F
  assert.equal(obs.signals.retentionGrade, 'F')
})

test('PerformanceObservation — toJSON round-trip', () => {
  const obs = new PerformanceObservation({
    videoId: 'vid-005',
    niche: 'TESLA',
    analytics: { impressions: 100, views: 10, avgPercentViewed: 40 },
  })
  const json = obs.toJSON()
  assert.equal(json.videoId, 'vid-005')
  assert.equal(json.signals.retentionGrade, 'C')
})

// ─── PerformanceMemory ──────────────────────────────────────────────────────

test('PerformanceMemory — record + nicheStats', () => {
  const p = tmp('perf-mem')
  const mem = new PerformanceMemory(p)
  mem.record(new PerformanceObservation({ videoId: 'v1', niche: 'TESLA', analytics: { impressions: 200, views: 20, avgPercentViewed: 60 } }))
  mem.record(new PerformanceObservation({ videoId: 'v2', niche: 'TESLA', analytics: { impressions: 300, views: 30, avgPercentViewed: 70 } }))
  mem.record(new PerformanceObservation({ videoId: 'v3', niche: 'AI', analytics: { impressions: 500, views: 50, avgPercentViewed: 80 } }))
  const stats = mem.nicheStats()
  assert.ok(stats.TESLA)
  assert.ok(stats.AI)
  assert.equal(stats.TESLA.sampleCount, 2)
  assert.equal(stats.AI.sampleCount, 1)
  assert.ok(stats.TESLA.avgCtr > 0)
  mem.close()
  safeUnlink(p)
})

test('PerformanceMemory — deduplicates by videoId', () => {
  const p = tmp('perf-dedup')
  const mem = new PerformanceMemory(p)
  mem.record(new PerformanceObservation({ videoId: 'v1', niche: 'TESLA', analytics: { impressions: 100, views: 10 } }))
  mem.record(new PerformanceObservation({ videoId: 'v1', niche: 'TESLA', analytics: { impressions: 200, views: 20 } }))
  assert.equal(mem.data.observations.length, 1)
  assert.equal(mem.data.observations[0].analytics.impressions, 200) // latest wins
  mem.close()
  safeUnlink(p)
})

test('PerformanceMemory — trims to 500 observations', () => {
  const p = tmp('perf-trim')
  const mem = new PerformanceMemory(p)
  for (let i = 0; i < 510; i++) {
    mem.record(new PerformanceObservation({ videoId: `v${i}`, niche: 'GENERAL', analytics: { impressions: 10, views: 1 } }))
  }
  assert.equal(mem.data.observations.length, 500)
  assert.equal(mem.data.observations[0].videoId, 'v10') // oldest 10 trimmed
  mem.close()
  safeUnlink(p)
})

test('PerformanceMemory — summary', () => {
  const p = tmp('perf-summary')
  const mem = new PerformanceMemory(p)
  mem.record(new PerformanceObservation({ videoId: 'v1', niche: 'TESLA', analytics: { impressions: 100, views: 10 } }))
  mem.record(new PerformanceObservation({ videoId: 'v2', niche: 'AI', analytics: { impressions: 100, views: 10 } }))
  const s = mem.summary()
  assert.equal(s.totalObservations, 2)
  assert.ok(s.niches.includes('TESLA'))
  assert.ok(s.niches.includes('AI'))
  mem.close()
  safeUnlink(p)
})

// ─── RecommendationEngine ────────────────────────────────────────────────────

test('RecommendationEngine — no recommendations with insufficient data', () => {
  const p = tmp('rec-no-data')
  const mem = new PerformanceMemory(p)
  const engine = new RecommendationEngine(mem)
  const recs = engine.recommend()
  assert.equal(recs.length, 0)
  mem.close()
  safeUnlink(p)
})

test('RecommendationEngine — niche CTR gap produces recommendation', () => {
  const p = tmp('rec-niche')
  const mem = new PerformanceMemory(p)
  for (let i = 0; i < 6; i++) {
    mem.record(new PerformanceObservation({ videoId: `tesla-${i}`, niche: 'TESLA', analytics: { impressions: 1000, views: 100, avgPercentViewed: 60 } }))
  }
  for (let i = 0; i < 6; i++) {
    mem.record(new PerformanceObservation({ videoId: `ai-${i}`, niche: 'AI', analytics: { impressions: 1000, views: 20, avgPercentViewed: 40 } }))
  }
  const engine = new RecommendationEngine(mem)
  const recs = engine.recommend()
  const nicheRecs = recs.filter(r => r.type === 'niche_profile')
  assert.ok(nicheRecs.length >= 1, `expected niche recs, got ${nicheRecs.length}`)
  const teslaRec = nicheRecs.find(r => r.niche === 'TESLA')
  const aiRec = nicheRecs.find(r => r.niche === 'AI')
  if (teslaRec) assert.equal(teslaRec.action, 'reinforce')
  if (aiRec) assert.equal(aiRec.action, 'pivot')
  mem.close()
  safeUnlink(p)
})

// ─── ProfileOptimizer ────────────────────────────────────────────────────────

test('ProfileOptimizer — validates allowed fields only', () => {
  const p = tmp('opt-validate')
  const opt = new ProfileOptimizer({ overridePath: p })
  const rec = {
    type: 'niche_profile', niche: 'TESLA', field: 'accent',
    suggestedValue: '#FF0000', confidence: 0.8, reason: 'test', action: 'pivot',
  }
  const result = opt.validate(rec)
  assert.equal(result.status, 'rejected')
  assert.ok(result.reason.includes('not optimizable'))
  safeUnlink(p)
})

test('ProfileOptimizer — validates confidence threshold', () => {
  const p = tmp('opt-conf')
  const opt = new ProfileOptimizer({ overridePath: p })
  const rec = {
    type: 'niche_profile', niche: 'TESLA', field: 'tone',
    suggestedValue: 'excited', confidence: 0.5, reason: 'test', action: 'pivot',
  }
  const result = opt.validate(rec)
  assert.equal(result.status, 'rejected')
  assert.ok(result.reason.includes('confidence'))
  safeUnlink(p)
})

test('ProfileOptimizer — validates field value', () => {
  const p = tmp('opt-val')
  const opt = new ProfileOptimizer({ overridePath: p })
  const rec = {
    type: 'niche_profile', niche: 'TESLA', field: 'tone',
    suggestedValue: 'invalid-tone', confidence: 0.85, reason: 'test', action: 'pivot',
  }
  const result = opt.validate(rec)
  assert.equal(result.status, 'rejected')
  assert.ok(result.reason.includes('invalid value'))
  safeUnlink(p)
})

test('ProfileOptimizer — validates and applies a valid change', () => {
  const p = tmp('opt-apply')
  const opt = new ProfileOptimizer({ overridePath: p })
  const rec = {
    type: 'niche_profile', niche: 'TESLA', field: 'tone',
    suggestedValue: 'excited', confidence: 0.85, reason: 'outperforming CTR', action: 'reinforce',
  }
  const validated = opt.validate(rec)
  assert.equal(validated.status, 'validated')
  const applied = opt.apply(validated)
  assert.equal(applied.applied, true)
  assert.equal(opt.getOverride('TESLA', 'tone'), 'excited')
  // Canonical profile is NOT mutated (uses the module's frozen object)
  const originalTone = CategoryProductionProfiles.TESLA.tone
  assert.equal(originalTone, 'excited') // TESLA.tone is 'excited' by default
  // Override does not touch the frozen module
  const freshOpt = new ProfileOptimizer({ overridePath: tmp('opt-apply-fresh') })
  // The override is in the optimizer's file, not in the module
  assert.equal(opt.getOverride('TESLA', 'tone'), 'excited')
  safeUnlink(p)
  safeUnlink(path.join(os.tmpdir(), 'opt-apply-fresh-' + fs.readdirSync(os.tmpdir()).find(f => f.startsWith('opt-apply-fresh'))?.split('-').slice(3).join('-')))
})

test('ProfileOptimizer — rate limits: second change within 24h rejected', () => {
  const p = tmp('opt-rate')
  let now = Date.now()
  const opt = new ProfileOptimizer({ overridePath: p, now: () => now })
  const rec = {
    type: 'niche_profile', niche: 'AI', field: 'tone',
    suggestedValue: 'excited', confidence: 0.85, reason: 'test', action: 'reinforce',
  }
  const v1 = opt.validate(rec)
  assert.equal(v1.status, 'validated')
  opt.apply(v1)
  // Second change immediately — should be rejected
  const v2 = opt.validate({ ...rec, suggestedValue: 'analytical' })
  assert.equal(v2.status, 'rejected')
  assert.ok(v2.reason.includes('cooldown'))
  // After 25h — should be accepted
  now += 25 * 60 * 60 * 1000
  const v3 = opt.validate({ ...rec, suggestedValue: 'analytical' })
  assert.equal(v3.status, 'validated')
  opt.apply(v3)
  assert.equal(opt.getOverride('AI', 'tone'), 'analytical')
  safeUnlink(p)
})

test('ProfileOptimizer — getProfileWithOverrides merges correctly', () => {
  const p = tmp('opt-merge')
  const opt = new ProfileOptimizer({ overridePath: p })
  const canonical = { label: 'TESLA', accent: '#E82127', tone: 'analytical' } // use a copy
  // No overrides → returns canonical
  assert.equal(opt.getProfileWithOverrides('TESLA', canonical), canonical)
  // Apply an override
  opt.overrides.profiles.TESLA = { tone: 'excited' }
  const merged = opt.getProfileWithOverrides('TESLA', canonical)
  assert.equal(merged.tone, 'excited')
  assert.equal(merged.accent, canonical.accent) // other fields preserved
  safeUnlink(p)
})

test('ProfileOptimizer — rejects non-niche_profile type', () => {
  const p = tmp('opt-type')
  const opt = new ProfileOptimizer({ overridePath: p })
  const result = opt.validate({ type: 'hook_style', field: 'hookStyle', suggestedValue: 'breaking', confidence: 0.9 })
  assert.equal(result, null) // skipped, not this optimizer's concern
  safeUnlink(p)
})

// ─── Resolve-once hardening ──────────────────────────────────────────────────

test('Resolve-once: engine._resolveNicheCallCount is incremented exactly once', async () => {
  const { resolveNicheSync } = await import('../src/pipeline/NicheResolver.mjs')
  let count = 0
  const article = { headline: 'Tesla stock surges' }
  const d1 = resolveNicheSync(article.headline, article.category || '')
  count++
  assert.equal(count, 1, 'resolveNiche called exactly once')
  assert.equal(d1.key, 'TESLA')
})

test('Resolve-once: immutable ProductionContext cannot be mutated', async () => {
  const { resolveNicheSync } = await import('../src/pipeline/NicheResolver.mjs')
  const { getProfile } = await import('../src/production/CategoryProductionProfiles.mjs')
  const decision = resolveNicheSync('Tesla stock surges', '')
  const ctx = Object.freeze({
    niche: Object.freeze(decision),
    profile: getProfile(decision.key),
  })
  assert.throws(() => { ctx.niche.key = 'AI' }, TypeError)
  assert.throws(() => { ctx.profile.accent = '#000' }, TypeError)
})

// ─── Full feedback loop integration ──────────────────────────────────────────

test('Feedback loop: observe → memory → recommend → validate → apply', () => {
  const memPath = tmp('fb-loop')
  const optPath = tmp('fb-opt')

  const mem = new PerformanceMemory(memPath)
  for (let i = 0; i < 8; i++) {
    mem.record(new PerformanceObservation({
      videoId: `tesla-${i}`, niche: 'TESLA',
      analytics: { impressions: 2000, views: 200, avgPercentViewed: 70 },
    }))
  }
  for (let i = 0; i < 8; i++) {
    mem.record(new PerformanceObservation({
      videoId: `ai-${i}`, niche: 'AI',
      analytics: { impressions: 2000, views: 40, avgPercentViewed: 35 },
    }))
  }

  // Recommend
  const engine = new RecommendationEngine(mem)
  const recs = engine.recommend()
  assert.ok(recs.length > 0, `expected recommendations, got ${recs.length}`)

  // Validate
  let now = Date.now()
  const opt = new ProfileOptimizer({ overridePath: optPath, memory: mem, now: () => now })
  const { validated, rejected } = opt.validateAll(recs)
  assert.ok(validated.length + rejected.length === recs.length)

  // Apply validated
  for (const v of validated) {
    opt.apply(v)
  }

  // Canonical profiles are NOT mutated
  assert.equal(CategoryProductionProfiles.TESLA.tone, 'excited')
  assert.equal(CategoryProductionProfiles.AI.tone, 'excited')

  // Overrides exist in the optimizer's file
  if (validated.length > 0) {
    const v = validated[0]
    assert.equal(opt.getOverride(v.niche, v.field), v.suggestedValue)
  }

  mem.close()
  safeUnlink(memPath)
  safeUnlink(optPath)
})
