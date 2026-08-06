// update-image-performance — Milestone B/C daily learning job.
//
// Workflow:
//   1. Load published videos (data/publish-events.json).
//   2. For each: collect YouTube analytics (CTR, retention, watch time,
//      engagement) via AnalyticsCollector.
//   3. Match the video to its scene→asset mapping (output/<batch>/scene-assets.json).
//   4. Record video_performance + scene_assets rows.
//   5. Record the video's cover.png as a thumbnail sample (hash + accent
//      family + style) with its impressions/CTR (Milestone C).
//   6. Recompute learned image/entity/thumbnail scores.
//   7. Print the report.
//
// Usage:
//   node scripts/update-image-performance.mjs            # all published
//   node scripts/update-image-performance.mjs --days=7   # last 7 days only
//
// Idempotent: re-running re-ingests (upserts) and recomputes. Never throws
// on analytics errors — each video is skipped individually.

import fs from 'fs'
import path from 'path'
import { createHash } from 'node:crypto'
import { fileURLToPath } from 'url'
import 'dotenv/config'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..')
const DAYS_FLAG = process.argv.find(a => a.startsWith('--days='))
const DAYS = DAYS_FLAG ? parseInt(DAYS_FLAG.split('=')[1], 10) : null

const { AnalyticsCollector } = await import(path.join(ROOT, 'src', 'analytics', 'AnalyticsCollector.mjs'))
const { ImagePerformanceMemory } = await import(path.join(ROOT, 'src', 'analytics', 'ImagePerformanceMemory.mjs'))
const { ThumbnailIntelligence } = await import(path.join(ROOT, 'src', 'analytics', 'ThumbnailIntelligence.mjs'))
const { PublishEventsStore, PUBLISH_EVENTS_FILE } = await import(path.join(ROOT, 'src', 'publishing', 'PublishEventsStore.mjs'))

function publishedSince(events, days) {
  const cutoff = Date.now() - days * 86400000
  return events.filter(e => e.publishedAt && new Date(e.publishedAt).getTime() >= cutoff)
}

function findSceneAssets(videoEvent) {
  // batch renders keep output/batch-NN/scene-assets.json; try the index
  const idx = videoEvent.metadata?.index
  const candidates = []
  if (idx) candidates.push(path.join(ROOT, 'output', `batch-${String(idx).padStart(2, '0')}`, 'scene-assets.json'))
  candidates.push(path.join(ROOT, 'output', videoEvent.videoId, 'scene-assets.json'))
  for (const c of candidates) {
    if (fs.existsSync(c)) {
      try { return JSON.parse(fs.readFileSync(c, 'utf-8')) } catch { return null }
    }
  }
  return null
}

/** Cover of a published video + the style variant that was promoted to it. */
function findThumbnail(videoEvent) {
  const idx = videoEvent.metadata?.index
  const dir = idx
    ? path.join(ROOT, 'output', `batch-${String(idx).padStart(2, '0')}`)
    : path.join(ROOT, 'output', videoEvent.videoId)
  const cover = path.join(dir, 'cover.png')
  if (!fs.existsSync(cover)) return null
  // The promoted style: the cover_<style>.png whose bytes match cover.png.
  let style = null
  try {
    const coverHash = createHash('sha256').update(fs.readFileSync(cover)).digest('hex')
    const variants = fs.readdirSync(dir).filter(f => /^cover_([a-z]+)\.png$/.test(f))
    for (const f of variants) {
      const h = createHash('sha256').update(fs.readFileSync(path.join(dir, f))).digest('hex')
      if (h === coverHash) { style = /^cover_([a-z]+)\.png$/.exec(f)[1]; break }
    }
  } catch { /* best-effort */ }
  return { coverPath: cover, style }
}

const store = new PublishEventsStore()
let events = store.recent(500)
if (DAYS) events = publishedSince(events, DAYS)
console.log(`Scanning ${events.length} published videos${DAYS ? ` (last ${DAYS}d)` : ''}`)

const collector = new AnalyticsCollector()
const memory = new ImagePerformanceMemory()
const intel = new ThumbnailIntelligence({ memory })

let ingested = 0
let linked = 0
let thumbs = 0
const failures = []

for (const ev of events) {
  const videoId = ev.videoId
  if (!videoId) continue
  try {
    const metrics = await collector.collectFull(videoId)
    if (!metrics) { failures.push({ videoId, reason: 'no analytics yet' }); continue }
    metrics.title = ev.title || null
    metrics.category = ev.category || null
    memory.recordVideo(metrics)
    ingested++

    const sceneAssets = findSceneAssets(ev)
    if (sceneAssets?.length) {
      memory.recordSceneAssets(videoId, sceneAssets.map(s => ({
        sceneIndex: s.sceneIndex ?? 0,
        assetId: s.assetId || null,
        entity: s.entity || null,
        url: s.url || null,
        headline: ev.title || null,
        retention: metrics.retention ?? null,
      })))
      linked += sceneAssets.filter(s => s.assetId).length
    }

    // Milestone C: thumbnail sample (hash + accent family + promoted style)
    const thumb = findThumbnail(ev)
    if (thumb) {
      const recorded = await intel.learn(metrics, thumb.coverPath, {
        style: thumb.style,
        entity: metrics.category,
        headline: metrics.title,
      })
      if (recorded) thumbs++
    }
    console.log(`  ✓ ${videoId}: views=${metrics.views} ctr=${metrics.ctr}% retention=${metrics.retention}% watch=${metrics.avgViewDurationSec}s${thumb ? ` thumb=${thumb.style || '?'}` : ''}`)
    // gentle pacing — the Analytics API is quota-limited
    await new Promise(r => setTimeout(r, 400))
  } catch (e) {
    failures.push({ videoId, reason: e.message })
  }
}

const result = memory.recomputeAll()
console.log(`\nIngested: ${ingested} videos, ${linked} scene-asset links, ${thumbs} thumbnail samples, ${failures.length} skipped`)
console.log(`Learned scores: ${result.images.length} images, ${result.entities.length} entities`)

console.log('\nTop 5 images by learned score:')
for (const img of result.images.slice(0, 5)) {
  console.log(`  ${img.score.toFixed(2)} conf=${img.confidence.toFixed(2)} uses=${img.videos_used} ret=${img.avg_retention ?? '-'}% ctr=${img.avg_ctr ?? '-'}% ${img.sha256.slice(0, 10)} (${img.entity || 'no entity'})`)
}

console.log('\nThumbnail learning (CTR by attribute):')
const base = intel.baseline()
console.log(`  channel CTR baseline: ${base ?? 'n/a'}%`)
for (const s of intel.styles()) console.log(`  style "${s.style}": ${s.ctr}% ctr, ${s.impressions} imp, ${s.samples} samples (lift ${s.lift > 0 ? '+' : ''}${s.lift})`)
for (const c of intel.colorFamilies()) console.log(`  accent ${c.family}: ${c.ctr}% ctr, ${c.impressions} imp, ${c.samples} samples (lift ${c.lift > 0 ? '+' : ''}${c.lift})`)
const advice = intel.styleOrder([]) || null
if (advice) console.log(`  → recommended style order: ${advice.join(', ')}`)
if (!intel.styles().length && !intel.colorFamilies().length) console.log('  (no confident samples yet — cold start, generation unchanged)')

if (failures.length) {
  console.log(`\nSkipped (${failures.length}):`)
  for (const f of failures.slice(0, 10)) console.log(`  - ${f.videoId}: ${f.reason}`)
}

memory.close()
