#!/usr/bin/env node
// Render artifact garbage collector — safely reclaims disk space from
// abandoned render output. Dry-run by default: pass --apply to actually
// delete anything.
//
//   node scripts/gc-artifacts.mjs            # dry run, reports only
//   node scripts/gc-artifacts.mjs --apply    # delete eligible artifacts
//   node scripts/gc-artifacts.mjs --older-than 14
//
// Cleanup targets:
//   - output/regen-* regeneration folders
//   - output/batch-* folders whose batch was never published (failed batches)
//   - old temporary renders (*.tmp.mp4, *_tmp, draft-*, stale frames)
//
// Always kept:
//   - output/final.mp4 and broadcast_final.mp4 (the canonical published renders)
//   - any batch folder referenced by a publish event (published artifacts)
//   - the most recently modified batch folder (active render)

import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..')
const OUTPUT_DIR = path.join(ROOT, 'output')
const PUBLISH_EVENTS = path.join(ROOT, 'data', 'publish-events.json')

const DEFAULT_TEMP_AGE_DAYS = 7

function loadPublishEvents() {
  try {
    const raw = fs.readFileSync(PUBLISH_EVENTS, 'utf-8')
    const data = JSON.parse(raw)
    return Array.isArray(data) ? data : (data.events || [])
  } catch {
    return []
  }
}

// Collect the set of output folder names referenced by publish events so we
// never delete artifacts that reached a consumer.
function publishedRefs() {
  const refs = new Set()
  for (const evt of loadPublishEvents()) {
    const fields = [
      evt?.metadata?.outputDir,
      evt?.metadata?.outDir,
      evt?.outputDir,
      evt?.outDir,
    ]
    for (const f of fields) {
      if (typeof f === 'string' && f) refs.add(path.basename(f))
    }
    const title = evt?.title || evt?.videoName
    if (typeof title === 'string') refs.add(path.basename(title, '.mp4'))
  }
  return refs
}

function dirSize(dir) {
  let total = 0
  const stack = [dir]
  while (stack.length) {
    const cur = stack.pop()
    let entries
    try { entries = fs.readdirSync(cur, { withFileTypes: true }) } catch { continue }
    for (const e of entries) {
      const full = path.join(cur, e.name)
      if (e.isDirectory()) stack.push(full)
      else {
        try { total += fs.statSync(full).size } catch {}
      }
    }
  }
  return total
}

function collectCandidates() {
  const candidates = [] // { path, reason, bytes }
  const published = publishedRefs()

  if (!fs.existsSync(OUTPUT_DIR)) return candidates

  const entries = fs.readdirSync(OUTPUT_DIR, { withFileTypes: true })

  const batchDirs = entries
    .filter((e) => e.isDirectory() && /^batch-\d+$/.test(e.name))
    .sort((a, b) => {
      const ta = fs.statSync(path.join(OUTPUT_DIR, a.name)).mtimeMs
      const tb = fs.statSync(path.join(OUTPUT_DIR, b.name)).mtimeMs
      return tb - ta
    })

  // Active render = newest batch directory. Never touch it.
  const activeBatch = batchDirs[0]?.name

  for (const e of entries) {
    const full = path.join(OUTPUT_DIR, e.name)

    // 1. regen-* folders are always candidates
    if (e.isDirectory() && /^regen-\d+/.test(e.name)) {
      candidates.push({ path: full, reason: 'regeneration folder', bytes: dirSize(full) })
      continue
    }

    // 2. batch-* folders: keep published + active, clean the rest
    if (e.isDirectory() && /^batch-\d+$/.test(e.name)) {
      if (e.name === activeBatch || published.has(e.name)) continue
      candidates.push({ path: full, reason: 'unpublished batch', bytes: dirSize(full) })
      continue
    }

    // 3. temp / draft files
    if (e.isFile()) {
      const isTemp = /\.(tmp|temp)(\.mp4)?$/.test(e.name) || /^(draft-|\.tmp)/.test(e.name)
      if (isTemp) {
        candidates.push({ path: full, reason: 'temporary render', bytes: statSize(full) })
      }
    }
  }

  return candidates
}

function statSize(p) {
  try { return fs.statSync(p).size } catch { return 0 }
}

function ageInDays(p) {
  try {
    return (Date.now() - fs.statSync(p).mtimeMs) / (1000 * 60 * 60 * 24)
  } catch {
    return 0
  }
}

async function main() {
  const args = process.argv.slice(2)
  const apply = args.includes('--apply')
  const olderThanFlag = args.find((a) => a.startsWith('--older-than'))
  const olderThan = olderThanFlag ? Number(olderThanFlag.split('=')[1] || args[args.indexOf(olderThanFlag) + 1]) : DEFAULT_TEMP_AGE_DAYS

  const candidates = collectCandidates().filter((c) => ageInDays(c.path) >= 0)

  const eligible = candidates.filter((c) => {
    if (c.reason === 'regeneration folder' || c.reason === 'unpublished batch') return true
    return ageInDays(c.path) >= olderThan
  })

  const totalBytes = eligible.reduce((s, c) => s + c.bytes, 0)

  console.log(`[gc] output dir: ${OUTPUT_DIR}`)
  console.log(`[gc] mode: ${apply ? 'APPLY' : 'DRY-RUN'}`)
  console.log(`[gc] found ${eligible.length} eligible items (${(totalBytes / (1024 * 1024)).toFixed(1)} MB)`)

  for (const c of eligible) {
    const rel = path.relative(ROOT, c.path)
    const size = `${(c.bytes / (1024 * 1024)).toFixed(1)} MB`
    console.log(`  ${apply ? 'REMOVE' : 'WOULD REMOVE'}  ${rel}  (${c.reason}, ${size})`)
    if (apply) {
      try { fs.rmSync(c.path, { recursive: true, force: true }) } catch (err) {
        console.error(`  FAILED  ${rel}: ${err.message}`)
      }
    }
  }

  console.log(`[gc] ${apply ? 'removed' : 'would remove'} ${eligible.length} items, ${(totalBytes / (1024 * 1024)).toFixed(1)} MB reclaimed`)
}

main().catch((err) => {
  console.error(`[gc] error: ${err.message}`)
  process.exitCode = 1
})