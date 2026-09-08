/**
 * AudioDirector — production-grade audio post for NEWS-MONSTER.
 *
 * Responsibilities:
 *   1. Normalize music bed to -14 LUFS (EBU R128) — consistent loudness across tracks
 *   2. Loop/trim music to exact video duration with seamless crossfade
 *   3. Duck music under voice via sidechain (already in AudioMixer, exposed here)
 *   4. Outro bed-level drop (optional envelope)
 *   5. SFX layer with per-cue volume/pan
 *
 * All operations use FFmpeg (loudnorm, afade, acrossfade, sidechaincompress).
 * No external dependencies beyond ffmpeg in PATH.
 */

import { execFileSync, execFile } from 'node:child_process'
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync } from 'node:fs'
import { join, dirname, basename, extname } from 'node:path'
import { promisify } from 'node:util'

export const execFileAsync = promisify(execFile)

const NORMALIZED_DIR = 'assets/music/normalized'
const SAMPLE_RATE = 48000
const TARGET_LUFS = -14
const TRUE_PEAK = -1
// Headroom for final-mix normalization: AAC encoding can push true-peak above
// the loudnorm ceiling, so target 1.5 dB below broadcast spec (observed output
// TP ≈ -0.76 with a -1 ceiling on the mixed render).
const TRUE_PEAK_FINAL = -1.5
const LRA = 7

/**
 * Minimum concat segments so the crossfaded chain reaches >= target.
 * Each acrossfade join overlaps `crossfadeSec`, shrinking the concat, so net
 * gain per segment after the first is (srcDurSec - crossfadeSec).
 *
 * Library constraint: tracks in assets/music/manifest.json span 12.3-30.0s
 * (musicgen wavs 20-30s, legacy mp3 pool 12.3-27s) — always safely above the
 * 2s crossfade. If a shorter stinger/SFX clip is ever added, this throws a
 * clear error instead of dividing badly (effectiveSegmentSec <= 0).
 *
 * @param {number} srcDurSec - source track duration
 * @param {number} targetDurSec - requested bed length
 * @param {number} [crossfadeSec=2] - acrossfade overlap per join
 * @returns {number} min segment count; chain = loops*src - (loops-1)*crossfade >= target
 */
export function computeLoopsNeeded(srcDurSec, targetDurSec, crossfadeSec = 2) {
  const effectiveSegmentSec = srcDurSec - crossfadeSec
  if (effectiveSegmentSec <= 0) {
    throw new Error(`[AudioDirector] source track (${srcDurSec}s) too short for crossfade (${crossfadeSec}s)`)
  }
  return Math.max(1, Math.ceil((targetDurSec - crossfadeSec) / effectiveSegmentSec))
}

export class AudioDirector {
  constructor({ musicDir = 'assets/music', workDir = NORMALIZED_DIR } = {}) {
    this.musicDir = musicDir
    this.workDir = workDir
    mkdirSync(this.workDir, { recursive: true })
  }

  /**
   * Normalize a music track to -14 LUFS (EBU R128) using ffmpeg loudnorm (two-pass).
   * Caches normalized output so repeated renders are instant.
   * @param {string} inputPath - source music file
   * @returns {Promise<string>} path to normalized file
   */
  async normalize(inputPath) {
    const base = basename(inputPath, extname(inputPath))
    const outPath = join(this.workDir, `${base}_norm.wav`)

    if (existsSync(outPath)) return outPath

    // Pass 1: measure
    const measureCmd = [
      'ffmpeg', '-y', '-i', inputPath,
      '-af', `loudnorm=I=${TARGET_LUFS}:TP=${TRUE_PEAK}:LRA=${LRA}:print_format=json`,
      '-f', 'null', '-'
    ]
    const { stdout: measureOut, stderr: measureErr } = await execFileAsync(measureCmd[0], measureCmd.slice(1))
    const measureRaw = `${measureOut}\n${measureErr}`
    const jsonStart = measureRaw.lastIndexOf('{')
    const jsonEnd = measureRaw.indexOf('}', jsonStart)
    const measured = JSON.parse(measureRaw.slice(jsonStart, jsonEnd + 1))

    // Pass 2: normalize using measured values
    const normCmd = [
      'ffmpeg', '-y', '-i', inputPath,
      '-af', `loudnorm=I=${TARGET_LUFS}:TP=${TRUE_PEAK}:LRA=${LRA}:measured_I=${measured.input_i}:measured_TP=${measured.input_tp}:measured_LRA=${measured.input_lra}:measured_thresh=${measured.input_thresh}:offset=${measured.target_offset}:linear=true:print_format=summary`,
      '-ar', String(SAMPLE_RATE),
      '-c:a', 'pcm_s24le',
      outPath
    ]
    await execFileAsync(normCmd[0], normCmd.slice(1))
    return outPath
  }

