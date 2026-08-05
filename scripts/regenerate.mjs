// Regeneration runner — re-render + re-upload specific articles with the
// visual-diversity fix (fresh hero image per video).
//
// Usage:
//   source .env && node scripts/regenerate.mjs
//
// Rebuilds each article in a fresh outDir (separate cover per video), uploads
// with the same title/desc/hashtag pipeline as scripts/composer.mjs, posts the
// pinned comment (best-effort), and records the publish event.

import fs from 'fs'
import path from 'path'
import { execFileSync } from 'child_process'
import { fileURLToPath } from 'url'
import 'dotenv/config'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..')

const ARTICLES = [
  {
    title: '6 Mini Gadgets To Add To Your Wishlist In 2026 - SlashGear',
    source: 'SlashGear',
    category: 'technology',
    url: '',
  },
  {
    title: "'Sandwich generation' is getting younger and not any better prepared - USA Today",
    source: 'USA Today',
    category: 'business',
    url: '',
  },
  {
    title: "This 1979 Mercedes-Benz 280TE Was Trapped Inside An Italian Garage For 38 Years, Now It's",
    source: 'NewsAPI',
    category: 'business',
    url: '',
  },
]

async function publishOne(article, index) {
  const outDir = path.join(ROOT, 'output', `regen-${index}`)
  console.log(`\n=== [${index + 1}/${ARTICLES.length}] ${article.title} ===`)

  const { ensureMusicExists } = await import(path.join(ROOT, 'scripts', 'audio.mjs'))
  await ensureMusicExists()
  const { composeVideo } = await import(path.join(ROOT, 'scripts', 'composer.mjs'))
  const { finalPath, retention } = await composeVideo([{ ...article, imageUrl: null }], outDir)

  console.log('Uploading to YouTube...')
  const { ProductionPreflight } = await import(path.join(ROOT, 'src', 'ai', 'ProductionPreflight.mjs'))
  const publishPreflight = await ProductionPreflight.check({}, { outDir, stage: 'publish' })
  if (!publishPreflight.ready) {
    throw new Error(`Publish preflight failed: ${publishPreflight.errors.join(', ')}`)
  }

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
  console.log(`[UPLOAD] videoId=${result?.id} url=https://youtu.be/${result?.id}`)

  let commentEvent = null
  if (result?.id) {
    try {
      const { PinnedCommentBuilder } = await import(path.join(ROOT, 'src', 'publishing', 'PinnedCommentBuilder.mjs'))
      const { TopicCtaBuilder } = await import(path.join(ROOT, 'src', 'publishing', 'TopicCtaBuilder.mjs'))
      const { postComment } = await import(path.join(ROOT, 'apps', 'api', 'publishers', 'youtube.js'))
      const comment = new PinnedCommentBuilder().build(article)
      const posted = await postComment(result.id, comment.question)
      console.log(`[COMMENT INSERT] ${posted?.id ? `success commentId=${posted.id}` : 'failed — set YOUTUBE_PARENT_COMMENT_ID to reuse a parent'}`)
      commentEvent = {
        text: comment.question,
        status: posted?.id ? 'published' : 'failed',
        commentId: posted?.id || null,
      }
    } catch (e) { console.log('[PIN COMMENT] skipped:', e.message) }
  }

  try {
    const { TopicCtaBuilder } = await import(path.join(ROOT, 'src', 'publishing', 'TopicCtaBuilder.mjs'))
    const { PublishEventsStore } = await import(path.join(ROOT, 'src', 'publishing', 'PublishEventsStore.mjs'))
    const cta = new TopicCtaBuilder().build(article)
    new PublishEventsStore().record({
      videoId: result?.id,
      title: article.title.slice(0, 100),
      category: article.category,
      cta: { topic: cta.topic, mode: cta.mode, text: cta.narration },
      comment: commentEvent || null,
      metadata: { regeneration: true, originalVideos: ['zQ4NcXYeRxQ', 'IUOeLKxN1DU', 'yCj8ELhp8H0'] },
    })
    console.log('[ARTIFACT] data/publish-events.json updated')
  } catch (e) { console.log('[ARTIFACT] skipped:', e.message) }

  if (result?.id && retention) {
    try {
      const { RetentionPatternLearner } = await import(path.join(ROOT, 'src', 'analytics', 'RetentionPatternLearner.mjs'))
      new RetentionPatternLearner().appendSnapshot({ videoId: result.id, title: article.title.slice(0, 100), category: article.category, retention })
    } catch (e) { console.log('[RETENTION] skipped:', e.message) }
  }
  return result?.id
}

const START = parseInt(process.env.REGEN_START || '0', 10) || 0
for (let i = START; i < ARTICLES.length; i++) {
  await publishOne(ARTICLES[i], i + 1)
}
console.log('\nRegeneration complete')
