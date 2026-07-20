
import { execSync } from 'child_process'
import fs from 'fs'
import path from 'path'

export function getRandomMusic(dir='assets/music'){
  if(!fs.existsSync(dir)) return null
  const files=fs.readdirSync(dir).filter(f=>f.endsWith('.mp3')||f.endsWith('.wav'))
  if(!files.length) return null
  return path.join(dir, files[Math.floor(Math.random()*files.length)])
}

export function mixMusicWithVideo(videoIn, musicPath, duration, outPath){
  if(!musicPath || !fs.existsSync(musicPath)){
    console.log('No music found, copying video')
    fs.copyFileSync(videoIn, outPath)
    return outPath
  }
  // stereo, 18% volume, fade in/out, loudnorm -16 LUFS, amix
  const cmd = `ffmpeg -y -i "${videoIn}" -stream_loop -1 -i "${musicPath}" -filter_complex "[1:a]aformat=channel_layouts=stereo,volume=0.18,afade=t=in:st=0:d=1.2,afade=t=out:st=${duration-1.2}:d=1.2,loudnorm=I=-16:TP=-1.5:LRA=11[bg];[0:a]aformat=channel_layouts=stereo[orig];[orig][bg]amix=inputs=2:duration=longest:dropout_transition=2:normalize=0,pan=stereo|c0=c0|c1=c1[a]" -map 0:v -map "[a]" -c:v copy -c:a aac -b:a 192k -shortest "${outPath}"`
  console.log(cmd)
  execSync(cmd, {stdio:'inherit'})
  return outPath
}
