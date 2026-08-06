import { test } from 'node:test'
import assert from 'node:assert'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createCanvas } from '@napi-rs/canvas'
import { ThumbnailIntelligence, colorFamily, FAMILY_HEX } from '../src/analytics/ThumbnailIntelligence.mjs'
import { ImagePerformanceMemory } from '../src/analytics/ImagePerformanceMemory.mjs'
import { patternKey } from '../src/ai/thumbnail/ThumbnailBrandOptimizer.mjs'

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'nm-thumb-test-'))

function mem() { return new ImagePerformanceMemory(':memory:') }

/** Render a tiny cover: black bg + an accent bar across the top. */
function coverFile(accentHex) {
  const p = path.join(TMP, `cover-${Math.random().toString(36).slice(2)}.png`)
  const canvas = createCanvas(80, 20)
  const ctx = canvas.getContext('2d')
  ctx.fillStyle = '#000000'
  ctx.fillRect(0, 0, 80, 20)
  ctx.fillStyle = accentHex
  ctx.fillRect(0, 0, 80, 4)
  fs.writeFileSync(p, canvas.toBuffer('image/png'))
  return p
}

const METRICS = { videoId: 'v1', ctr: 18.4, impressions: 12000 }

// ---------------------------------------------------------------------------
// colorFamily classification
// ---------------------------------------------------------------------------

test('colorFamily — hue mapping is deterministic and correct', () => {
  assert.equal(colorFamily('#E10600'), 'red')
  assert.equal(colorFamily('#F59E0B'), 'amber')
  assert.equal(colorFamily('#FACC15'), 'yellow')
  assert.equal(colorFamily('#16A34A'), 'green')
  assert.equal(colorFamily('#06B6D4'), 'cyan')
  assert.equal(colorFamily('#2563EB'), 'blue')
  assert.equal(colorFamily('#7C3AED'), 'purple')
  assert.equal(colorFamily('#F8FAFC'), 'white')
  assert.equal(colorFamily('#6B7280'), 'gray')
  assert.equal(colorFamily('#0A0A0A'), 'gray')
  assert.equal(colorFamily('not-a-color'), 'none')
  assert.equal(colorFamily('#E10600'), colorFamily('#E10600'))
})

// ---------------------------------------------------------------------------
// learn() — fingerprint + recording
// ---------------------------------------------------------------------------

test('learn — hashes the cover, samples the accent family, records a sample', async () => {
  const m = mem()
  const intel = new ThumbnailIntelligence({ memory: m })
  const cover = coverFile('#E10600')
  const r = await intel.learn({ ...METRICS }, cover, { style: 'breaking', entity: 'technology', headline: 'Apple Surprises Investors With New AI Chip' })
  assert.ok(r.thumbnailHash.length === 64, 'sha256 fingerprint')
  assert.equal(r.style, 'breaking')
  assert.equal(r.dominantColor, 'red', 'accent sampled from the cover bar')
  const row = m.db.db.prepare('SELECT * FROM thumbnail_performance WHERE thumbnail_hash = ?').get(r.thumbnailHash)
  assert.equal(row.sample_size, 1)
  assert.equal(row.style, 'breaking')
  assert.equal(row.entity, 'technology')
  assert.equal(row.headline_style, patternKey('Apple Surprises Investors With New AI Chip'))
  assert.equal(row.ctr, 18.4)
  assert.equal(row.impressions, 12000)
  m.close()
})

test('learn — same cover upserts (rolling CTR, summed impressions)', async () => {
  const m = mem()
  const intel = new ThumbnailIntelligence({ memory: m })
  const cover = coverFile('#2563EB')
  const a = await intel.learn({ videoId: 'v1', ctr: 10, impressions: 1000 }, cover, { style: 'cinematic' })
  const b = await intel.learn({ videoId: 'v1', ctr: 20, impressions: 1000 }, cover, { style: 'cinematic' })
  assert.equal(a.thumbnailHash, b.thumbnailHash)
  const row = m.db.db.prepare('SELECT * FROM thumbnail_performance WHERE thumbnail_hash = ?').get(a.thumbnailHash)
  assert.equal(row.sample_size, 2)
  assert.equal(row.ctr, 15, 'rolling average of samples')
  assert.equal(row.impressions, 2000, 'impressions accumulate')
  assert.equal(row.dominant_color, 'blue')
  m.close()
})