  /**
   * Loop/trim a normalized music bed to exact duration with seamless crossfade.
   * Uses acrossfade for seamless loop points (detects zero-crossings if possible).
   * @param {string} normalizedPath - output from normalize()
   * @param {number} targetDurationSec - exact video duration
   * @param {number} crossfadeSec - crossfade duration for loop seam (default 2s)
   * @returns {Promise<string>} path to looped file
   */
  async loopToDuration(normalizedPath, targetDurationSec, crossfadeSec = 2) {
    const base = basename(normalizedPath, '_norm.wav')
    const outPath = join(this.workDir, `${base}_looped.wav`)

    // Get source duration
    const { stdout } = await execFileAsync('ffprobe', [
      '-v', 'error', '-show_entries', 'format=duration',
      '-of', 'default=noprint_wrappers=1:nokey=1', normalizedPath
    ])
    const srcDur = parseFloat(stdout.trim())

    if (srcDur >= targetDurationSec) {
      // Just trim with fade-out
      const trimCmd = [
        'ffmpeg', '-y', '-i', normalizedPath,
        '-af', `afade=t=out:st=${(targetDurationSec - 2).toFixed(3)}:d=2`,
        '-t', String(targetDurationSec),
        '-ar', String(SAMPLE_RATE), '-c:a', 'pcm_s24le', outPath
      ]
      await execFileAsync(trimCmd[0], trimCmd.slice(1))
      return outPath
    }

    // Need to loop — calculate loops + crossfade.
    // Each acrossfade join overlaps `crossfadeSec`, shrinking the concat, so
    // count against the post-crossfade per-segment length, not raw srcDur.
    // Without this, a 60s target from a 30s source yields only 30+30-2 = 58s
    // and atrim cannot extend → 2s silent bed tail. See computeLoopsNeeded.
    const loopsNeeded = computeLoopsNeeded(srcDur, targetDurationSec, crossfadeSec)
    const inputs = Array(loopsNeeded).fill(normalizedPath).flatMap(p => ['-i', p])
    
    // Build filter: concat with acrossfade between each segment
    let chain = ''
    let lastLabel = '[0:a]'
    for (let i = 1; i < loopsNeeded; i++) {
      const out = `[acc${i}]`
      chain += `${lastLabel}[${i}:a]acrossfade=d=${crossfadeSec}:c1=tri:c2=tri${out};`
      lastLabel = out
    }
    // Final trim
    const filter = chain +
      `${lastLabel}atrim=duration=${targetDurationSec.toFixed(3)},afade=t=out:st=${(targetDurationSec - 2).toFixed(3)}:d=2[out]`

    const cmd = [
      'ffmpeg', '-y', ...inputs,
      '-filter_complex', filter,
      '-map', '[out]',
      '-ar', String(SAMPLE_RATE), '-c:a', 'pcm_s24le', outPath
    ]
    await execFileAsync(cmd[0], cmd.slice(1))
    return outPath
  }

  /**
   * Full pipeline: normalize → loop → ready for mix.
   * @param {string} musicPath - raw music file
   * @param {number} videoDurationSec - target video duration
   * @returns {Promise<string>} production-ready music bed
   */
  async prepareMusicBed(musicPath, videoDurationSec) {
    const norm = await this.normalize(musicPath)
    const looped = await this.loopToDuration(norm, videoDurationSec)
    return looped
  }

