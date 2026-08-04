import fs from 'fs'
import path from 'path'
import { execFileSync } from 'child_process'
import { ensureMusicExists } from './audio.mjs'
import { fetchBestImage } from './pexels.mjs'
import { NewsBroadcastEngine } from '../src/index.mjs'

export async function composeVideo(articles, outDir = 'output') {
  fs.mkdirSync(outDir, { recursive: true })
  const article = articles[0]
  if (!article) throw new Error('No articles')

  if (!article.imageUrl) {
    await fetchBestImage(article)
  }

  const engine = new NewsBroadcastEngine()
  const result = await engine.generateFromArticle(article, outDir, null, { quick: !!process.env.QUICK_RENDER })
  const broadcastPath = typeof result === 'string' ? result : result.videoPath

  const finalPath = `${outDir}/final.mp4`
  fs.copyFileSync(broadcastPath, finalPath)

  const footerPath = 'assets/footer.png'
  if (fs.existsSync(footerPath)) {
    const withFooter = `${outDir}/final_with_footer.mp4`
    execFileSync(
      'ffmpeg',
      ['-y', '-i', finalPath, '-i', footerPath, '-filter_complex', '[0:v][1:v]overlay=0:main_h-overlay_h:format=auto,format=yuv420p[v]', '-map', '[v]', '-map', '0:a', '-c:a', 'copy', withFooter],
      { stdio: 'inherit' }
    )
    fs.copyFileSync(withFooter, finalPath)
  }

  return { finalPath, hooks: [], retention: engine.lastRetention || null }
}

