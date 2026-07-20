
import { createCanvas, GlobalFonts } from '@napi-rs/canvas'
import fs from 'fs'
import path from 'path'
import { execSync } from 'child_process'
import { getRandomMusic } from './audio.mjs'
import { generateTTS, buildNarrationScript } from './tts.mjs'
import ogs from 'open-graph-scraper'

try{
  if(fs.existsSync('assets/fonts/Anton-Regular.ttf')) GlobalFonts.registerFromPath('assets/fonts/Anton-Regular.ttf','Anton')
  if(fs.existsSync('assets/fonts/Inter-Black.ttf')) GlobalFonts.registerFromPath('assets/fonts/Inter-Black.ttf','InterBlack')
}catch{}

const W=1080, H=1920

function drawHugeFrame(text, outPath, accent='#FFFFFF'){
  const canvas = createCanvas(W,H)
  const ctx = canvas.getContext('2d')
  ctx.fillStyle='#000000'
  ctx.fillRect(0,0,W,H)

  const len = text.length
  const fontSize = len > 18 ? 110 : len > 12 ? 135 : 165
  ctx.font = `900 ${fontSize}px Anton, InterBlack, Impact, sans-serif`
  ctx.fillStyle=accent
  ctx.textAlign='center'
  ctx.textBaseline='middle'

  ctx.save()
  ctx.translate(W/2, H/2)
  ctx.transform(1, 0, -0.20, 1, 0, 0)
  ctx.scale(0.9, 1)
  // word wrap for 2 lines if needed
  const words = text.split(' ')
  if(words.length>2 && len>14){
    const mid = Math.ceil(words.length/2)
    const line1 = words.slice(0,mid).join(' ')
    const line2 = words.slice(mid).join(' ')
    ctx.fillText(line1.toUpperCase(), 0, -fontSize*0.6)
    ctx.fillText(line2.toUpperCase(), 0, fontSize*0.6)
  }else{
    ctx.fillText(text.toUpperCase(), 0, 0)
  }
  ctx.restore()

  fs.mkdirSync(path.dirname(outPath), {recursive:true})
  fs.writeFileSync(outPath, canvas.toBuffer('image/png'))
  return outPath
}

function splitIntoHooks(title){
  // Turn "iOS 27 vs iOS 26: How Apple Is Completely Replacing Siri" -> ["iOS 27", "REPLACING SIRI", "ACTUALLY SEE"]
  const clean = title.replace(/[^a-zA-Z0-9 ]/g,' ').replace(/\s+/g,' ').trim()
  const words = clean.split(' ').filter(w=>w.length>2)
  const hooks = []
  if(words.length>=2) hooks.push(words.slice(0,2).join(' '))
  if(words.length>=4) hooks.push(words.slice(2,4).join(' '))
  if(words.length>=6) hooks.push(words.slice(4,6).join(' ').toUpperCase() || 'ACTUALLY SEE')
  if(hooks.length<3) hooks.push('BREAKING NEWS')
  return hooks.slice(0,4)
}

async function getOg(url){
  try{
    const {result}=await ogs({url, timeout:8000, headers:{'user-agent':'Mozilla/5.0'}})
    return {image: result.ogImage?.[0]?.url || null, desc: result.ogDescription || ''}
  }catch{return {image:null, desc:''}}
}

