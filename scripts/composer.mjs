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

// Guard: only self-execute when run directly (`node scripts/composer.mjs`),
// never when imported by another script/tool (import.meta.url always ends
// with the module filename, so a filename check alone is wrong).
if (process.argv[1] && import.meta.url.endsWith(process.argv[1])) {
  const runFull = async () => {
    const category = process.env.INPUT_CATEGORY || process.argv[2] || 'technology'
    const outDir = 'output'
    fs.mkdirSync(outDir, { recursive: true })

    await ensureMusicExists()

    let articles
    let preset = null

    // NewsData.io is the primary source (enforces a 3-hour fetch gap); NewsAPI
    // remains the fallback when NewsData is unconfigured or returns nothing.
    if (!articles) {
      try {
        const newsDataSvc = await import('../src/news/NewsDataProvider.mjs')
        if (newsDataSvc.isConfigured()) {
          articles = await newsDataSvc.fetchTopHeadlines({ category })
        }
      } catch (e) { console.log('NewsData error:', e.message) }
    }

    if (!articles && process.env.NEWSAPI_KEY) {
      try {
        const newsSvc = await import('../apps/api/services/news.js')
        const yesterday = new Date(Date.now() - 864e5).toISOString().slice(0, 10)
        const CATEGORY_QUERY = {
          tesla: ['search', 'tesla', { pageSize: 3, sortBy: 'publishedAt' }],
          apple: ['search', 'apple', { pageSize: 3, sortBy: 'popularity', from: yesterday, to: yesterday }],
          wsj: ['search', '', { pageSize: 3, sortBy: 'publishedAt', domains: 'wsj.com' }],
          techcrunch: ['headlines', { sources: 'techcrunch', pageSize: 3 }],
          business: ['headlines', { category: 'business', country: 'us', pageSize: 3 }],
        }
        preset = CATEGORY_QUERY[category]
        if (preset) {
          if (preset[0] === 'search') {
            articles = await newsSvc.searchNews(preset[1], preset[2])
            if (!articles.length && preset[2].from) {
              console.log(`[NEWS] ${category}: empty date-filtered result, retrying without date range`)
              const { from, to, ...rest } = preset[2]
              articles = await newsSvc.searchNews(preset[1], rest)
            }
          } else {
            articles = await newsSvc.fetchTopHeadlines(preset[1])
          }
        } else {
          articles = await newsSvc.fetchTopHeadlines({ category, pageSize: 3 })
        }
      } catch (e) { console.log('NewsAPI error:', e.message) }
    }

    if (articles?.length && !preset) {
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

    // Dedup: skip articles already published in the last 24h (stale free-plan
    // feeds like TechCrunch keep returning the same headlines — the channel
    // should not repost the identical story every 30 minutes).
    try {
      const { PublishEventsStore } = await import('../src/publishing/PublishEventsStore.mjs')
      const cutoff = Date.now() - 864e5
      const used = new Set()
      for (const ev of new PublishEventsStore().events) {
        const ts = ev.publishedAt ? new Date(ev.publishedAt).getTime() : 0
        if (ts > cutoff && ev.title) used.add(String(ev.title).trim().toLowerCase())
      }
      if (used.size) {
        const fresh = (articles || []).filter(a => !used.has(String(a.title || '').trim().toLowerCase()))
        if (fresh.length) {
          console.log(`[DEDUP] skipped ${articles.length - fresh.length} already-published article(s)`)
          articles = fresh
        } else {
          console.log('[DEDUP] all fetched articles were published in the last 24h — taking the newest anyway')
          articles = articles.slice(0, 1)
        }
      }
    } catch { /* dedup is best-effort */ }

    if (!articles?.length) {
      // Never publish placeholder junk. If a manual override title was passed
      // (process.argv[2]) that's an explicit operator decision; otherwise abort.
      const override = process.argv[2]?.trim()
      if (override && !process.env.NEWSAPI_KEY) {
        articles = [{
          title: override,
          description: process.argv[3] || 'A story from the NEWS-MONSTER pipeline.',
          source: 'Operator override',
          url: '',
          imageUrl: null,
          category,
          publishedAt: new Date().toISOString(),
        }]
      } else {
        throw new Error(
          `No articles returned for category "${category}" — aborting instead of publishing placeholder content` +
          (process.env.NEWSAPI_KEY ? ' (NewsAPI empty or rate-limited)' : ' (no news source configured)')
        )
      }
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

          // Cross-post to LinkedIn — same video, 30-min cadence mirrored from
          // YouTube. Best-effort: a LinkedIn auth/config failure must never
          // fail the YouTube publish that already succeeded.
          if (process.env.LINKEDIN_ACCESS_TOKEN && process.env.LINKEDIN_MEMBER_URN) {
            try {
              const { shareVideo, updatePostCommentary, authorUrn } = await import('../apps/api/publishers/linkedin.js')
              // Mirror the YouTube description on LinkedIn: title, Source row,
              // hashtags — then append the YouTube shorts link. The LinkedIn
              // post's own feed URL is unknown until creation, so we add it in
              // a PARTIAL_UPDATE right after (…https://lnkd.in post link).
              const body = `${title}\n\nSource: ${article.source || 'NewsAPI'}\n\n${hashtags}\n\nhttps://www.youtube.com/shorts/${result?.id}`
              const li = await shareVideo(
                process.env.LINKEDIN_ACCESS_TOKEN,
                process.env.LINKEDIN_MEMBER_URN,
                `data:video/mp4;base64,${buffer.toString('base64')}`,
                body
              )
              const postId = li?.id
              if (postId) {
                try {
                  await updatePostCommentary(
                    process.env.LINKEDIN_ACCESS_TOKEN,
                    postId,
                    `${body}\n\nhttps://www.linkedin.com/feed/update/${postId}`
                  )
                  console.log(`[LINKEDIN] post=${postId} — shared https://www.linkedin.com/feed/update/${postId}`)
                } catch (ue) {
                  console.log(`[LINKEDIN] posted ${postId} (link append skipped: ${ue.message})`)
                }
              } else {
                console.log(`[LINKEDIN] post=ok — shared https://www.linkedin.com/feed/update/${li?.id || li?.urn}`)
              }
            } catch (e) {
              console.log(`[LINKEDIN] skipped (best-effort): ${e.message}`)
            }
          } else {
            console.log('[LINKEDIN] skipped — LINKEDIN_ACCESS_TOKEN/LINKEDIN_MEMBER_URN not set')
          }

          // POST-PUBLISH SOCIAL DISTRIBUTION — the video is confirmed live on
          // YouTube (result.id is set). Dispatch the promotional post to
          // LinkedIn + YouTube Community through the idempotent manager.
          // Best-effort: any platform failure is persisted but NEVER fails or
          // rolls back the YouTube publication that already succeeded.
          try {
            const { SocialDistributionManager } = await import('../src/publishing/SocialDistributionManager.mjs')
            const sdm = new SocialDistributionManager()
            const dist = await sdm.distribute({
              videoId: result?.id,
              title: article.title || title,
              videoUrl: `https://youtu.be/${result?.id}`,
              thumbnailPath: coverPath,
              category: category || 'technology',
              hook: `${article.title?.split(' ').slice(0, 5).join(' ') || 'This'} — here's what just happened.`,
              summary: (article.description || '').slice(0, 160) || `A story you should see from the desk of NEWS-MONSTER.`,
            })
            sdm.close()
            for (const [platform, r] of Object.entries(dist.results || {})) {
              console.log(`[DISTRIBUTE] ${platform}: ${r.status}${r.reason ? ` (${r.reason})` : ''}${r.postId ? ` postId=${r.postId}` : ''}${r.url ? ` url=${r.url}` : ''}`)
            }
          } catch (e) {
            console.log(`[DISTRIBUTE] skipped (best-effort): ${e.message}`)
          }

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
              console.log(`[COMMENT INSERT] ${posted?.id ? `success commentId=${posted.id}` : 'failed — post it manually in Studio and pin it, then set YOUTUBE_PARENT_COMMENT_ID to its ID'}`)
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