test('learn — no cover path → videoId-keyed sample, no crash', async () => {
  const m = mem()
  const intel = new ThumbnailIntelligence({ memory: m })
  const r = await intel.learn(METRICS, null, { style: 'minimal' })
  assert.equal(r.thumbnailHash, 'thumb-v1')
  assert.equal(r.dominantColor, null)
  m.close()
})

test('learn — missing CTR (no impressions report) → skipped', async () => {
  const m = mem()
  const intel = new ThumbnailIntelligence({ memory: m })
  const r = await intel.learn({ videoId: 'v2', ctr: null }, coverFile('#E10600'), {})
  assert.equal(r, null)
  m.close()
})

// ---------------------------------------------------------------------------
// Rollups + baseline
// ---------------------------------------------------------------------------

function seed(intel, specs) {
  for (const [style, ctr, imp, family] of specs) {
    intel.memory.recordThumbnail(`h-${Math.random().toString(36).slice(2)}`, { ctr, impressions: imp, style, dominantColor: family })
  }
}

test('styles — impressions-weighted rollup sorted best-first, gated by samples+impressions', () => {
  const m = mem()
  const intel = new ThumbnailIntelligence({ memory: m })
  seed(intel, [
    ['breaking', 10, 1000, 'red'],
    ['breaking', 12, 1000, 'red'],
    ['cinematic', 20, 1000, 'blue'],
    ['cinematic', 22, 1000, 'blue'],
    ['minimal', 8, 100, 'gray'],   // below impression floor
    ['data', 9, 1000, 'purple'],   // single sample
  ])
  const s = intel.styles()
  assert.equal(s.length, 2, 'minimal (imp floor) and data (samples) gated out')
  assert.equal(s[0].style, 'cinematic')
  assert.equal(s[0].ctr, 21)
  assert.equal(s[1].style, 'breaking')
  assert.equal(s[1].ctr, 11)
  m.close()
})

test('colorFamilies — rollup by accent family', () => {
  const m = mem()
  const intel = new ThumbnailIntelligence({ memory: m })
  seed(intel, [
    ['breaking', 10, 2000, 'red'],
    ['breaking', 12, 2000, 'red'],
    ['cinematic', 20, 2000, 'blue'],
    ['minimal', 21, 2000, 'blue'],
  ])
  const c = intel.colorFamilies()
  assert.equal(c[0].family, 'blue')
  assert.ok(c[0].ctr > c[1].ctr)
  m.close()
})

test('baseline — impressions-weighted channel CTR', () => {
  const m = mem()
  const intel = new ThumbnailIntelligence({ memory: m })
  seed(intel, [
    ['breaking', 10, 1000, 'red'],
    ['cinematic', 20, 1000, 'blue'],
  ])
  assert.equal(intel.baseline(), 15)
  m.close()
})

test('headlinePatterns — rolls up headline style keys', () => {
  const m = mem()
  const intel = new ThumbnailIntelligence({ memory: m })
  intel.memory.recordThumbnail('a', { ctr: 8, impressions: 2000, headlineStyle: patternKey('Startup Raises Huge Funding') })
  intel.memory.recordThumbnail('b', { ctr: 9, impressions: 2000, headlineStyle: patternKey('Startup Raises Huge Round') })
  intel.memory.recordThumbnail('c', { ctr: 16, impressions: 2000, headlineStyle: patternKey('Samsung Launches Giant Phone') })
  intel.memory.recordThumbnail('d', { ctr: 17, impressions: 2000, headlineStyle: patternKey('Samsung Launches Giant Tablet') })
  const p = intel.headlinePatterns()
  assert.equal(p[0].pattern, 'SAMSUNG_LAUNCHES_GIANT')
  assert.ok(p[0].ctr > p[1].ctr)
  m.close()
})

// ---------------------------------------------------------------------------
// Generation feedback — cold start is a strict no-op
// ---------------------------------------------------------------------------

