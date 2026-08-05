// run-batch — generate N Shorts from fresh trending headlines, each with a
// DIFFERENT original track from the 48-track collection (deterministic title
// hash) and the premium ElevenLabs voice.
//
// Usage:
//   node scripts/run-batch.mjs [count=48]        # round-robin categories
//   node scripts/run-batch.mjs [count] technology # one category
//
// Articles come from NewsAPI top-headlines (key in .env). Each video is
// composed, uploaded public, and recorded in data/publish-events.json —
// same pipeline as scripts/composer.mjs / scripts/regenerate.mjs.

import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import 'dotenv/config'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..')

const COUNT = Math.max(1, parseInt(process.argv[2] || '48', 10))
const FIXED_CATEGORY = process.argv[3] || null
const CATEGORIES = ['technology', 'business', 'science', 'health', 'entertainment', 'sports']
const PAGE_SIZE = 100

async function fetchHeadlines(count, fixedCategory) {
  const key = process.env.NEWSAPI_KEY
  if (!key) throw new Error('NEWSAPI_KEY missing in .env')

  const cats = fixedCategory ? [fixedCategory] : CATEGORIES
  const picked = new Set()
  const articles = []
  let page = 1

  while (articles.length < count && page <= 5) {
    for (const category of cats) {
      if (articles.length >= count) break
      try {
        const qs = `?country=us&category=${category}&pageSize=${Math.min(100, count)}&page=${page}`
        const res = await fetch(`https://newsapi.org/v2/top-headlines${qs}`, { headers: { 'X-Api-Key': key } })
        if (!res.ok) continue
        const j = await res.json()
        for (const a of (j.articles || [])) {
          const title = (a.title || '').replace(/ - .*$/, '').trim()
          if (!title || title.length < 20 || picked.has(title)) continue
          if (/\b(remove|delete|sponsor|sponsored)\b/i.test(title)) continue
          picked.add(title)
          articles.push({ title, source: a.source?.name || 'NewsAPI', category, url: a.url || '' })
          if (articles.length >= count) break
        }
      } catch (e) { console.warn(`  fetch ${category} page ${page}: ${e.message}`) }
    }
    page++
  }
  return articles.slice(0, count)
}

async function publishOne(article, index) {
  const outDir = path.join(ROOT, 'output', `batch-${String(index).padStart(2, '0')}`)
  console.log(`\n=== [${index}] ${article.title} ===`)
  const { ensureMusicExists } = await import(path.join(ROOT, 'scripts', 'audio.mjs'))
  await ensureMusicExists()
  const { composeVideo } = await import(path.join(ROOT, 'scripts', 'composer.mjs'))
  const { finalPath } = await composeVideo([{ ...article, imageUrl: null }], outDir)
  console.log('Uploading to YouTube...')
  const { uploadShort } = await import(path.join(ROOT, 'apps', 'api', 'publishers', 'youtube.js'))
  const buffer = fs.readFileSync(finalPath)
  const title = `${article.title.slice(0, 90)} | NEWS-MONSTER`
  const coverPath = fs.existsSync(path.join(outDir, 'cover.png')) ? path.join(outDir, 'cover.png') : null
  const { HashtagBuilder } = await import(path.join(ROOT, 'src', 'publishing', 'HashtagBuilder.mjs'))
  const hashtags = HashtagBuilder.build({
    topic: HashtagBuilder.topicFromHeadline(article.title),
    category: article.category,
    pipelineProfile: 'breaking',
    channel: 'NEWS-MONSTER',
  })
  const desc = `${title}\n\nSource: ${article.source || 'NewsAPI'}\n\n${hashtags}`
  const result = await uploadShort(
    `data:video/mp4;base64,${buffer.toString('base64')}`,
    title, desc,
    process.env.YOUTUBE_PRIVACY || 'public',
    coverPath
  )
  console.log(`[UPLOAD] index=${index} videoId=${result?.id} url=https://youtu.be/${result?.id}`)
  try {
    const { PublishEventsStore } = await import(path.join(ROOT, 'src', 'publishing', 'PublishEventsStore.mjs'))
    new PublishEventsStore().record({
      videoId: result?.id,
      title: article.title.slice(0, 100),
      category: article.category,
      cta: null,
      comment: null,
      metadata: { batch: true, index },
    })
  } catch (e) { /* artifact best-effort */ }
  return result?.id
}

const articles = await fetchHeadlines(COUNT, FIXED_CATEGORY)
if (!articles.length) { console.error('No articles fetched'); process.exit(1) }
console.log(`Fetched ${articles.length} headlines — starting ${articles.length}-video batch`)
for (let i = 0; i < articles.length; i++) {
  await publishOne(articles[i], i + 1)
}
console.log('\nBatch complete')