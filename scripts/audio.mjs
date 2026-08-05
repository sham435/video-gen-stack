import { execFileSync } from 'child_process'
import fs from 'fs'
import path from 'path'

const MUSIC_DIR = 'assets/music'

/**
 * Pick the background music file for a video. Deterministic: hash the seed
 * (article title) → index into the original 48-track collection, so each
 * video uses a different track from the loop.
 */
export function getRandomMusic(seed){
  if(!fs.existsSync(MUSIC_DIR)) fs.mkdirSync(MUSIC_DIR, {recursive:true})

  const files = fs.readdirSync(MUSIC_DIR)
    .filter(f => (f.endsWith('.mp3') || f.endsWith('.wav') || f.endsWith('.m4a')) && !f.startsWith('intro_') && f.startsWith('nm-track-'))
    .sort()

  if(files.length > 0){
    const s = String(seed || '')
    let h = 0
    for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0
    const chosen = path.join(MUSIC_DIR, files[h % files.length])
    console.log('🎵 Background music:', chosen, seed ? `(seed "${String(seed).slice(0, 40)}")` : '')
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
export function mixMusicWithVideo(videoIn, musicPath, duration, outPath, seed){
  const effectiveMusic = musicPath || getRandomMusic(seed)

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
 * Ensure the original 48-track music collection exists. NEVER from stock
 * downloads — the Pixabay lofi track got content-ID claimed (HAAWK/FASSounds).
 */
export async function ensureMusicExists(){
  if(!fs.existsSync(MUSIC_DIR)) fs.mkdirSync(MUSIC_DIR, {recursive:true})

  const tracks = fs.readdirSync(MUSIC_DIR).filter(f => f.startsWith('nm-track-') && f.endsWith('.mp3'))
  const target = parseInt(process.env.MUSIC_TRACK_COUNT || '48', 10)
  if(tracks.length >= target) return

  console.log('Generating original NEWS-MONSTER music collection...')
  try {
    execFileSync('node', ['scripts/gen-music.mjs', String(target)], { cwd: process.cwd(), stdio: 'inherit', timeout: 600000 })
  } catch(e) {
    console.log(`  ❌ music generation failed: ${e.message}`)
  }
}

if(import.meta.url.endsWith('audio.mjs')){
  await ensureMusicExists()
}
