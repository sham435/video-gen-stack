import fs from 'fs'
import path from 'path'
import { execFileSync } from 'child_process'
import { ensureMusicExists } from './audio.mjs'
import { fetchBestImage } from './pexels.mjs'
import { NewsBroadcastEngine } from '../src/index.mjs'
import { validateRenderOutput } from '../src/video/validateOutput.mjs'
import { resolveRenderManifest, resolveRenderGates } from '../src/pipeline/RenderManifest.mjs'

async function assertValidRender(file, stage) {
  const res = await validateRenderOutput(file, { requireAudio: true })
  if (res.ok) {
    console.log(`[RENDER-001] ${stage} OK ${(res.diagnostics.size / 1024).toFixed(0)}KB ${res.diagnostics.duration}s v=${res.diagnostics.hasVideo} a=${res.diagnostics.hasAudio}`)
    return res
  }
  const { diagnostics } = res
  const detail = [
    `stage=${stage}`,
    res.errors.join(','),
    `size=${diagnostics.size}`,
    `duration=${diagnostics.duration ?? 'n/a'}`,
    `moov=${diagnostics.moovDetected ?? 'n/a'}`,
  ].join(' | ')
  throw new Error(`Render validation failed: ${detail}`)
}

export async function composeVideo(articles, outDir = 'output', options = {}) {
  fs.mkdirSync(outDir, { recursive: true })
  const article = articles[0]
  if (!article) throw new Error('No articles')

  if (!article.imageUrl) {
    await fetchBestImage(article)
  }

  const engine = new NewsBroadcastEngine()
  const result = await engine.generateFromArticle(article, outDir, null, { ...options, quick: !!process.env.QUICK_RENDER })
  const broadcastPath = typeof result === 'string' ? result : result.videoPath

  const finalPath = `${outDir}/final.mp4`
  fs.copyFileSync(broadcastPath, finalPath)
  await assertValidRender(finalPath, 'final-copy')

  // Single footer owner — RenderManifest gate. The render engine draws the
  // footer on CANVAS into every frame (footer → canvas → FooterLayout). The
  // standalone footer.png composite is ONLY allowed when the canvas footer is
  // disabled and overlayFooter is explicitly requested (mutual exclusion).
  // Without this gate composer.mjs re-composites footer.png on top of a video
  // that already carries the canvas footer → two stacked footer bars.
  const manifest = resolveRenderManifest({ ...options, footer: options.footer })
  const gates = resolveRenderGates({ ...options, footer: options.footer }, manifest)
  const footerPath = 'assets/footer.png'
  if (gates.overlayFooter && fs.existsSync(footerPath)) {
    const withFooter = `${outDir}/final_with_footer.mp4`
    execFileSync(
      'ffmpeg',
      ['-y', '-i', finalPath, '-i', footerPath, '-filter_complex', '[0:v][1:v]overlay=0:main_h-overlay_h:format=auto,format=yuv420p[v]', '-map', '[v]', '-map', '0:a', '-c:a', 'copy', withFooter],
      { stdio: 'inherit' }
    )
    fs.copyFileSync(withFooter, finalPath)
    await assertValidRender(finalPath, 'footer-overlay')
  }

  return {
    engine,
    finalPath,
    hooks: [],
    retention: engine.lastRetention || null,
    musicTrack: engine.audioMixer.lastTrack?.file || null,
    musicFamily: engine.audioMixer.lastTrack?.family || engine.audioMixer.musicFamily || null,
  }
}

