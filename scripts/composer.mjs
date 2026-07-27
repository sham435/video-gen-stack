import { createCanvas, GlobalFonts } from '@napi-rs/canvas'
import fs from 'fs'
import path from 'path'
import { execSync } from 'child_process'
import { getRandomMusic, ensureMusicExists } from './audio.mjs'
import { generateTTS } from './tts.mjs'
import { fetchBestImage } from './pexels.mjs'
import { NewsBroadcastEngine } from '../src/index.mjs'

try{
  if(fs.existsSync('assets/fonts/Anton-Regular.ttf'))
    GlobalFonts.registerFromPath('assets/fonts/Anton-Regular.ttf','Anton')
}catch{}

const W=1080, H=1920

function drawHugeFrame(text, outPath){
  const canvas = createCanvas(W,H)
  const ctx = canvas.getContext('2d')
  ctx.fillStyle='#000'; ctx.fillRect(0,0,W,H)
  const fontSize = text.length > 14 ? 110 : 150
  ctx.font=`900 ${fontSize}px Anton, Impact`
  ctx.fillStyle='#FFF'; ctx.textAlign='center'; ctx.textBaseline='middle'
  ctx.save(); ctx.translate(W/2,H/2); ctx.transform(1,0,-0.2,1,0,0); ctx.scale(0.9,1)
  const words=text.split(' ')
  if(words.length>2){
    const mid=Math.ceil(words.length/2)
    ctx.fillText(words.slice(0,mid).join(' ').toUpperCase(),0,-60)
    ctx.fillText(words.slice(mid).join(' ').toUpperCase(),0,60)
  } else {
    ctx.fillText(text.toUpperCase(),0,0)
  }
  ctx.restore()
  fs.mkdirSync(path.dirname(outPath),{recursive:true})
  fs.writeFileSync(outPath, canvas.toBuffer('image/png'))
  return outPath
}

function splitHooks(title){
  const clean=title.replace(/[^a-zA-Z0-9 ]/g,' ').replace(/\s+/g,' ').trim()
  const w=clean.split(' ').filter(x=>x.length>2)
  const hooks=[]
  if(w.length>=2) hooks.push(w.slice(0,2).join(' '))
  if(w.length>=4) hooks.push(w.slice(2,4).join(' '))
  if(w.length>=6) hooks.push(w.slice(4,6).join(' ')||'BREAKING')
  if(hooks.length<2) hooks.push('BREAKING NEWS')
  return hooks.slice(0,3)
}

export async function composeVideo(articles, outDir='output'){
  fs.mkdirSync(outDir,{recursive:true})
  const article=articles[0]
  if(!article)throw new Error('No articles')

  if(!article.imageUrl){
    await fetchBestImage(article)
  }

  const broadcastEngine = new NewsBroadcastEngine()
  const broadcastPath = await broadcastEngine.generateFromArticle(article, outDir)

  const hooks=splitHooks(article.title)
  console.log('Hooks:', hooks)

  const introPath=`${outDir}/intro_12s.mp4`
  const finalPath=`${outDir}/final.mp4`
  if(fs.existsSync(introPath)){
    execSync(`ffmpeg -y -i "${introPath}" -i "${broadcastPath}" -filter_complex "[0:v]scale=1080:1920:force_original_aspect_ratio=decrease,pad=1080:1920:(ow-iw)/2:(oh-ih)/2:color=black[v0];[1:v]scale=1080:1920:force_original_aspect_ratio=decrease,pad=1080:1920:(ow-iw)/2:(oh-ih)/2:color=black[v1];[v0][0:a][v1][1:a]concat=n=2:v=1:a=1[v][a]" -map "[v]" -map "[a]" -c:v libx264 -c:a aac "${finalPath}"`, {stdio:'inherit'})
  } else {
    fs.copyFileSync(broadcastPath, finalPath)
  }

  console.log('Final broadcast:', finalPath)

  const footerPath = 'assets/footer.png'
  if(fs.existsSync(footerPath)){
    const withFooter = `${outDir}/final_with_footer.mp4`
    execSync(`ffmpeg -y -i "${finalPath}" -i "${footerPath}" -filter_complex "[0:v][1:v]overlay=0:main_h-overlay_h:format=auto,format=yuv420p[v]" -map "[v]" -map 0:a -c:a copy "${withFooter}"`, {stdio:'inherit'})
    fs.copyFileSync(withFooter, finalPath)
    console.log('Footer taskbar overlaid')
  }

  return {finalPath, hooks}
}

if(import.meta.url.endsWith('composer.mjs')){
  const runFull = async () => {
    const category = process.env.INPUT_CATEGORY || process.argv[2] || 'technology'
    const outDir = 'output'
    fs.mkdirSync(outDir, {recursive:true})

    let v3 = { pipeline: null, completeRender: null, queuePublishJob: null }
    try {
      const mod = await import('../packages/editorial/pipeline.mjs')
      v3 = { pipeline: mod.runFullPipeline, completeRender: mod.completeRender, queuePublishJob: mod.queuePublishJob }
      console.log('V3 Newsroom database initialized')
    } catch(e) {
      console.log('V3 Newsroom DB unavailable:', e.message.split('\n')[0])
    }

    ensureMusicExists()

    console.log('Generating intro...')
    const { generateCommonIntro } = await import('./intro.mjs')
    const introPath = generateCommonIntro(outDir)

    let articles
    if (process.env.NEWSAPI_KEY) {
      try {
        const { fetchTopHeadlines } = await import('../apps/api/services/news.js')
        articles = await fetchTopHeadlines({ category, pageSize: 3 })
      } catch(e) { console.log('NewsAPI error:', e.message) }
    }
    if (!articles?.length) {
      articles = [{title: process.argv[2] || 'Apple releases groundbreaking AI model that changes everything', url: '', source: 'Tech News'}]
    }

    let uploadCount = 0
    for (const rawArticle of articles) {
      const article = {
        title: rawArticle.title,
        description: rawArticle.description || '',
        source: rawArticle.source?.name || rawArticle.source || 'NewsAPI',
        url: rawArticle.url || '',
        imageUrl: rawArticle.imageUrl || rawArticle.urlToImage || null,
        category: rawArticle.category || category,
        publishedAt: rawArticle.publishedAt || new Date().toISOString(),
      }

      console.log(`\nProcessing: "${article.title?.slice(0, 80)}..."`)

      let projectId = null, renderJobId = null
      if (v3.pipeline) {
        try {
          const p = await v3.pipeline(article, { mode: 'auto', publish: false })
          if (p?.skipped) { console.log('Skipping (duplicate)'); continue }
          projectId = p?.projectId
          renderJobId = p?.renderJobId
        } catch(e) { console.log('V3 pipeline skipped:', e.message?.slice(0, 80)) }
      }

      console.log('Composing broadcast news video...')
      const renderStart = Date.now()
      const { finalPath, hooks } = await composeVideo([article], outDir)

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
          const result = await uploadShort(`data:video/mp4;base64,${buffer.toString('base64')}`, title, desc, process.env.YOUTUBE_PRIVACY || 'public')
          console.log(`Published: https://youtu.be/${result?.id}`)
        } catch(e) { console.log('Upload failed:', e.message) }
      }
    }

    console.log('\nTECH-MONSTER Broadcast Pipeline Complete')
  }
  runFull().catch(e => { console.error('Fatal:', e.stack || e); process.exit(1) })
}