export async function composeVideo(articles, outDir='output'){
  fs.mkdirSync(outDir, {recursive:true})
  const article = articles[0]
  if(!article) throw new Error('No articles')

  if(!article.imageUrl && article.url){
    const og = await getOg(article.url)
    article.imageUrl = og.image
    article.summary = og.desc
  }

  // 1. Create HUGE text frames like you asked
  const hooks = splitIntoHooks(article.title)
  console.log('Hooks:', hooks)
  const frameDir = `${outDir}/frames`
  fs.mkdirSync(frameDir, {recursive:true})
  const frames = hooks.map((h,i)=> drawHugeFrame(h, `${frameDir}/f${String(i).padStart(2,'0')}.png`, i===0?'#FFFFFF':'#FFFFFF'))

  // 2. Also create image frame if OG exists
  if(article.imageUrl){
    const imgFrame = `${frameDir}/img.png`
    // download and render with blur bg
    try{
      const res = await fetch(article.imageUrl)
      const buf = Buffer.from(await res.arrayBuffer())
      fs.writeFileSync(`${outDir}/og.jpg`, buf)
      // render mixed frame
      const {createCanvas: CC, loadImage} = await import('@napi-rs/canvas')
      const canvas=CC(W,H); const ctx=canvas.getContext('2d')
      const img=await loadImage(`${outDir}/og.jpg`)
      ctx.drawImage(img,0,0,W,H)
      ctx.fillStyle='rgba(0,0,0,0.55)'; ctx.fillRect(0,0,W,H)
      ctx.font=`900 90px Anton, Impact`; ctx.fillStyle='#FFF'; ctx.textAlign='center'
      ctx.save(); ctx.translate(W/2,H/2); ctx.transform(1,0,-0.15,1,0,0)
      const lines = article.title.match(/.{1,18}(\s|$)/g) || [article.title]
      lines.slice(0,3).forEach((l,li)=> ctx.fillText(l.toUpperCase(),0,(li-1)*100))
      ctx.restore()
      fs.writeFileSync(imgFrame, canvas.toBuffer('image/png'))
      frames.push(imgFrame)
    }catch{}
  }

  // 3. TTS
  const script = `${hooks.join('. ')}. ${article.title}. According to ${article.source||'Tech News'}.`
  const voicePath = `${outDir}/voice.mp3`
  await generateTTS(script, voicePath)
  const voiceDur = parseFloat(execSync(`ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${voicePath}"`).toString()||'12')
  const totalDur = Math.max(15, Math.min(30, Math.ceil(voiceDur+1)))

  // 4. Build video from frames: each frame ~ totalDur/frames.length sec
  const listPath = `${outDir}/list.txt`
  const perFrame = totalDur / frames.length
  let listContent=''
  for(const f of frames){ listContent += `file '${path.resolve(f)}'\nduration ${perFrame}\n` }
  listContent += `file '${path.resolve(frames[frames.length-1])}'\n`
  fs.writeFileSync(listPath, listContent)

  const silentVideo = `${outDir}/silent.mp4`
  execSync(`ffmpeg -y -f concat -safe 0 -i "${listPath}" -vf "scale=1080:1920:force_original_aspect_ratio=decrease,pad=1080:1920:(ow-iw)/2:(oh-ih)/2,format=yuv420p,fps=30,zoompan=z='min(zoom+0.0008,1.08)':d=1:x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)'" -pix_fmt yuv420p "${silentVideo}"`, {stdio:'inherit'})

  // 5. Mix music ducked + voice
  const musicPath = getRandomMusic()
  const finalPath = `${outDir}/final.mp4`
  if(musicPath){
    execSync(`ffmpeg -y -i "${silentVideo}" -i "${voicePath}" -stream_loop -1 -i "${musicPath}" -filter_complex "[2:a]aformat=channel_layouts=stereo,volume=0.15,loudnorm=I=-20[bg];[1:a]aformat=channel_layouts=stereo,loudnorm=I=-16[voice];[bg][voice]sidechaincompress=threshold=0.03:ratio=10:attack=200:release=400[ducked];[voice][ducked]amix=inputs=2:duration=longest:dropout_transition=0[a]" -map 0:v -map "[a]" -c:v libx264 -c:a aac -b:a 192k -t ${totalDur} "${finalPath}"`, {stdio:'inherit'})
  }else{
    execSync(`ffmpeg -y -i "${silentVideo}" -i "${voicePath}" -c:v copy -c:a aac -t ${totalDur} "${finalPath}"`, {stdio:'inherit'})
  }

  console.log('✅ Final HUGE text video:', finalPath)
  return {finalPath, hooks, script}
}

if(import.meta.url.endsWith('composer.mjs')){
  composeVideo([{title: process.argv[2]||'Actually See How Apple Is Replacing Siri With iOS 27', url:'', source:'Geeky Gadgets'}])
}
