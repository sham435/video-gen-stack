// upload-queued — upload already-rendered finals (skips rendering entirely).
// Use after a YouTube daily-upload-cap failure: the videos exist in
// output/batch-NN/final.mp4 but were never published.
//
// Usage:
//   node scripts/upload-queued.mjs 31 32 33 34 35
//
// Titles come from output/batch-NN/title.txt if present, else from the
// trailing "===" lines of a log file, else the batch index. Writes to
// data/publish-events.json like run-batch.mjs.

import fs from 'fs'
import path from 'path'
import os from 'os'
import { fileURLToPath } from 'url'
import 'dotenv/config'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..')
const TITLE_LOG = path.join(os.tmpdir(), 'batch48b.log')
const indexes = process.argv.slice(2).map(Number).filter(Boolean)

if (!indexes.length) {
  console.error('usage: node scripts/upload-queued.mjs 31 32 33 ...')
  process.exit(1)
}

const TITLE_HINTS = fs.existsSync(TITLE_LOG)
  ? fs.readFileSync(TITLE_LOG, 'utf8').split('\n')
      .filter(l => l.startsWith('=== ['))
      .map(l => l.replace(/^=== \[(\d+)\] /, '$1|'))
      .map(l => l.split('|'))
      .filter(a => a.length === 2)
  : []

function titleFor(index) {
  const outDir = path.join(ROOT, 'output', `batch-${String(index).padStart(2, '0')}`)
  const t = path.join(outDir, 'title.txt')
  if (fs.existsSync(t)) return fs.readFileSync(t, 'utf8').trim()
  const hit = TITLE_HINTS.find(([i]) => i === String(index))
  if (hit) return hit[1].trim()
  return `NEWS-MONSTER | ${index}`
}

for (const index of indexes) {
  const outDir = path.join(ROOT, 'output', `batch-${String(index).padStart(2, '0')}`)
  const finalPath = path.join(outDir, 'final.mp4')
  if (!fs.existsSync(finalPath)) {
    console.error(`[SKIP] index=${index} no final.mp4 in ${outDir}`)
    continue
  }
  // RENDER-001: never re-upload a corrupt/truncated render. Existence alone
  // is not the gate — probe the container before base64-uploading it.
  const { validateRenderOutput } = await import(path.join(ROOT, 'src', 'video', 'validateOutput.mjs'))
  const vres = validateRenderOutput(finalPath, { requireAudio: true })
  if (!vres.ok) {
    console.error(`[SKIP] index=${index} invalid render (${vres.errors.join(', ')}) — not uploading ${finalPath}`)
    continue
  }
  const { formatTitle } = await import(path.join(ROOT, 'src', 'publishing', 'TitleTemplates.mjs'))
  const title = formatTitle({ title: titleFor(index) })
  // Prefer the 16:9 thumbnail (1280x720) — that's what YouTube shows in
  // feed/suggestions; fall back to the portrait cover.
  const thumbPath = path.join(outDir, 'thumbnail.png')
  let coverPath = null
  if (fs.existsSync(thumbPath)) coverPath = thumbPath
  else if (fs.existsSync(path.join(outDir, 'cover.png'))) coverPath = path.join(outDir, 'cover.png')
  const { HashtagBuilder } = await import(path.join(ROOT, 'src', 'publishing', 'HashtagBuilder.mjs'))
  const hashtags = HashtagBuilder.build({
    topic: HashtagBuilder.topicFromHeadline(title),
    category: 'technology',
    pipelineProfile: 'breaking',
    channel: 'NEWS-MONSTER',
  })
  const desc = `${title}\n\n${hashtags}`
  console.log(`[UPLOADING] index=${index} "${title}"`)
  try {
    const { uploadShort } = await import(path.join(ROOT, 'apps', 'api', 'publishers', 'youtube.js'))
    const buffer = fs.readFileSync(finalPath)
    const result = await uploadShort(
      `data:video/mp4;base64,${buffer.toString('base64')}`,
      title, desc,
      process.env.YOUTUBE_PRIVACY || 'public',
      coverPath
    )
    console.log(`[UPLOAD] index=${index} videoId=${result?.id} url=https://youtu.be/${result?.id}`)
    if (result?.id) {
      const { PublishEventsStore } = await import(path.join(ROOT, 'src', 'publishing', 'PublishEventsStore.mjs'))
      new PublishEventsStore().record({
        videoId: result.id,
        title: title.slice(0, 100),
        category: 'technology',
        cta: null,
        comment: null,
        metadata: { batch: true, index, retried: true },
      })
    }
  } catch (e) {
    console.error(`[FAILED] index=${index}: ${e.message}`)
  }
}
console.log('\nQueue done')