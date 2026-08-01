import fs from 'fs'
import path from 'path'
import { execSync } from 'child_process'
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
    execSync(
      `ffmpeg -y -i "${finalPath}" -i "${footerPath}" -filter_complex ` +
      `"[0:v][1:v]overlay=0:main_h-overlay_h:format=auto,format=yuv420p[v]" -map "[v]" -map 0:a -c:a copy "${withFooter}"`,
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

    ensureMusicExists()

    let articles
    if (process.env.NEWSAPI_KEY) {
      try {
        const { fetchTopHeadlines } = await import('../apps/api/services/news.js')
        articles = await fetchTopHeadlines({ category, pageSize: 3 })
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
          console.log(`Published: https://youtu.be/${result?.id}`)

          // Snapshot the pipeline's retention prediction for the
          // RetentionPatternLearner (real analytics calibrate memory later)
          if (result?.id && retention) {
            try {
              const { RetentionPatternLearner } = await import('../src/analytics/RetentionPatternLearner.mjs')
              new RetentionPatternLearner().appendSnapshot({ videoId: result.id, title: article.title?.slice(0, 100), retention })
              console.log('Retention snapshot recorded for learning loop')
            } catch (e) { console.log('Retention snapshot skipped:', e.message) }
          }
        } catch (e) { console.log('Upload failed:', e.message) }
      }
    }

    console.log('\nNEWS-MONSTER Broadcast Pipeline Complete')
  }

  runFull().catch(e => {
    console.error('Fatal:', e.stack || e)
    process.exit(1)
  })
}