  /**
   * Mix: video + voice + prepared music bed + optional SFX.
   * Uses sidechain compression (music ducks under voice) + optional outro envelope.
   * @param {Object} opts
   * @param {string} opts.videoPath
   * @param {string} opts.voicePath
   * @param {string} opts.musicPath - already prepared (normalized+looped) OR raw (will prep)
   * @param {number} opts.totalDurationSec
   * @param {string} opts.outPath
   * @param {Object} [opts.envelope] - { outroStart, level } bed-level drop
   * @param {Array} [opts.sfx] - [{ path, at, volume, pan }]
   * @returns {Promise<string>}
   */
  async mix(opts) {
    const {
      videoPath,
      voicePath,
      musicPath,
      totalDurationSec,
      outPath,
      envelope = null,
      sfx = []
    } = opts

    // Ensure music is production-ready
    let bedPath = musicPath
    if (!musicPath.includes('_looped.wav')) {
      bedPath = await this.prepareMusicBed(musicPath, totalDurationSec)
    }

    // Build filter graph
    // 1. Music bed: volume ~0.22 (-13 dB resting), apad to duration
    // 2. Voice: volume 1.3, apad, split for sidechain key + mix
    // 3. Sidechain: bed[bg] + voice[v1] → sidechaincompress → [duck]
    // 4. Optional envelope: volume automation on [duck]
    // 5. Optional SFX: overlay at timestamps
    // 6. Mix: voice[v2] + [duck] → amix → [a]
    // 7. Map video + [a] → output

    let filter = ''
    let mapAudio = '[a]'

    // Music bed input index = 2
    filter += '[2:a]aformat=channel_layouts=stereo:sample_rates=48000,afade=t=in:st=0:d=1,volume=0.22,apad[bg];'

    // Voice input index = 1
    filter += '[1:a]aformat=channel_layouts=stereo:sample_rates=48000,volume=1.3,apad,asplit=2[v1][v2];'

    // Sidechain compression
    filter += '[bg][v1]sidechaincompress=threshold=0.05:ratio=8:attack=80:release=500:makeup=1.2[duck];'

    // Optional outro envelope
    let duckOut = 'duck'
    if (envelope && Number.isFinite(envelope.outroStart) && Number.isFinite(envelope.level)) {
      const start = envelope.outroStart.toFixed(3)
      const level = envelope.level.toFixed(3)
      filter += `[duck]volume='if(lt(t,${start}),1,${level})':eval=frame[duck2];`
      duckOut = 'duck2'
    }

    // Optional SFX overlays
    if (sfx.length > 0) {
      let lastDuck = duckOut
      sfx.forEach((s, i) => {
        const at = s.at ?? 0
        const vol = s.volume ?? 0.5
        const pan = s.pan ?? 0
        const sfxIdx = 3 + i // music=2, voice=1, video=0
        filter += `[${sfxIdx}:a]aformat=channel_layouts=stereo:sample_rates=48000,adelay=${Math.round(at * 1000)}|${Math.round(at * 1000)},volume=${vol},pan=stereo|c0=c0*${1 - Math.abs(pan)/2}+c1*${Math.abs(pan)/2}|c1=c1*${1 - Math.abs(pan)/2}+c0*${Math.abs(pan)/2}[sfx${i}];`
        filter += `[${lastDuck}][sfx${i}]amix=inputs=2:duration=longest:dropout_transition=0:normalize=0[duck${i}];`
        lastDuck = `duck${i}`
      })
      duckOut = lastDuck
    }

    // Final mix: voice + ducked bed
    filter += `[v2][${duckOut}]amix=inputs=2:duration=longest:dropout_transition=0:normalize=0[a]`

    // Build input list: video(0), voice(1), music(2), sfx...
    const inputs = ['-i', videoPath, '-i', voicePath, '-i', bedPath, ...sfx.flatMap(s => ['-i', s.path])]

    const cmd = [
      'ffmpeg', '-y',
      ...inputs,
      '-filter_complex', filter,
      '-map', '0:v',
      '-map', mapAudio,
      '-c:v', 'libx264', '-preset', 'medium', '-crf', '20',
      '-c:a', 'aac', '-b:a', '192k',
      '-movflags', '+faststart',
      '-t', String(totalDurationSec),
      outPath
    ]

    try {
      await execFileAsync(cmd[0], cmd.slice(1))
      return outPath
    } catch (e) {
      console.error('AudioDirector mix failed. Inputs:')
      console.error('  video:', videoPath, existsSync(videoPath))
      console.error('  voice:', voicePath, existsSync(voicePath))
      console.error('  bed:  ', bedPath, existsSync(bedPath))
      sfx.forEach((s, i) => console.error(`  sfx${i}:`, s.path, existsSync(s.path)))
      throw e
    }
  }

