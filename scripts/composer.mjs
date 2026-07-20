
import { renderFrame } from './render.mjs'
import { getRandomMusic } from './audio.mjs'
import { generateTTS, buildNarrationScript } from './tts.mjs'
import { execSync } from 'child_process'
import fs from 'fs'
import path from 'path'
import ogs from 'open-graph-scraper'

async function getOgImage(url){
  try{
    const {result} = await ogs({url, timeout:8000, headers:{'user-agent':'Mozilla/5.0'}})
    return { image: result.ogImage?.[0]?.url || null, desc: result.ogDescription || result.description || '' }
  }catch{ return {image:null, desc:''} }
}

export async function composeVideo(articles, outDir='output'){
  fs.mkdirSync(outDir, {recursive:true})
  const article = articles[0]
  if(!article) throw new Error('No articles')

  if(!article.imageUrl && article.url){
    const og = await getOgImage(article.url)
    article.imageUrl = og.image
    article.summary = og.desc
  }
  article.source = article.source || 'Tech News'

  const framePath = path.join(outDir, 'frame.png')
  await renderFrame(article, framePath)

  // 1. Generate TTS
  const script = buildNarrationScript(article)
  console.log('Script:', script)
  const voicePath = path.join(outDir, 'voice.mp3')
  await generateTTS(script, voicePath)

  const voiceDuration = parseFloat(execSync(`ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${voicePath}"`).toString()||'10')
  const duration = Math.max(18, Math.min(28, Math.ceil(voiceDuration+2)))

  // 2. Base silent video with Ken Burns
  const silentVideo = path.join(outDir, 'silent.mp4')
  const zoomCmd = `ffmpeg -y -loop 1 -i "${framePath}" -f lavfi -i anullsrc=channel_layout=stereo:sample_rate=48000 -filter_complex "[0:v]scale=1920:1080,zoompan=z='min(zoom+0.0012,1.25)':d=1:x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)',fps=30,format=yuv420p[v]" -map "[v]" -map 1:a -c:v libx264 -pix_fmt yuv420p -c:a aac -t ${duration} -shortest "${silentVideo}"`
  execSync(zoomCmd, {stdio:'inherit'})

  // 3. Mix: voice + music ducked when voice speaks
  const musicPath = getRandomMusic()
  const finalPath = path.join(outDir, 'final.mp4')
  
  if(musicPath){
    // duck music under voice: sidechaincompressor
    const mixCmd = `ffmpeg -y -i "${silentVideo}" -i "${voicePath}" -stream_loop -1 -i "${musicPath}" -filter_complex "[2:a]aformat=channel_layouts=stereo,volume=0.14,loudnorm=I=-20:TP=-1.5:LRA=11[bg];[1:a]aformat=channel_layouts=stereo,loudnorm=I=-16:TP=-1.5:LRA=11[voice];[bg][voice]sidechaincompress=threshold=0.04:ratio=8:attack=200:release=500[ducked];[voice][ducked]amix=inputs=2:duration=longest:dropout_transition=0:normalize=0,afade=t=in:st=0:d=0.3,afade=t=out:st=${duration-0.8}:d=0.8[a]" -map 0:v -map "[a]" -c:v copy -c:a aac -b:a 192k -t ${duration} "${finalPath}"`
    execSync(mixCmd, {stdio:'inherit'})
  } else {
    const mixCmd = `ffmpeg -y -i "${silentVideo}" -i "${voicePath}" -filter_complex "[1:a]aformat=channel_layouts=stereo,loudnorm=I=-16:TP=-1.5:LRA=11[a]" -map 0:v -map "[a]" -c:v copy -c:a aac -b:a 192k -t ${duration} "${finalPath}"`
    execSync(mixCmd, {stdio:'inherit'})
  }

  console.log('✅ Final with TTS+Music:', finalPath)
  return { finalPath, article, script }
}

if(import.meta.url.endsWith('composer.mjs')){
  const mock = [{title: process.argv[2]||'iOS 26 vs iOS 27: How Apple Is Completely Replacing Siri With Next-Gen AI', url:'https://www.geeky-gadgets.com/ios-27-siri-replacement/', source:'Geeky Gadgets'}]
  composeVideo(mock)
}
