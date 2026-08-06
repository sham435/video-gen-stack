import { execFileSync } from 'child_process'
import fs from 'fs'
import path from 'path'
import { pickMusicTrack, resolveMusicFamily, trackIndexFor } from './MusicFamily.mjs'

const MUSIC_DIR = 'assets/music'

// 48-track original cinematic collection (scripts/gen-music.mjs). Every video
// picks a DIFFERENT track inside a mood-matched family: deterministic hash of
// the article title → track index, so a story always keeps its music and
// consecutive uploads rotate through the loop instead of randomly repeating.
export { trackIndexFor }

export class AudioMixer {
  constructor() {
    this.musicSeed = null
    this.musicFamily = 'cinematic-tech-reveal'
    this.lastTrack = null
    fs.mkdirSync(MUSIC_DIR, { recursive: true })
  }

  /** Bind the article to the mixer: title seeds the track, mood maps the family. */
  setMusicContext(article) {
    this.musicSeed = article?.title || null
    this.musicFamily = article ? resolveMusicFamily(article) : 'cinematic-tech-reveal'
    return this.musicFamily
  }

  getRandomMusic() {
    if (!fs.existsSync(MUSIC_DIR)) fs.mkdirSync(MUSIC_DIR, { recursive: true })

    if (this.musicSeed) {
      const pick = pickMusicTrack({ title: this.musicSeed }, { family: this.musicFamily, verbose: true })
      if (pick) { this.lastTrack = pick; return pick.file }
    }

    const files = fs.readdirSync(MUSIC_DIR)
      .filter(f => (f.endsWith('.mp3') || f.endsWith('.wav') || f.endsWith('.m4a')) && !f.startsWith('intro_') && f.startsWith('nm-track-'))
      .sort()

    if (files.length > 0) {
      const idx = trackIndexFor(this.musicSeed, files.length)
      const chosen = path.join(MUSIC_DIR, files[idx])
      console.log(`🎵 Music track ${idx + 1}/${files.length}: ${chosen} ${this.musicSeed ? `(for "${String(this.musicSeed).slice(0, 40)}")` : ''}`)
      return chosen
    }

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

  async ensureMusicExists() {
    if (!fs.existsSync(MUSIC_DIR)) fs.mkdirSync(MUSIC_DIR, { recursive: true })

    const tracks = fs.readdirSync(MUSIC_DIR).filter(f => f.startsWith('nm-track-') && f.endsWith('.mp3'))
    const target = parseInt(process.env.MUSIC_TRACK_COUNT || '48', 10)
    if (tracks.length >= target) return

    // NEVER download stock music — the Pixabay lofi track got content-ID
    // claimed (HAAWK/FASSounds). Generate the original in-house collection.
    console.log(`Generating original NEWS-MONSTER music collection (${target} tracks)...`)
    try {
      execFileSync('node', ['scripts/gen-music.mjs', String(target)], { cwd: process.cwd(), stdio: 'inherit', timeout: 600000 })
    } catch (e) {
      console.log(`  Music generation failed: ${e.message}`)
    }
  }

  mixAudio(videoPath, voicePath, musicPath, totalDuration, outPath) {
    const effectiveMusic = musicPath || this.getRandomMusic()

    if (effectiveMusic && fs.existsSync(effectiveMusic)) {
      const cmd = [
        'ffmpeg', '-y',
        '-i', videoPath,
        '-i', voicePath,
        '-stream_loop', '-1', '-i', effectiveMusic,
        '-filter_complex',
        '[2:a]aformat=channel_layouts=stereo,volume=0.10,afade=t=in:st=0:d=1,apad[bg];' +
        '[1:a]aformat=channel_layouts=stereo,volume=1.3,apad[voice];' +
        '[voice][bg]amix=inputs=2:duration=longest:dropout_transition=0:normalize=0[a]',
        '-map', '0:v', '-map', '[a]',
        '-c:v', 'libx264', '-preset', 'medium', '-crf', '20',
        '-c:a', 'aac', '-b:a', '192k',
        '-movflags', '+faststart',
        '-t', String(totalDuration),
        outPath
      ]
      try {
        execFileSync(cmd[0], cmd.slice(1), { stdio: 'inherit' })
      } catch (e) {
        console.error('FFmpeg audio mix failed. Checking inputs...')
        for (const [label, p] of [['video', videoPath], ['voice', voicePath], ['music', effectiveMusic]]) {
          const exists = fs.existsSync(p)
          const size = exists ? fs.statSync(p).size : 0
          console.error(`  ${label}: ${p} (exists=${exists}, size=${size}B)`)
        }
        throw e
      }
    } else {
      const cmd = ['ffmpeg', '-y', '-i', videoPath, '-i', voicePath, '-map', '0:v', '-map', '1:a', '-c:v', 'copy', '-c:a', 'aac', '-movflags', '+faststart', '-t', String(totalDuration), outPath]
      try {
        execFileSync(cmd[0], cmd.slice(1), { stdio: 'inherit' })
      } catch (e) {
        console.error('FFmpeg audio mix (no music) failed')
        throw e
      }
    }
    return outPath
  }

  overlayFooter(videoPath, footerPath, outPath) {
    if (!fs.existsSync(footerPath)) {
      fs.copyFileSync(videoPath, outPath)
      return outPath
    }
    const cmd = ['ffmpeg', '-y', '-i', videoPath, '-i', footerPath,
      '-filter_complex', '[0:v][1:v]overlay=0:main_h-overlay_h:format=auto,format=yuv420p[v]',
      '-map', '[v]', '-map', '0:a', '-c:a', 'copy', outPath]
    try {
      execFileSync(cmd[0], cmd.slice(1), { stdio: 'inherit' })
    } catch (e) {
      console.error('FFmpeg footer overlay failed')
      throw e
    }
    return outPath
  }
}
