// refresh-thumbnails — Milestone C3: autonomous thumbnail refresh loop.
//
// The self-improvement pass: collect live analytics for published videos,
// apply the adaptive refresh policy (category-relative CTR gap + impression/
// age/cooldown gates), and when a thumbnail underperforms:
//
//   1. generate cover A–E variants (CoverGenerator tournament)
//   2. rank candidates (validator CTR + learned style order)
//   3. replace the YouTube thumbnail via the publisher
//   4. record the version + pattern learning (thumbnail_versions)
//
// Usage:
//   node scripts/refresh-thumbnails.mjs                 # audit (dry-run report)
//   node scripts/refresh-thumbnails.mjs --apply         # actually replace
//   node scripts/refresh-thumbnails.mjs --apply --limit=3
//
// Idempotent + best-effort: every video is evaluated independently; missing
// credentials or API errors skip that video, never crash the run.

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'url'
import 'dotenv/config'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..')

const APPLY = process.argv.includes('--apply')
const LIMIT = process.argv.find(a => a.startsWith('--limit=')) ? parseInt(process.argv.find(a => a.startsWith('--limit=')).split('=')[1], 10) : 0

const { ThumbnailLifecycleManager } = await import(path.join(ROOT, 'src', 'thumbnails', 'ThumbnailLifecycleManager.mjs'))
const { AnalyticsCollector } = await import(path.join(ROOT, 'src', 'analytics', 'AnalyticsCollector.mjs'))
const { ImagePerformanceMemory } = await import(path.join(ROOT, 'src', 'analytics', 'ImagePerformanceMemory.mjs'))
const { BrandPerformanceMemory } = await import(path.join(ROOT, 'src', 'pipeline', 'BrandPerformanceMemory.mjs'))
const { PublishEventsStore } = await import(path.join(ROOT, 'src', 'publishing', 'PublishEventsStore.mjs'))
const { CoverGenerator } = await import(path.join(ROOT, 'src', 'video-studio', 'CoverGenerator.mjs'))
const youtube = await import(path.join(ROOT, 'apps', 'api', 'publishers', 'youtube.js'))

const manager = new ThumbnailLifecycleManager({
  memory: new ImagePerformanceMemory(),
  collector: new AnalyticsCollector(),
  brandMemory: new BrandPerformanceMemory(),
  events: new PublishEventsStore(),
  generator: new CoverGenerator(null),
  publisher: APPLY ? { getAccessToken: youtube.getAccessToken, setThumbnail: youtube.setThumbnail } : null,
  dryRun: !APPLY,
})

console.log(APPLY ? '🔁 refresh-thumbnails — LIVE mode (replacing thumbnails)' : '👁 refresh-thumbnails — DRY RUN (audit only)')
console.log('='.repeat(70))

const { evaluated, refreshQueue } = await manager.monitor()
console.log(`\nEvaluated ${evaluated.length} published videos:`)
let refreshed = 0
for (const e of evaluated) {
  const mark = e.decision ? '🔄 REFRESH' : '     ok'
  console.log(`  ${mark} ${e.videoId} — ${e.reason}`)
}
console.log(`\nRefresh candidates: ${refreshQueue.length}`)

const queue = LIMIT ? refreshQueue.slice(0, LIMIT) : refreshQueue
for (const { ev } of queue) {
  // Attach the batch cover path so the loop can hash old → new.
  const idx = ev.metadata?.index
  const dir = idx
    ? path.join(ROOT, 'output', `batch-${String(idx).padStart(2, '0')}`)
    : path.join(ROOT, 'output', ev.videoId)
  ev.coverPath = path.join(dir, 'cover.png')
  if (!fs.existsSync(ev.coverPath)) ev.coverPath = null

  try {
    const result = await manager.run(ev)
    const action = result.replaced ? 'replaced' : result.verdict?.decision ? (APPLY ? 'generated (replace pending/failed)' : 'planned (dry run)') : 'no-op'
    console.log(`  → ${result.videoId}: ${action}${result.winner ? ` winner=${result.winner}` : ''}`)
    if (result.replaced) refreshed++
  } catch (e) {
    console.error(`  ✗ ${ev.videoId}: ${e.message}`)
  }
  await new Promise(r => setTimeout(r, 400))
}

console.log(`\nDone. ${refreshed} thumbnail${refreshed === 1 ? '' : 's'} replaced${APPLY ? '' : ' (dry run — pass --apply to replace)'}.`)
manager.close()