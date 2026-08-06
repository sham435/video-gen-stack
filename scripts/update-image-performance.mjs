// update-image-performance — Milestone B daily learning job.
//
// Workflow:
//   1. Load published videos (data/publish-events.json).
//   2. For each: collect YouTube analytics (CTR, retention, watch time,
//      engagement) via AnalyticsCollector.
//   3. Match the video to its scene→asset mapping (output/<batch>/scene-assets.json).
//   4. Record video_performance + scene_assets rows.
//   5. Recompute learned image/entity scores in ImagePerformanceMemory.
//   6. Print the report.
//
// Usage:
//   node scripts/update-image-performance.mjs            # all published
//   node scripts/update-image-performance.mjs --days=7   # last 7 days only
//
// Idempotent: re-running re-ingests (upserts) and recomputes. Never throws
// on analytics errors — each video is skipped individually.

import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import 'dotenv/config'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..')
const DAYS_FLAG = process.argv.find(a => a.startsWith('--days='))
const DAYS = DAYS_FLAG ? parseInt(DAYS_FLAG.split('=')[1], 10) : null

const { AnalyticsCollector } = await import(path.join(ROOT, 'src', 'analytics', 'AnalyticsCollector.mjs'))
const { ImagePerformanceMemory } = await import(path.join(ROOT, 'src', 'analytics', 'ImagePerformanceMemory.mjs'))
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

const store = new PublishEventsStore()
let events = store.recent(500)
if (DAYS) events = publishedSince(events, DAYS)
console.log(`Scanning ${events.length} published videos${DAYS ? ` (last ${DAYS}d)` : ''}`)

const collector = new AnalyticsCollector()
const memory = new ImagePerformanceMemory()

let ingested = 0
let linked = 0
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
    console.log(`  ✓ ${videoId}: views=${metrics.views} ctr=${metrics.ctr}% retention=${metrics.retention}% watch=${metrics.avgViewDurationSec}s`)
    // gentle pacing — the Analytics API is quota-limited
    await new Promise(r => setTimeout(r, 400))
  } catch (e) {
    failures.push({ videoId, reason: e.message })
  }
}

const result = memory.recomputeAll()
console.log(`\nIngested: ${ingested} videos, ${linked} scene-asset links, ${failures.length} skipped`)
console.log(`Learned scores: ${result.images.length} images, ${result.entities.length} entities`)

console.log('\nTop 5 images by learned score:')
for (const img of result.images.slice(0, 5)) {
  console.log(`  ${img.score.toFixed(2)} conf=${img.confidence.toFixed(2)} uses=${img.videos_used} ret=${img.avg_retention ?? '-'}% ctr=${img.avg_ctr ?? '-'}% ${img.sha256.slice(0, 10)} (${img.entity || 'no entity'})`)
}

if (failures.length) {
  console.log(`\nSkipped (${failures.length}):`)
  for (const f of failures.slice(0, 10)) console.log(`  - ${f.videoId}: ${f.reason}`)
}

memory.close()
