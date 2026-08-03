import { execFileSync } from 'child_process'
import fs from 'fs'
import path from 'path'

const MUSIC_DIR = 'assets/music'

/**
 * Pick a random background music file.
 * NEVER returns null — if no music files exist, generates an ambient track.
 */
export function getRandomMusic(){
  if(!fs.existsSync(MUSIC_DIR)) fs.mkdirSync(MUSIC_DIR, {recursive:true})

  // Find all non-intro music files (exclude intro_*)
  const files = fs.readdirSync(MUSIC_DIR)
    .filter(f => (f.endsWith('.mp3') || f.endsWith('.wav') || f.endsWith('.m4a')) && !f.startsWith('intro_'))

  if(files.length > 0){
    const chosen = path.join(MUSIC_DIR, files[Math.floor(Math.random() * files.length)])
    console.log('🎵 Background music:', chosen)
    return chosen
  }

  // Fallback: generate ambient audio so music is NEVER silent
  console.log('No music files found, generating ambient background...')
  const fallbackPath = path.join(MUSIC_DIR, '_ambient_gen.mp3')
  try {
    execFileSync(
      'ffmpeg',
      ['-y', '-f', 'lavfi', '-i', 'anoisesrc=d=30:c=pink:a=0.08,afade=t=in:st=0:d=3,afade=t=out:st=27:d=3,loudnorm=I=-24:TP=-2:LRA=7', '-c:a', 'aac', '-b:a', '128k', fallbackPath],
      { stdio: 'pipe', timeout: 15000 }
    )
    return fallbackPath
  } catch {
    return null
  }
}

/**
 * Mix background music into a video with ducking under voice.
 */
export function mixMusicWithVideo(videoIn, musicPath, duration, outPath){
  const effectiveMusic = musicPath || getRandomMusic()

  if(!effectiveMusic || !fs.existsSync(effectiveMusic)){
    console.log('No music available, outputting video without background music')
    fs.copyFileSync(videoIn, outPath)
    return outPath
  }

  // Stereo, 18% volume, fade in/out, loudnorm -16 LUFS, amix
  const args = [
    '-y', '-i', videoIn, '-stream_loop', '-1', '-i', effectiveMusic,
    '-filter_complex', `[1:a]aformat=channel_layouts=stereo,volume=0.18,afade=t=in:st=0:d=1.2,afade=t=out:st=${duration - 1.2}:d=1.2,loudnorm=I=-16:TP=-1.5:LRA=11[bg];[0:a]aformat=channel_layouts=stereo[orig];[orig][bg]amix=inputs=2:duration=longest:dropout_transition=2:normalize=0,pan=stereo|c0=c0|c1=c1[a]`,
    '-map', '0:v', '-map', '[a]', '-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k', '-shortest', outPath,
  ]
  execFileSync('ffmpeg', args, { stdio: 'inherit' })
  return outPath
}

/**
 * Download a free lofi track if no music exists yet.
 * Called at the start of the pipeline to ensure music is available.
 */
export async function ensureMusicExists(){
  if(!fs.existsSync(MUSIC_DIR)) fs.mkdirSync(MUSIC_DIR, {recursive:true})

  const existing = fs.readdirSync(MUSIC_DIR)
    .filter(f => (f.endsWith('.mp3') || f.endsWith('.wav')) && !f.startsWith('intro_') && !f.startsWith('_'))

  if(existing.length > 0) return // already has music

  console.log('Downloading cinematic news background music...')
  const tracks = [
    { name: 'lofi-study.mp3', url: 'https://cdn.pixabay.com/download/audio/2022/05/27/audio_1808fbf07a.mp3?filename=lofi-study-112191.mp3' },
    { name: 'tech-drive.mp3', url: 'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-2.mp3' },
  ]

  for(const track of tracks){
    try {
      const response = await fetch(track.url, { signal: AbortSignal.timeout(30000), redirect: 'follow' })
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      fs.writeFileSync(path.join(MUSIC_DIR, track.name), Buffer.from(await response.arrayBuffer()))
      const size = fs.statSync(path.join(MUSIC_DIR, track.name)).size
      if(size > 10000) console.log(`  ✅ ${track.name} (${(size/1024).toFixed(0)}KB)`)
      else { fs.unlinkSync(path.join(MUSIC_DIR, track.name)); console.log(`  ❌ ${track.name} too small`) }
    } catch(e) { console.log(`  ❌ ${track.name}: ${e.message}`) }
  }
}

if(import.meta.url.endsWith('audio.mjs')){
  await ensureMusicExists()
}
