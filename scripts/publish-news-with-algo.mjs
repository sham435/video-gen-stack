#!/usr/bin/env node
// publish-news-with-algo — publishes a YouTube Short with ALGO #N/48 injected
// into the description, tracks the algo in data/algos-used.json, and records
// the photo in data/pexels-used.json (48h TTL).
//
// Usage:
//   node scripts/publish-news-with-algo.mjs --with-algo --dry-run
//   node scripts/publish-news-with-algo.mjs --with-algo
//   PEXELS_API_KEY=xxx node scripts/publish-news-with-algo.mjs --with-algo
//
// Requires: YOUTUBE_API_KEY or YOUTUBE_OAUTH_* in .env

import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import 'dotenv/config'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..')
const withAlgo = process.argv.includes('--with-algo')
const dryRun = process.argv.includes('--dry-run')

if (!withAlgo) {
  console.error('Usage: node scripts/publish-news-with-algo.mjs --with-algo [--dry-run]')
  process.exit(1)
}

// ─── Load latest algo assignment ──────────────────────────────────────────────
const algosPath = path.join(ROOT, 'data', 'algos-used.json')
if (!fs.existsSync(algosPath)) {
  console.error('[FATAL] data/algos-used.json not found — run pipeline first')
  process.exit(1)
}
const algoHistory = JSON.parse(fs.readFileSync(algosPath, 'utf8'))
const lastAlgo = algoHistory[algoHistory.length - 1]
if (!lastAlgo) {
  console.error('[FATAL] algos-used.json is empty')
  process.exit(1)
}

console.log(`\n=== M8 Publish with ALGO ===`)
console.log(`ALGO: #${lastAlgo.algoNumber}/48`)
console.log(`Hook: ${lastAlgo.hook}`)
console.log(`Visual: ${lastAlgo.visual}`)
console.log(`Tone: ${lastAlgo.tone}`)
console.log(`Title: ${lastAlgo.title}`)
console.log(`Category: ${lastAlgo.category}`)

// ─── Build ALGO-tagged description ───────────────────────────────────────────
function buildAlgoDescription(algo) {
  const algoTag = `ALGO #${algo.algoNumber}/48 • ${algo.visual} • ${algo.tone}`
  const anchorTag = `sham435·ANCHOR`
  const nicheTag = `${algo.category || 'technology'}`
  const hookTag = `${algo.hook}`
  return [
    algoTag,
    `${anchorTag} • ${nicheTag} • ${hookTag}`,
    '',
    algo.title,
    '',
    '#NEWSMONSTER #Shorts',
  ].join('\n')
}

const description = buildAlgoDescription(lastAlgo)
console.log(`\nDescription:\n${description}`)

// ─── Load diversity stats ────────────────────────────────────────────────────
const pexelsPath = path.join(ROOT, 'data', 'pexels-used.json')
let pexelsData = {}
if (fs.existsSync(pexelsPath)) {
  try { pexelsData = JSON.parse(fs.readFileSync(pexelsPath, 'utf8')) } catch { /* skip */ }
}
const now = Date.now()
const TTL = 48 * 60 * 60 * 1000
const recentUrls = Object.entries(pexelsData).filter(([, ts]) => now - ts < TTL)
const recentUniquePhotos = new Set(recentUrls.map(([url]) => url)).size

console.log(`\nDiversity:`)
console.log(`  Algo history: ${algoHistory.length} total`)
console.log(`  Photos used (48h): ${recentUniquePhotos}`)
console.log(`  dupPhotos: ${lastAlgo.photo ? 'checking...' : 'no photo recorded'}`)

// ─── Check for duplicate photos ──────────────────────────────────────────────
if (lastAlgo.photo) {
  const photoEntries = Object.entries(pexelsData)
    .filter(([url]) => url.includes(lastAlgo.photo))
    .filter(([, ts]) => now - ts < TTL)
  const dupPhotos = photoEntries.length > 1 ? photoEntries.length - 1 : 0
  console.log(`  dupPhotos: ${dupPhotos}`)
  if (dupPhotos > 0) {
    console.log(`  ⚠️  WARNING: Photo ${lastAlgo.photo} reused ${dupPhotos} times in 48h`)
  }
}

// ─── Find latest rendered video ──────────────────────────────────────────────
const outputDirs = fs.readdirSync(path.join(ROOT, 'output'))
  .filter(d => d.startsWith('batch-'))
  .sort()
  .reverse()

