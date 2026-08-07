import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ImagePerformanceMemory } from '../src/analytics/ImagePerformanceMemory.mjs'
import { ThumbnailPerformanceModel } from '../src/quality/ThumbnailPerformanceModel.mjs'
import { ThumbnailIntelligence } from '../src/analytics/ThumbnailIntelligence.mjs'
import { extractThumbnailFeatures, colorFamily } from '../src/analytics/ThumbnailFeatureExtractor.mjs'

function tmpDb() { return join(mkdtempSync(join(tmpdir(), 'thumb-intel-')), 'db.sqlite') }

// --- Cold start: no learned data → strict no-op, deterministic ---

test('model cold start returns zero confidence and no recommendation', () => {
  const model = new ThumbnailPerformanceModel({ intelligence: new ThumbnailIntelligence({ memory: new ImagePerformanceMemory(tmpDb()) }) })
  const out = model.predict({ style: 'split', accentColor: '#ffd700', headline: 'BREAKING NEWS NOW' })
  assert.equal(out.confidence, 0)
  assert.equal(out.learned, false)
  assert.equal(out.predictedCTR, 0)
  assert.deepEqual(out.recommendations, [])
  model.close()
})

test('colorFamily classifies hue deterministically', () => {
  assert.equal(colorFamily('#ff0000'), 'red')
  assert.equal(colorFamily('#0000ff'), 'blue')
  assert.equal(colorFamily('#00ff00'), 'green')
})

test('extractThumbnailFeatures produces deterministic structure without a cover', async () => {
  const a = await extractThumbnailFeatures({ headline: 'BREAKING NEWS NOW?', style: 'portrait', accentColor: '#ffd700' })
  assert.equal(a.emotion.urgency, 0.8)
  assert.equal(a.typography.wordCount, 3)
  assert.equal(a.composition.facePresent, true)
  const b = await extractThumbnailFeatures({ headline: 'BREAKING NEWS NOW?', style: 'portrait', accentColor: '#ffd700' })
  assert.deepEqual(a, b) // deterministic
})

// --- Schema: C2 columns exist + recordThumbnail persists features ---

test('thumbnail_performance schema exposes C2 learning columns', () => {
  const memory = new ImagePerformanceMemory(tmpDb())
  const cols = memory.db.db.prepare('PRAGMA table_info(thumbnail_performance)').all().map(c => c.name)
  for (const c of ['features', 'ctr_score', 'confidence']) assert.ok(cols.includes(c), `missing ${c}`)
  memory.close()
})

test('recordThumbnail stores features JSON and ctr_score', () => {
  const memory = new ImagePerformanceMemory(tmpDb())
  memory.recordThumbnail('h1', { ctr: 8.1, impressions: 1000, style: 'split', dominantColor: 'yellow', features: { colors: { dominant: ['yellow'] } }, ctrScore: 0.09, confidence: 0.7 })
  const row = memory.db.db.prepare('SELECT * FROM thumbnail_performance WHERE thumbnail_hash=?').get('h1')
  assert.equal(row.ctr, 8.1)
  assert.equal(row.confidence, 0.7)
  assert.equal(JSON.parse(row.features).colors.dominant[0], 'yellow')
  memory.close()
})

// --- Learning gate: rollups grow confidence; low-confidence exact learn ---

test('model enables learning only once rollups pass the sample/impression floor', () => {
  const memory = new ImagePerformanceMemory(tmpDb())
  const ti = new ThumbnailIntelligence({ memory })
  const model = new ThumbnailPerformanceModel({ intelligence: ti, minSamples: 2, minImpressions: 10 })

  // One small sample → falls under floor → still cold (no-op).
  memory.recordThumbnail('t1', { ctr: 12, impressions: 10, style: 'split', dominantColor: 'yellow' })
  assert.equal(model.predict({ accentColor: '#ffd700', style: 'split' }).learned, false)

  // Second sample crosses the floor → rollup appears → learning enabled.
  memory.recordThumbnail('t2', { ctr: 14, impressions: 10, style: 'split', dominantColor: 'yellow' })
  const colRow = ti.colorFamilies(2, 10).find(r => r.family === 'yellow')
  assert.ok(colRow, 'yellow family should become gated')
  assert.ok(ti.baseline() != null)
  model.close()
})

// --- Wiring: extracted features → model predict path compiles ---

test('end-to-end feature extraction → model predict', async () => {
  const memory = new ImagePerformanceMemory(tmpDb())
  memory.recordThumbnail('t1', { ctr: 13, impressions: 500, style: 'split', dominantColor: 'yellow' })
  memory.recordThumbnail('t2', { ctr: 15, impressions: 500, style: 'split', dominantColor: 'yellow' })
  const model = new ThumbnailPerformanceModel({ intelligence: new ThumbnailIntelligence({ memory }), minSamples: 2, minImpressions: 10 })
  const features = await extractThumbnailFeatures({ headline: 'Apple just shocked everyone?', accentColor: '#ffd700' })
  const pred = model.predict({ style: 'split', accentColor: '#ffd700', features })
  assert.equal(typeof pred.predictedCTR, 'number')
  assert.ok(pred.confidence > 0)
  assert.ok(Array.isArray(pred.recommendations))
  model.close()
})