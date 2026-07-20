import { createCanvas, GlobalFonts } from '@napi-rs/canvas'
import fs from 'fs'
import path from 'path'
import { execSync } from 'child_process'
import { getRandomMusic } from './audio.mjs'
import { generateTTS } from './tts.mjs'
import ogs from 'open-graph-scraper'

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

async function getOg(url){
  try{const {result}=await ogs({url, timeout:8000, headers:{'user-agent':'Mozilla/5.0'}}); return {image:result.ogImage?.[0]?.url||null, desc:result.ogDescription||''}}catch{return {image:null,desc:''}}
}

export async function composeVideo(articles, outDir='output'){
  fs.mkdirSync(outDir,{recursive:true})
  const article=articles[0]
  if(!article)throw new Error('No articles')
  if(!article.imageUrl && article.url){const og=await getOg(article.url); article.imageUrl=og.image; article.summary=og.desc}

  const hooks=splitHooks(article.title)
  console.log('Hooks:', hooks)
  const frameDir=`${outDir}/frames`; fs.mkdirSync(frameDir,{recursive:true})
  const frames=hooks.map((h,i)=>drawHugeFrame(h, `${frameDir}/f${String(i).padStart(2,'0')}.png`))

  const script=`${hooks.join('. ')}. ${article.title}.`
  const voicePath=`${outDir}/voice.mp3`
  await generateTTS(script, voicePath)
  let voiceDur=13
  try{voiceDur=parseFloat(execSync(`ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${voicePath}"`).toString())}catch{}
  const totalDur=Math.max(15, Math.min(22, Math.ceil(voiceDur+2)))

  const listPath=`${outDir}/list.txt`
  const perFrame=totalDur/frames.length
  let listContent=''
  for(const f of frames){listContent+=`file '${path.resolve(f)}'\nduration ${perFrame}\n`}
  listContent+=`file '${path.resolve(frames[frames.length-1])}'\n`
  fs.writeFileSync(listPath, listContent)

  const silentVideo=`${outDir}/silent.mp4`
  execSync(`ffmpeg -y -f concat -safe 0 -i "${listPath}" -vf "scale=1080:1920:force_original_aspect_ratio=decrease,pad=1080:1920:(ow-iw)/2:(oh-ih)/2,format=yuv420p,fps=30" -pix_fmt yuv420p "${silentVideo}"`, {stdio:'inherit'})

  const musicPath=getRandomMusic()||'assets/music/intro_whoosh.mp3'
  const finalNoIntro=`${outDir}/final_no_intro.mp4`

  if(musicPath && fs.existsSync(musicPath)){
    execSync(`ffmpeg -y -i "${silentVideo}" -i "${voicePath}" -stream_loop -1 -i "${musicPath}" -filter_complex "[2:a]aformat=channel_layouts=stereo,volume=0.12,apad[bg];[1:a]aformat=channel_layouts=stereo,volume=1.2,apad[voice];[voice][bg]amix=inputs=2:duration=longest:dropout_transition=0:normalize=0[a]" -map 0:v -map "[a]" -c:v libx264 -c:a aac -b:a 192k -t ${totalDur} "${finalNoIntro}"`, {stdio:'inherit'})
  } else {
    execSync(`ffmpeg -y -i "${silentVideo}" -i "${voicePath}" -map 0:v -map 1:a -c:v copy -c:a aac -t ${totalDur} "${finalNoIntro}"`, {stdio:'inherit'})
  }

  const introPath=`${outDir}/intro_12s.mp4`
  const finalPath=`${outDir}/final.mp4`
  if(fs.existsSync(introPath)){
    execSync(`ffmpeg -y -i "${introPath}" -i "${finalNoIntro}" -filter_complex "[0:v]scale=1080:1920:force_original_aspect_ratio=decrease,pad=1080:1920:(ow-iw)/2:(oh-ih)/2:color=black[v0];[1:v]scale=1080:1920:force_original_aspect_ratio=decrease,pad=1080:1920:(ow-iw)/2:(oh-ih)/2:color=black[v1];[v0][0:a][v1][1:a]concat=n=2:v=1:a=1[v][a]" -map "[v]" -map "[a]" -c:v libx264 -c:a aac "${finalPath}"`, {stdio:'inherit'})
  } else {
    fs.copyFileSync(finalNoIntro, finalPath)
  }

  console.log('✅ Final with intro:', finalPath)
  return {finalPath, hooks}
}

// CLI / GitHub Actions pipeline
if(import.meta.url.endsWith('composer.mjs')){
  const runFull = async () => {
    const category = process.env.INPUT_CATEGORY || process.argv[2] || 'technology'
    const outDir = 'output'
    fs.mkdirSync(outDir, {recursive:true})

    // 1. Generate 12s intro only once
    console.log('Generating intro...')
    const { generateCommonIntro } = await import('./intro.mjs')
    const introPath = generateCommonIntro(outDir)

    // 2. Fetch news
    let articles
    if (process.env.NEWSAPI_KEY) {
      try {
        const { fetchTopHeadlines } = await import('../apps/api/services/news.js')
        articles = await fetchTopHeadlines({ category, pageSize: 3 })
      } catch(e) { console.log('NewsAPI error:', e.message) }
    }
    if (!articles?.length) {
      articles = [{title: process.argv[2] || 'Actually See How Apple Is Replacing Siri', url: '', source: 'Tech News'}]
    }

    // 3. Compose news video (uses intro_12s.mp4 if exists)
    console.log('Composing news video...')
    const { finalPath } = await composeVideo(articles, outDir)

    // 4. Upload to YouTube
    if (process.env.YOUTUBE_REFRESH_TOKEN) {
      console.log('Uploading to YouTube...')
      try {
        const { uploadShort } = await import('../apps/api/publishers/youtube.js')
        const buffer = fs.readFileSync(finalPath)
        const title = `${articles[0]?.title?.slice(0, 90) || 'News Update'}`
        const desc = `${title}\n\nSource: ${articles[0]?.source || 'NewsAPI'}\n\n#tech #news`
        const result = await uploadShort(`data:video/mp4;base64,${buffer.toString('base64')}`, title, desc, process.env.YOUTUBE_PRIVACY || 'public')
        console.log(`✅ Published: https://youtu.be/${result?.id}`)
      } catch(e) { console.log('Upload failed:', e.message) }
    }
  }
  runFull().catch(e => { console.error('❌', e.stack || e); process.exit(1) })
}