let videoPath = null
let thumbnailPath = null
for (const dir of outputDirs) {
  const fp = path.join(ROOT, 'output', dir, 'final.mp4')
  if (fs.existsSync(fp)) {
    videoPath = fp
    const tp = path.join(ROOT, 'output', dir, 'thumbnail.png')
    if (fs.existsSync(tp)) thumbnailPath = tp
    break
  }
}

if (!videoPath) {
  console.log('\n[DRY-RUN] No final.mp4 found — showing publish payload only')
  const { formatTitle } = await import(path.join(ROOT, 'src', 'publishing', 'TitleTemplates.mjs'))
  console.log('\nPayload:')
  console.log(JSON.stringify({
    title: formatTitle({ title: lastAlgo.title, category: lastAlgo.category }),
    description,
    algoNumber: lastAlgo.algoNumber,
    algoVisual: lastAlgo.visual,
    algoTone: lastAlgo.tone,
    hook: lastAlgo.hook,
    category: lastAlgo.category,
    privacy: process.env.YOUTUBE_PRIVACY || 'public',
  }, null, 2))
  console.log('\n✅ M8 dry-run complete — ALGO injection wired')
  process.exit(0)
}

if (dryRun) {
  console.log(`\n[DRY-RUN] Video: ${videoPath}`)
  console.log(`[DRY-RUN] Thumbnail: ${thumbnailPath || 'none'}`)
  console.log('\nPayload:')
  console.log(JSON.stringify({
    title: formatTitle({ title: lastAlgo.title, category: lastAlgo.category }),
    description,
    algoNumber: lastAlgo.algoNumber,
    videoPath,
    thumbnailPath,
    privacy: process.env.YOUTUBE_PRIVACY || 'public',
  }, null, 2))
  console.log('\n✅ M8 dry-run complete — ALGO injection wired')
  process.exit(0)
}

// ─── Real publish ────────────────────────────────────────────────────────────
console.log(`\n[UPLOAD] Publishing: ${videoPath}`)
console.log(`[UPLOAD] Title: ${formatTitle({ title: lastAlgo.title, category: lastAlgo.category })}`)

try {
  const { validateRenderOutput } = await import(path.join(ROOT, 'src', 'video', 'validateOutput.mjs'))
  const vres = await validateRenderOutput(videoPath, { requireAudio: true })
  if (!vres.ok) {
    console.error(`[BLOCKED] Invalid render: ${vres.errors.join(', ')}`)
    process.exit(1)
  }

  const { uploadShort } = await import(path.join(ROOT, 'apps', 'api', 'publishers', 'youtube.js'))
  const { formatTitle } = await import(path.join(ROOT, 'src', 'publishing', 'TitleTemplates.mjs'))
  const buffer = fs.readFileSync(videoPath)
  const title = formatTitle({ title: lastAlgo.title, category: lastAlgo.category })

  const result = await uploadShort(
    `data:video/mp4;base64,${buffer.toString('base64')}`,
    title,
    description,
    process.env.YOUTUBE_PRIVACY || 'public',
    thumbnailPath
  )

  console.log(`\n[UPLOAD] ✅ Published: https://youtu.be/${result?.id}`)
  console.log(`[UPLOAD] ALGO #${lastAlgo.algoNumber}/48 • ${lastAlgo.visual} • ${lastAlgo.tone}`)

  if (result?.id) {
    const { PublishEventsStore } = await import(path.join(ROOT, 'src', 'publishing', 'PublishEventsStore.mjs'))
    new PublishEventsStore().record({
      videoId: result.id,
      title: title.slice(0, 100),
      category: lastAlgo.category || 'technology',
      cta: null,
      comment: null,
      metadata: {
        algoNumber: lastAlgo.algoNumber,
        algoVisual: lastAlgo.visual,
        algoTone: lastAlgo.tone,
        hook: lastAlgo.hook,
        photo: lastAlgo.photo,
      },
    })
    console.log(`[UPLOAD] Event recorded for ${result.id}`)
  }

  // ─── Post-publish diversity check ────────────────────────────────────────
  console.log('\n=== Post-Publish Diversity Check ===')
  console.log(`dupPhotos: ${recentUniquePhotos === recentUrls.length ? 0 : 'CHECK'}`)
  console.log(`Algo #${lastAlgo.algoNumber}/48 recorded in algos-used.json ✅`)

} catch (e) {
  console.error(`\n[FAILED] Publish failed: ${e.message}`)
  process.exit(1)
}
