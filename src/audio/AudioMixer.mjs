import { execFileSync } from 'child_process'
import fs from 'fs'
import path from 'path'

const MUSIC_DIR = 'assets/music'

export class AudioMixer {
  constructor() {
    fs.mkdirSync(MUSIC_DIR, { recursive: true })
  }

  getRandomMusic() {
    if (!fs.existsSync(MUSIC_DIR)) fs.mkdirSync(MUSIC_DIR, { recursive: true })

    const files = fs.readdirSync(MUSIC_DIR)
      .filter(f => (f.endsWith('.mp3') || f.endsWith('.wav') || f.endsWith('.m4a')) && !f.startsWith('intro_'))

    if (files.length > 0) {
      return path.join(MUSIC_DIR, files[Math.floor(Math.random() * files.length)])
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

    const existing = fs.readdirSync(MUSIC_DIR)
      .filter(f => (f.endsWith('.mp3') || f.endsWith('.wav')) && !f.startsWith('intro_') && !f.startsWith('_'))

    if (existing.length > 0) return

    console.log('Downloading free background music...')
    const tracks = [
      { name: 'lofi-study.mp3', url: 'https://cdn.pixabay.com/download/audio/2022/05/27/audio_1808fbf07a.mp3?filename=lofi-study-112191.mp3' },
    ]

    for (const track of tracks) {
      try {
        const response = await fetch(track.url, { signal: AbortSignal.timeout(30000), redirect: 'follow' })
        if (!response.ok) throw new Error(`HTTP ${response.status}`)
        fs.writeFileSync(path.join(MUSIC_DIR, track.name), Buffer.from(await response.arrayBuffer()))
        const size = fs.statSync(path.join(MUSIC_DIR, track.name)).size
        if (size > 10000) console.log(`  Music: ${track.name} (${(size / 1024).toFixed(0)}KB)`)
        else { fs.unlinkSync(path.join(MUSIC_DIR, track.name)); console.log(`  ${track.name} too small`) }
      } catch (e) { console.log(`  Music download failed: ${e.message}`) }
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