test('styleOrder — cold start returns null (original order preserved)', () => {
  const m = mem()
  const intel = new ThumbnailIntelligence({ memory: m })
  assert.equal(intel.styleOrder(['breaking', 'cinematic', 'minimal', 'reaction', 'data']), null)
  m.close()
})

test('styleOrder — reorders by learned CTR once confident, keeps unknown styles after', () => {
  const m = mem()
  const intel = new ThumbnailIntelligence({ memory: m })
  seed(intel, [
    ['breaking', 9, 1000, 'red'],
    ['breaking', 10, 1000, 'red'],
    ['data', 20, 1000, 'purple'],
    ['data', 21, 1000, 'purple'],
  ])
  const order = intel.styleOrder(['breaking', 'cinematic', 'minimal', 'reaction', 'data'])
  assert.deepEqual(order, ['data', 'breaking', 'cinematic', 'minimal', 'reaction'])
  m.close()
})

test('styleOrder — refuses to reorder when the learned gap is < 0.5pp', () => {
  const m = mem()
  const intel = new ThumbnailIntelligence({ memory: m })
  seed(intel, [
    ['breaking', 10.2, 1000, 'red'],
    ['breaking', 10.4, 1000, 'red'],
    ['cinematic', 10.5, 1000, 'blue'],
    ['cinematic', 10.6, 1000, 'blue'],
  ])
  assert.equal(intel.styleOrder(['breaking', 'cinematic']), null, 'tiny gap → no churn')
  m.close()
})

test('tuneBrief — cold start returns the identical brief (no mutation)', () => {
  const m = mem()
  const intel = new ThumbnailIntelligence({ memory: m })
  const brief = { accent_color: '#E10600', headline: 'X', mood: 'breaking' }
  const out = intel.tuneBrief(brief)
  assert.strictEqual(out, brief, 'same object reference on cold start')
  assert.equal(out.accent_color, '#E10600')
  m.close()
})

test('tuneBrief — swaps accent only when the learned family beats baseline', () => {
  const m = mem()
  const intel = new ThumbnailIntelligence({ memory: m })
  // Red (current default) underperforms; blue wins clearly
  seed(intel, [
    ['breaking', 6, 2000, 'red'],
    ['breaking', 7, 2000, 'red'],
    ['cinematic', 24, 2000, 'blue'],
    ['cinematic', 26, 2000, 'blue'],
  ])
  const brief = { accent_color: '#E10600', headline: 'X' }
  const out = intel.tuneBrief(brief)
  assert.notStrictEqual(out, brief, 'new brief object when learning applies')
  assert.equal(out.accent_color, FAMILY_HEX.blue)
  assert.equal(out._thumbnailLearning.family, 'blue')
  m.close()
})

test('tuneBrief — keeps current accent when it already leads', () => {
  const m = mem()
  const intel = new ThumbnailIntelligence({ memory: m })
  seed(intel, [
    ['breaking', 22, 2000, 'red'],
    ['breaking', 24, 2000, 'red'],
    ['cinematic', 10, 2000, 'blue'],
    ['cinematic', 12, 2000, 'blue'],
  ])
  const brief = { accent_color: '#E10600', headline: 'X' }
  const out = intel.tuneBrief(brief)
  assert.strictEqual(out, brief, 'no change when current family already best')
  m.close()
})

// ---------------------------------------------------------------------------
// Engine-facing integration shape
// ---------------------------------------------------------------------------

test('CoverGenerator wiring shape — intel exposes the methods the generator calls', async () => {
  const { CoverGenerator } = await import('../src/video-studio/CoverGenerator.mjs')
  const gen = new CoverGenerator(null, { intelligence: null })
  assert.equal(gen.intel, null, 'explicit null intelligence → no learning')
  const gen2 = new CoverGenerator(null, { intelligence: null })
  const cold = new CoverGenerator(null, { intelligence: new ThumbnailIntelligence({ memory: mem() }) })
  assert.equal(cold.intel.styleOrder(['breaking', 'data']), null, 'cold generator keeps original order')
  assert.ok(gen2.director, 'composer pipeline intact')
})