// Guard: only self-execute when run directly (`node scripts/composer.mjs`),
// never when imported by another script/tool (import.meta.url always ends
// with the module filename, so a filename check alone is wrong).
if (process.argv[1] && import.meta.url.endsWith(process.argv[1])) {
  const runFull = async () => {
    // Production preflight — validate all invariants before accepting traffic
    const { ProductionPreflight } = await import('../src/pipeline/ProductionPreflight.mjs')
    const preflight = await ProductionPreflight.run()
    if (!preflight.ok) {
      console.error('[PREFLIGHT] BLOCKED — production invariants not met:')
      for (const e of preflight.errors) console.error(`  - ${e}`)
      process.exit(1)
    }

    const category = process.env.INPUT_CATEGORY || process.argv[2] || 'technology'
    const outDir = 'output'
    fs.mkdirSync(outDir, { recursive: true })

    await ensureMusicExists()

    let articles
    let preset = null

    // NewsData.io is the primary source (enforces a 3-hour fetch gap); the
    // RapidAPI Real-Time News Data provider is the second tier (100 req/day
    // free), and NewsAPI remains the final fallback.
    if (!articles) {
      try {
        const newsDataSvc = await import('../src/news/NewsDataProvider.mjs')
        if (newsDataSvc.isConfigured()) {
          articles = await newsDataSvc.fetchTopHeadlines({ category })
        }
      } catch (e) { console.log('NewsData error:', e.message) }
    }

    if (!articles) {
      try {
        const rapidSvc = await import('../src/news/RapidNewsProvider.mjs')
        if (rapidSvc.isConfigured()) {
          articles = await rapidSvc.fetchTopHeadlines({ category })
          if (articles?.length) console.log(`[NEWS] RapidAPI "${category}" returned ${articles.length} articles`)
        }
      } catch (e) { console.log('RapidNews error:', e.message) }
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
        // Try the requested category first, then fall back through the reliable
        // NewsAPI categories. Never abort on a single empty/rate-limited result.
        const FALLBACK_ORDER = [category, 'business', 'technology', 'general', 'science', 'health', 'sports']
        const tried = new Set()
        for (const cat of FALLBACK_ORDER) {
          if (tried.has(cat)) continue
          tried.add(cat)
          preset = CATEGORY_QUERY[cat]
          try {
            if (preset) {
              if (preset[0] === 'search') {
                articles = await newsSvc.searchNews(preset[1], preset[2])
                if (!articles.length && preset[2].from) {
                  console.log(`[NEWS] ${cat}: empty date-filtered result, retrying without date range`)
                  const { from, to, ...rest } = preset[2]
                  articles = await newsSvc.searchNews(preset[1], rest)
                }
              } else {
                articles = await newsSvc.fetchTopHeadlines(preset[1])
              }
            } else {
              articles = await newsSvc.fetchTopHeadlines({ category: cat, pageSize: 3 })
            }
            if (articles?.length) {
              if (cat !== category) console.log(`[NEWS] category "${category}" empty — fell back to "${cat}" (${articles.length} articles)`)
              break
            }
            console.log(`[NEWS] ${cat}: no articles, trying next fallback`)
            articles = null
          } catch (e) {
            console.log(`[NEWS] ${cat} error: ${e.message}`)
            articles = null
          }
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
      const { engine, finalPath, retention, musicTrack, musicFamily } = await composeVideo([article], outDir)
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
          // Thumbnail preflight — explicit pipeline stage
          const { ThumbnailPreflight } = await import('../src/pipeline/ThumbnailPreflight.mjs')
          const coverPath = fs.existsSync('output/cover.png') ? 'output/cover.png' : null
          if (coverPath) {
            const thumbCheck = ThumbnailPreflight.validate({ path: coverPath, niche: engine?.productionContext?.niche?.key })
            if (thumbCheck.ready) {
              console.log(`[Thumbnail] preflight PASS: ${thumbCheck.meta.width}x${thumbCheck.meta.height}, ${(thumbCheck.meta.sizeBytes / 1024).toFixed(0)}KB`)
            } else {
              console.warn(`⚠️  ThumbnailPreflight: ${thumbCheck.errors.join('; ')} — uploading anyway`)
            }
          }

          // C2PA content credentials — sign thumbnail with provenance manifest
          // ProductionSigner validates certificate lifecycle before signing
          let c2paSignedPath = coverPath
          let c2paResult = { signed: false }
          let c2paVerifyResult = { valid: false }
          let c2paSignMs = null
          let c2paVerifyMs = null
          if (coverPath && process.env.C2PA_ENABLED !== 'false') {
            try {
              const { ProductionSigner } = await import('../src/pipeline/ProductionSigner.mjs')
              const { ContentCredentials } = await import('../src/pipeline/ContentCredentials.mjs')
              const signStart = Date.now()
              c2paResult = await ProductionSigner.sign({
                input: coverPath,
                article,
                productionContext: engine?.productionContext,
                productionTrace: engine?.productionTrace,
              })
              c2paSignMs = Date.now() - signStart
              if (c2paResult.signed) {
                c2paSignedPath = c2paResult.path
                console.log(`[C2PA] signed thumbnail: ${c2paResult.path} (${c2paSignMs}ms)`)
                // Verify after sign if enabled
                if (process.env.C2PA_VERIFY_AFTER_SIGN !== 'false') {
                  const verifyStart = Date.now()
                  c2paVerifyResult = await ContentCredentials.verify(c2paResult.path)
                  c2paVerifyMs = Date.now() - verifyStart
                  console.log(`[C2PA] verification: ${c2paVerifyResult.valid ? 'PASS' : 'FAIL'} (${c2paVerifyMs}ms, ${c2paVerifyResult.error || 'ok'})`)
                }
              }
              if (engine?.productionTrace) {
                engine.productionTrace.setProvenance({
                  signed: c2paResult.signed,
                  verified: c2paVerifyResult.valid,
                  manifestId: c2paResult.manifestId,
                  error: c2paResult.error || c2paVerifyResult.error || null,
                  signMs: c2paSignMs,
                  verifyMs: c2paVerifyMs,
                  reason: c2paResult.reason || null,
                  validationState: c2paVerifyResult.manifest?.validationState || null,
                  failures: c2paVerifyResult.manifest?.failures || [],
                })
              }
            } catch (e) {
              console.warn(`[C2PA] signing failed: ${e.message}`)
              c2paResult = { signed: false, error: e.message }
              if (engine?.productionTrace) {
                engine.productionTrace.setProvenance({ signed: false, verified: false, error: e.message })
              }
            }
          }

          // C2PA enforcement gate — block publish if C2PA_REQUIRED and conditions not met
          if (process.env.C2PA_REQUIRED === 'true') {
            const signOk = c2paResult.signed
            const verifyOk = c2paVerifyResult.valid || process.env.C2PA_VERIFY_AFTER_SIGN === 'false'
            if (!signOk || !verifyOk) {
              const gateReason = !signOk ? `signing failed: ${c2paResult.error || c2paResult.reason || 'unknown'}`
                : `verification failed: ${c2paVerifyResult.error || 'unknown'}`
              if (engine?.productionTrace) {
                engine.productionTrace.setProvenance({ gateBlocked: true, gateReason })
              }
              throw new Error(`C2PA required but ${gateReason} — blocking publish`)
            }
            if (engine?.productionTrace) {
              engine.productionTrace.setProvenance({ gateBlocked: false, gateReason: null })
            }
          }

          // Niche context — read from immutable production context (resolved once)
          const nicheDecision = engine?.productionContext?.niche || null
          if (nicheDecision) {
            console.log(`[Niche] ${nicheDecision.key} (confidence=${nicheDecision.confidence}, source=${nicheDecision.source})`)
          }

          const { publishVideo } = await import('../apps/api/publishers/youtube.js')
          const buffer = fs.readFileSync(finalPath)
          const title = `${article.title?.slice(0, 90) || 'News Update'} | NEWS-MONSTER`
          const { HashtagBuilder } = await import('../src/publishing/HashtagBuilder.mjs')
          const hashtags = HashtagBuilder.build({
            topic: HashtagBuilder.topicFromHeadline(article.title),
            category: category || nicheDecision?.key || 'tech',
            pipelineProfile: 'breaking',
            channel: 'NEWS-MONSTER',
          })
          const desc = `${title}\n\nSource: ${article.source || 'NewsAPI'}\n\n${hashtags}`
          const result = await publishVideo({
            videoUrl: `data:video/mp4;base64,${buffer.toString('base64')}`,
            title,
            description: desc,
            privacy: process.env.YOUTUBE_PRIVACY || 'public',
            thumbnailPath: c2paSignedPath,
            niche: nicheDecision?.key || null,
          })
          console.log(`[UPLOAD] videoId=${result.videoId} url=${result.url} niche=${result.niche || 'none'} thumbnail=${result.thumbnailUploaded ? 'uploaded' : result.lastError ? 'FAILED: ' + result.lastError : 'skipped'}`)

          // Record YouTube state in production trace
          if (engine?.productionTrace) {
            engine.productionTrace.setYouTube(result)
          }

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
              const body = `${title}\n\nSource: ${article.source || 'NewsAPI'}\n\n${hashtags}\n\nhttps://www.youtube.com/shorts/${result.videoId}`
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
              if (engine?.productionTrace) {
                engine.productionTrace.setLinkedIn({ attempted: true, success: false, error: e.message })
              }
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
              videoId: result.videoId,
              title: article.title || title,
              videoUrl: result.url,
              thumbnailPath: c2paSignedPath,
              category: category || nicheDecision?.key || 'technology',
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
          if (result.videoId) {
            try {
              const { PinnedCommentBuilder } = await import('../src/publishing/PinnedCommentBuilder.mjs')
              const { TopicCtaBuilder } = await import('../src/publishing/TopicCtaBuilder.mjs')
              const { postComment } = await import('../apps/api/publishers/youtube.js')
              const cta = new TopicCtaBuilder().build(article)
              const comment = new PinnedCommentBuilder().build(article)
              console.log(`[CTA] topic=${cta.topic} mode=${cta.mode} "${cta.narration}"`)
              console.log(`[PIN COMMENT] "${comment.question}"`)
              const posted = await postComment(result.videoId, comment.question)
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
          // RetentionPatternLearner (real analytics calibrate memory later).
          // Carry the chosen music track + family so the learner can correlate
          // "breaking-cinematic → +retention" and prefer winning underscores.
          if (result?.id && retention) {
            try {
              const { RetentionPatternLearner } = await import('../src/analytics/RetentionPatternLearner.mjs')
              new RetentionPatternLearner().appendSnapshot({
                videoId: result.id,
                title: article.title?.slice(0, 100),
                category: category || 'technology',
                musicTrack: musicTrack || null,
                musicFamily: musicFamily || null,
                retention,
              })
              console.log('Retention snapshot recorded for learning loop')
            } catch (e) { console.log('Retention snapshot skipped:', e.message) }
          }

          // Record production observation for feedback loop.
          // This feeds PerformanceMemory → RecommendationEngine → ProfileOptimizer.
          // The observation is a seed record — real analytics are joined later
          // by the YouTube Analytics poller.
          try {
            const { PerformanceObservation } = await import('../src/production/PerformanceObservation.mjs')
            const { PerformanceMemory } = await import('../src/production/PerformanceMemory.mjs')
            const obs = new PerformanceObservation({
              videoId: result.videoId,
              articleId: engine?.productionContext?.articleId || null,
              niche: nicheDecision?.key || 'GENERAL',
              publishedAt: new Date().toISOString(),
              analytics: {
                impressions: 0, // placeholder — YouTube Analytics poller fills this
                views: 0,
                avgViewDuration: retention?.avgViewDuration || 0,
                avgPercentViewed: retention?.avgPercentViewed || 0,
              },
            })
            const mem = new PerformanceMemory()
            mem.record(obs)
            mem.close()
            console.log(`[FEEDBACK] observation recorded: niche=${obs.niche} videoId=${obs.videoId}`)
          } catch (e) { console.log('[FEEDBACK] observation skipped:', e.message) }

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