if (import.meta.url.endsWith('composer.mjs')) {
  const runFull = async () => {
    const category = process.env.INPUT_CATEGORY || process.argv[2] || 'technology'
    const outDir = 'output'
    fs.mkdirSync(outDir, { recursive: true })

    await ensureMusicExists()

    let articles
    if (process.env.NEWSAPI_KEY) {
      try {
        const newsSvc = await import('../apps/api/services/news.js')
        const yesterday = new Date(Date.now() - 864e5).toISOString().slice(0, 10)
        const CATEGORY_QUERY = {
          tesla: ['tesla', { pageSize: 3, sortBy: 'publishedAt' }],
          apple: ['apple', { pageSize: 3, sortBy: 'popularity', from: yesterday, to: yesterday }],
        }
        const preset = CATEGORY_QUERY[category]
        if (preset) {
          articles = await newsSvc.searchNews(preset[0], preset[1])
          if (!articles.length && preset[1].from) {
            console.log(`[NEWS] ${category}: empty date-filtered result, retrying without date range (free-plan window)`)
            const { from, to, ...rest } = preset[1]
            articles = await newsSvc.searchNews(preset[0], rest)
          }
        } else {
          articles = await newsSvc.fetchTopHeadlines({ category, pageSize: 3 })
        }
      } catch (e) { console.log('NewsAPI error:', e.message) }
    }

    if (articles?.length) {
      const techKeywords = ['ai', 'apple', 'google', 'microsoft', 'meta', 'tesla', 'nvidia', 'openai', 'chatgpt', 'iphone', 'samsung', 'robot', 'chip', 'software', 'update', 'launch', 'cyber', 'quantum', 'space', 'data', 'cloud', 'app', 'digital', 'tech', 'computer', 'phone', 'electric', 'gaming', 'console', 'startup', 'algorithm', 'neural', 'blockchain', 'autonomous', 'drone', 'satellite', 'battery', 'solar', 'ai', 'vr', 'ar', '5g', '6g', 'processor', 'gpu', 'cpu', 'security', 'privacy']
      articles = articles.filter(a => {
        const t = (a.title || '').toLowerCase()
        return techKeywords.some(k => t.includes(k))
      })
      if (articles.length === 0) {
        console.log('No tech articles found, using fallback')
        articles = null
      }
    }

    if (!articles?.length) {
      if (process.env.NEWSAPI_KEY && !process.argv[2]) {
        throw new Error(`No articles returned for category "${category}" (NewsAPI empty or rate-limited) — aborting instead of publishing placeholder content`)
      }
      articles = [{
        title: process.argv[2] || 'Apple releases groundbreaking AI model that changes everything',
        description: process.argv[3] || 'Apple announced a revolutionary new AI model that can process images and video simultaneously.',
        source: 'Tech News',
        url: '',
        imageUrl: null,
        category,
        publishedAt: new Date().toISOString(),
      }]
    }

    let uploadCount = 0
    for (const rawArticle of articles) {
      const article = {
        title: rawArticle.title,
        description: rawArticle.description || rawArticle.title,
        source: rawArticle.source?.name || rawArticle.source || 'NewsAPI',
        url: rawArticle.url || '',
        imageUrl: rawArticle.imageUrl || rawArticle.urlToImage || null,
        category: rawArticle.category || category,
        publishedAt: rawArticle.publishedAt || new Date().toISOString(),
      }

      console.log(`\nProcessing: "${article.title?.slice(0, 80)}..."`)

      const renderStart = Date.now()
      const { finalPath, retention } = await composeVideo([article], outDir)
      const renderTime = Date.now() - renderStart

      if (process.env.YOUTUBE_REFRESH_TOKEN && uploadCount === 0) {
        uploadCount++
        console.log('Uploading to YouTube...')
        try {
          // Stage 4: Publish preflight — video must exist before upload
          const { ProductionPreflight } = await import('../src/ai/ProductionPreflight.mjs')
          const publishPreflight = await ProductionPreflight.check({}, { outDir, stage: 'publish' })
          if (!publishPreflight.ready) {
            throw new Error(`Publish preflight failed: ${publishPreflight.errors.join(', ')}`)
          }
          const { uploadShort } = await import('../apps/api/publishers/youtube.js')
          const buffer = fs.readFileSync(finalPath)
          const title = `${article.title?.slice(0, 90) || 'News Update'} | NEWS-MONSTER`
          const coverPath = fs.existsSync('output/cover.png') ? 'output/cover.png' : null
          const { HashtagBuilder } = await import('../src/publishing/HashtagBuilder.mjs')
          const hashtags = HashtagBuilder.build({
            topic: HashtagBuilder.topicFromHeadline(article.title),
            category: category || 'tech',
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

          // Community loop — post the topic-specific pinned-comment question.
          // The 100% 'stayed to watch' audience needs a reason to comment.
          let commentEvent = null
          if (result?.id) {
            try {
              const { PinnedCommentBuilder } = await import('../src/publishing/PinnedCommentBuilder.mjs')
              const { TopicCtaBuilder } = await import('../src/publishing/TopicCtaBuilder.mjs')
              const { postComment } = await import('../apps/api/publishers/youtube.js')
              const cta = new TopicCtaBuilder().build(article)
              const comment = new PinnedCommentBuilder().build(article)
              console.log(`[CTA] topic=${cta.topic} mode=${cta.mode} "${cta.narration}"`)
              console.log(`[PIN COMMENT] "${comment.question}"`)
              const posted = await postComment(result.id, comment.question)
              console.log(`[COMMENT INSERT] ${posted?.id ? `success commentId=${posted.id}` : 'failed — post it manually in Studio and pin it'}`)
              commentEvent = {
                text: comment.question,
                status: posted?.id ? 'published' : 'failed',
                commentId: posted?.id || null,
              }
            } catch (e) { console.log('[PIN COMMENT] skipped:', e.message) }
          }

          // Ground-truth artifact: what the pipeline shipped (CTA + comment)
          // joins with later analytics to measure whether the loop works.
          try {
            const { TopicCtaBuilder } = await import('../src/publishing/TopicCtaBuilder.mjs')
            const { PublishEventsStore } = await import('../src/publishing/PublishEventsStore.mjs')
            const cta = new TopicCtaBuilder().build(article)
            new PublishEventsStore().record({
              videoId: result?.id,
              title: article.title?.slice(0, 100),
              category: category || 'technology',
              cta: { topic: cta.topic, mode: cta.mode, text: cta.narration },
              comment: commentEvent || null,
            })
            console.log('[ARTIFACT] data/publish-events.json updated')
          } catch (e) { console.log('[ARTIFACT] skipped:', e.message) }

          // Snapshot the pipeline's retention prediction for the
          // RetentionPatternLearner (real analytics calibrate memory later)
          if (result?.id && retention) {
            try {
              const { RetentionPatternLearner } = await import('../src/analytics/RetentionPatternLearner.mjs')
              new RetentionPatternLearner().appendSnapshot({ videoId: result.id, title: article.title?.slice(0, 100), category: category || 'technology', retention })
              console.log('Retention snapshot recorded for learning loop')
            } catch (e) { console.log('Retention snapshot skipped:', e.message) }
          }
        } catch (e) {
          console.log('Upload failed:', e.message)
          throw new Error(`Upload failed — no video published: ${e.message}`)
        }
      }
    }

    console.log('\nNEWS-MONSTER Broadcast Pipeline Complete')
  }

  runFull().catch(e => {
    console.error('Fatal:', e.stack || e)
    process.exit(1)
  })
}
