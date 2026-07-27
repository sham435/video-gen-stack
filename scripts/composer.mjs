import { createCanvas, GlobalFonts } from '@napi-rs/canvas'
import fs from 'fs'
import path from 'path'
import { execSync } from 'child_process'
import { getRandomMusic, ensureMusicExists } from './audio.mjs'
import { generateTTS } from './tts.mjs'
import { fetchBestImage } from './pexels.mjs'
import { NewsBroadcastEngine } from '../src/index.mjs'
import { Renderer } from '../src/video/Renderer.mjs'

try {
  if (fs.existsSync('assets/fonts/Anton-Regular.ttf'))
    GlobalFonts.registerFromPath('assets/fonts/Anton-Regular.ttf', 'Anton')
  if (fs.existsSync('assets/fonts/Inter-Black.ttf'))
    GlobalFonts.registerFromPath('assets/fonts/Inter-Black.ttf', 'InterBlack')
} catch {}

const renderer = new Renderer()

function splitHooks(title) {
  return renderer.hookify(title)
}

export async function composeVideo(articles, outDir = 'output') {
  fs.mkdirSync(outDir, { recursive: true })
  const article = articles[0]
  if (!article) throw new Error('No articles')

  if (!article.imageUrl) {
    await fetchBestImage(article)
  }

  const hooks = splitHooks(article.title)
  console.log('Hooks:', hooks)

  const broadcastEngine = new NewsBroadcastEngine()
  const broadcastPath = await broadcastEngine.generateFromArticle(article, outDir)

  const introPath = `${outDir}/intro_12s.mp4`
  const finalPath = `${outDir}/final.mp4`

  if (fs.existsSync(introPath)) {
    execSync(
      `ffmpeg -y -i "${introPath}" -i "${broadcastPath}" -filter_complex ` +
      `"[0:v]scale=1080:1920:force_original_aspect_ratio=decrease,pad=1080:1920:(ow-iw)/2:(oh-ih)/2:color=black[v0];` +
      `[1:v]scale=1080:1920:force_original_aspect_ratio=decrease,pad=1080:1920:(ow-iw)/2:(oh-ih)/2:color=black[v1];` +
      `[v0][0:a][v1][1:a]concat=n=2:v=1:a=1[v][a]" -map "[v]" -map "[a]" -c:v libx264 -c:a aac "${finalPath}"`,
      { stdio: 'inherit' }
    )
  } else {
    fs.copyFileSync(broadcastPath, finalPath)
  }

  console.log('Final broadcast:', finalPath)

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

  return { finalPath, hooks }
}

if (import.meta.url.endsWith('composer.mjs')) {
  const runFull = async () => {
    const category = process.env.INPUT_CATEGORY || process.argv[2] || 'technology'
    const outDir = 'output'
    fs.mkdirSync(outDir, { recursive: true })

    let v3 = { pipeline: null, completeRender: null, queuePublishJob: null }
    try {
      const mod = await import('../packages/editorial/pipeline.mjs')
      v3 = {
        pipeline: mod.runFullPipeline,
        completeRender: mod.completeRender,
        queuePublishJob: mod.queuePublishJob,
      }
      console.log('V3 Newsroom database initialized')
    } catch (e) {
      console.log('V3 Newsroom DB unavailable:', e.message?.split('\n')[0] || e.message)
    }

    ensureMusicExists()

    console.log('Generating intro...')
    const { generateCommonIntro } = await import('./intro.mjs')
    generateCommonIntro(outDir)

    let articles
    if (process.env.NEWSAPI_KEY) {
      try {
        const { fetchTopHeadlines } = await import('../apps/api/services/news.js')
        articles = await fetchTopHeadlines({ category, pageSize: 3 })
      } catch (e) { console.log('NewsAPI error:', e.message) }
    }

    if (!articles?.length) {
      articles = [{
        title: process.argv[2] || 'Apple releases groundbreaking AI model that changes everything',
        description: process.argv[3] || 'Apple has announced a revolutionary new AI model that can process images, video, and text simultaneously. The model is ten times faster than the previous version.',
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

      let projectId = null
      let renderJobId = null
      if (v3.pipeline) {
        try {
          const p = await v3.pipeline(article, { mode: 'auto', publish: false })
          if (p?.skipped) { console.log('Skipping (duplicate)'); continue }
          projectId = p?.projectId
          renderJobId = p?.renderJobId
        } catch (e) { console.log('V3 pipeline skipped:', e.message?.slice(0, 80)) }
      }

      console.log('Composing broadcast news video...')
      const renderStart = Date.now()
      const { finalPath } = await composeVideo([article], outDir)

      const renderTime = Date.now() - renderStart
      if (v3.completeRender && projectId && renderJobId) {
        try { await v3.completeRender(projectId, renderJobId, finalPath, renderTime) } catch {}
      }

      if (process.env.YOUTUBE_REFRESH_TOKEN && uploadCount === 0) {
        uploadCount++
        if (v3.queuePublishJob && projectId && renderJobId) {
          try { v3.queuePublishJob(projectId, renderJobId, { mode: 'auto', privacy: process.env.YOUTUBE_PRIVACY || 'public' }) } catch {}
        }

        console.log('Uploading to YouTube...')
        try {
          const { uploadShort } = await import('../apps/api/publishers/youtube.js')
          const buffer = fs.readFileSync(finalPath)
          const title = `${article.title?.slice(0, 90) || 'News Update'} | TECH-MONSTER`
          const desc = `${title}\n\nSource: ${article.source || 'NewsAPI'}\n\n#tech #news #breaking #ai #TECHMONSTER`
          const result = await uploadShort(
            `data:video/mp4;base64,${buffer.toString('base64')}`,
            title, desc,
            process.env.YOUTUBE_PRIVACY || 'public'
          )
          console.log(`Published: https://youtu.be/${result?.id}`)
        } catch (e) { console.log('Upload failed:', e.message) }
      }
    }

    console.log('\n TECH-MONSTER Broadcast Pipeline Complete')
  }

  runFull().catch(e => {
    console.error('Fatal:', e.stack || e)
    process.exit(1)
  })
}
