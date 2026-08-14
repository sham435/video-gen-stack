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
  constructor({ database = null } = {}) {
    this.musicSeed = null
    this.musicFamily = 'cinematic-tech-reveal'
    this.lastTrack = null
    this.database = database
    this.videoId = null
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
      if (pick) {
        // Last-50-videos reuse policy (same as visual): if this deterministic
        // pick was already used in a recent published video, advance to the
        // next track in the family so the underscore never repeats on screen.
        const safe = this._avoidRecent(pick)
        this.lastTrack = safe
        this._recordMusicUsage(safe)
        return safe.file
      }
    }

    const files = fs.readdirSync(MUSIC_DIR)
      .filter(f => (f.endsWith('.mp3') || f.endsWith('.wav') || f.endsWith('.m4a')) && !f.startsWith('intro_') && f.startsWith('nm-track-'))
      .sort()

    if (files.length > 0) {
      let idx = trackIndexFor(this.musicSeed, files.length)
      let chosen = files[idx]
      let guard = 0
      while (this._recentTracks().includes(chosen) && guard < files.length) {
        idx = (idx + 1) % files.length
        chosen = files[idx]
        guard++
      }
      const full = path.join(MUSIC_DIR, chosen)
      console.log(`🎵 Music track ${idx + 1}/${files.length}: ${full} ${this.musicSeed ? `(for "${String(this.musicSeed).slice(0, 40)}")` : ''}`)
      this.lastTrack = { file: full, index: idx + 1, total: files.length, family: this.musicFamily }
      this._recordMusicUsage(this.lastTrack)
      return full
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

  /** Set of track filenames used in the last `videoWindow` published videos. */
  _recentTracks(videoWindow = 50) {
    if (!this.database) return []
    return this.database.recentMusicTracks(videoWindow).map(r => path.basename(r.track))
  }

  /** Advance a pick to the first track NOT in the recent window (guarded). */
  _avoidRecent(pick) {
    if (!this.database || !pick?.file) return pick
    const recent = this._recentTracks()
    if (!recent.length) return pick
    const baseName = path.basename(pick.file)
    if (!recent.includes(baseName)) return pick

    // Same family, next track: re-pick the family pool and advance.
    const familyFiles = fs.existsSync(MUSIC_DIR)
      ? fs.readdirSync(MUSIC_DIR).filter(f => f.startsWith('nm-track-') && f.includes(`-${pick.family}-`)).sort()
      : []
    const pool = familyFiles.length ? familyFiles : recent
    let idx = (familyFiles.indexOf(baseName) + 1) % familyFiles.length
    let guard = 0
    while (recent.includes(familyFiles[idx]) && guard < familyFiles.length) {
      idx = (idx + 1) % familyFiles.length
      guard++
    }
    const file = path.join(MUSIC_DIR, familyFiles[idx])
    console.log(`🎵 Avoided recent track ${baseName} → ${familyFiles[idx]}`)
    return { file, index: idx + 1, total: familyFiles.length, family: pick.family }
  }

  /** Persist the chosen track against this videoId (for reuse + learning). */
  _recordMusicUsage(pick) {
    try {
      if (this.database && this.videoId && pick?.file) {
        this.database.recordMusicUsage(this.videoId, path.basename(pick.file), pick.family || this.musicFamily)
      }
    } catch { /* non-fatal — reuse policy is best-effort */ }
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
        // Voice is the sidechain key: music ducks ~10dB only while speech is
        // present, then swells back between lines. Static volume=0.10 is
        // replaced by reactive compression — the retention-critical "voice
        // stays intelligible" rule without burying the underscore.
        '[2:a]aformat=channel_layouts=stereo,afade=t=in:st=0:d=1,apad[bg];' +
        '[1:a]aformat=channel_layouts=stereo,volume=1.3,apad,asplit=2[v1][v2];' +
        '[v1][bg]sidechaincompress=threshold=0.05:ratio=8:attack=80:release=500:makeup=1[duck];' +
        '[v2][duck]amix=inputs=2:duration=longest:dropout_transition=0:normalize=0[a]',
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