  /**
   * Broadcast loudness compliance for a full mixed video.
   *
   * The engine mixes TTS narration at source volume over a ducked bed, so the
   * raw mix commonly lands ~-19 LUFS (audible but ~5 LU under the -14 target).
   * This runs two-pass EBU R128 loudnorm on the AUDIO only and copies the video
   * track bit-exact — fast, no visual quality loss.
   * @param {string} inputPath - mixed mp4 (video+audio)
   * @param {string} outPath - loudness-normalized mp4
   * @returns {Promise<string>}
   */
  async normalizeFinal(inputPath, outPath) {
    // Pass 1: measure
    const measureCmd = [
      'ffmpeg', '-y', '-i', inputPath,
      '-af', `loudnorm=I=${TARGET_LUFS}:TP=${TRUE_PEAK_FINAL}:LRA=${LRA}:print_format=json`,
      '-f', 'null', '-'
    ]
    const { stdout: measureOut, stderr: measureErr } = await execFileAsync(measureCmd[0], measureCmd.slice(1))
    const measureRaw = `${measureOut}\n${measureErr}`
    const jsonStart = measureRaw.lastIndexOf('{')
    const jsonEnd = measureRaw.indexOf('}', jsonStart)
    const measured = JSON.parse(measureRaw.slice(jsonStart, jsonEnd + 1))

    // Pass 2: normalize audio, copy video
    const normCmd = [
      'ffmpeg', '-y', '-i', inputPath,
      '-map', '0:v', '-map', '0:a', '-c:v', 'copy',
      '-af', `loudnorm=I=${TARGET_LUFS}:TP=${TRUE_PEAK_FINAL}:LRA=${LRA}:measured_I=${measured.input_i}:measured_TP=${measured.input_tp}:measured_LRA=${measured.input_lra}:measured_thresh=${measured.input_thresh}:offset=${measured.target_offset}:linear=true:print_format=summary`,
      '-c:a', 'aac', '-b:a', '192k',
      '-movflags', '+faststart',
      outPath
    ]
    await execFileAsync(normCmd[0], normCmd.slice(1))
    return outPath
  }

  /**
   * Pick a music track by mood/category (uses AudioMixer's deterministic logic).
   * Falls back to any available track.
   * @param {string} category - e.g., 'tech_reveal', 'breaking_news'
   * @returns {string|null} path to track
   */
  pickTrack(category) {
    const files = existsSync(this.musicDir)
      ? readdirSync(this.musicDir).filter(f => f.startsWith('nm-track-') && f.includes(`-${category}-`) && (f.endsWith('.wav') || f.endsWith('.mp3'))).sort()
      : []
    if (files.length > 0) return join(this.musicDir, files[0])

    // Fallback: any track
    const any = existsSync(this.musicDir)
      ? readdirSync(this.musicDir).filter(f => f.startsWith('nm-track-') && (f.endsWith('.wav') || f.endsWith('.mp3'))).sort()
      : []
    return any.length ? join(this.musicDir, any[0]) : null
  }
}

/**
 * Quick single-track normalization (for testing).
 * @param {string} inputPath
 * @param {string} outputPath
 */
export async function normalizeOne(inputPath, outputPath) {
  const dir = AudioDirector.prototype.workDir
  const ad = new AudioDirector()
  const norm = await ad.normalize(inputPath)
  // Copy to desired output
  await execFileAsync('cp', [norm, outputPath])
  return outputPath
}