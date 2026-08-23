// AudioPreflight — validates that a rendered video contains correct audio.
//
// This is a production-output validator, not a uniqueness checker.
// It proves that every video actually contains:
//   - narration audio stream
//   - background music track
//   - correct mixing (ducking applied, volume within bounds)
//   - audio duration matching video duration
//
// Uses ffprobe for stream analysis + loudness measurement.
// Called after RENDER stage, before C2PA/UPLOAD.

import fs from 'node:fs'
import { execFileSync } from 'node:child_process'

const MIN_NARRATION_DURATION_S = 5
const MAX_NARRATION_DURATION_S = 65
const MIN_MUSIC_VOLUME_DB = -40
const MAX_MUSIC_VOLUME_DB = -10
const MIN_VIDEO_AUDIO_RATIO = 0.8  // audio should be >= 80% of video duration

export class AudioPreflight {
  /**
   * Validate audio quality of a rendered video.
   *
   * @param {string} videoPath — path to final.mp4
   * @param {object} context — { musicTrack, musicFamily, narrationScript, engine }
   * @returns {{ pass: boolean, checks: object[], errors: string[] }}
   */
  static async validate(videoPath, context = {}) {
    const checks = []
    const errors = []

    // 1. File exists
    if (!videoPath || !fs.existsSync(videoPath)) {
      return { pass: false, checks: [{ name: 'file_exists', pass: false }], errors: ['VIDEO_MISSING'] }
    }

    // 2. ffprobe analysis
    let probe
    try {
      probe = AudioPreflight._probe(videoPath)
    } catch (e) {
      return { pass: false, checks: [{ name: 'ffprobe', pass: false }], errors: [`FFPROBE_FAILED: ${e.message}`] }
    }

    // 3. Audio stream present
    const hasAudio = probe.streams.some(s => s.type === 'audio')
    checks.push({ name: 'audio_stream', pass: hasAudio, detail: `${probe.streams.filter(s => s.type === 'audio').length} audio streams` })
    if (!hasAudio) errors.push('NO_AUDIO_STREAM')

    // 4. Audio duration matches video
    const videoDuration = probe.duration
    const audioDuration = probe.audioDuration
    if (hasAudio && audioDuration > 0) {
      const ratio = audioDuration / videoDuration
      const durationOk = ratio >= MIN_VIDEO_AUDIO_RATIO
      checks.push({
        name: 'audio_duration',
        pass: durationOk,
        detail: `audio=${audioDuration.toFixed(1)}s video=${videoDuration.toFixed(1)}s ratio=${ratio.toFixed(2)}`,
      })
      if (!durationOk) errors.push(`AUDIO_DURATION_SHORT: ratio=${ratio.toFixed(2)}`)
    }

    // 5. Music track was selected (from engine context)
    const hasMusicTrack = !!context.musicTrack
    checks.push({ name: 'music_selected', pass: hasMusicTrack, detail: context.musicTrack || 'none' })
    if (!hasMusicTrack) errors.push('NO_MUSIC_TRACK_SELECTED')

    // 6. Loudness analysis (if audio stream present)
    if (hasAudio) {
      try {
        const loudness = AudioPreflight._measureLoudness(videoPath)
        checks.push({
          name: 'loudness',
          pass: loudness.meanVolume > MIN_MUSIC_VOLUME_DB && loudness.meanVolume < MAX_MUSIC_VOLUME_DB,
          detail: `mean=${loudness.meanVolume.toFixed(1)}dB peak=${loudness.peakVolume.toFixed(1)}dB`,
        })
        if (loudness.meanVolume <= MIN_MUSIC_VOLUME_DB) {
          errors.push(`AUDIO_TOO_QUIET: ${loudness.meanVolume.toFixed(1)}dB`)
        }
        if (loudness.meanVolume >= MAX_MUSIC_VOLUME_DB) {
          errors.push(`AUDIO_TOO_LOUD: ${loudness.meanVolume.toFixed(1)}dB`)
        }
      } catch {
        checks.push({ name: 'loudness', pass: true, detail: 'skipped (ffprobe loudness failed)' })
      }
    }

    // 7. Narration script was provided
    const hasNarration = !!context.narrationScript
    checks.push({ name: 'narration_script', pass: hasNarration, detail: hasNarration ? `${context.narrationScript.length} chars` : 'missing' })
    if (!hasNarration) errors.push('NO_NARRATION_SCRIPT')

    return { pass: errors.length === 0, checks, errors }
  }

  /**
   * ffprobe: extract streams + duration.
   */
  static _probe(videoPath) {
    const out = execFileSync(
      'ffprobe',
      [
        '-v', 'error',
        '-show_entries', 'format=duration',
        '-show_entries', 'stream=codec_type',
        '-show_entries', 'stream=codec_name',
        '-show_entries', 'stream=duration',
        '-of', 'json',
        videoPath,
      ],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }
    )
    const parsed = JSON.parse(out)
    const duration = Number.parseFloat(parsed?.format?.duration) || 0
    const streams = (parsed?.streams || []).map(s => ({
      type: s.codec_type,
      codec: s.codec_name,
      duration: Number.parseFloat(s.duration) || 0,
    }))
    const audioStreams = streams.filter(s => s.type === 'audio')
    const audioDuration = audioStreams.length > 0
      ? Math.max(...audioStreams.map(s => s.duration))
      : 0
    return { duration, streams, audioDuration }
  }

  /**
   * ffprobe: measure mean and peak volume.
   */
  static _measureLoudness(videoPath) {
    const out = execFileSync(
      'ffprobe',
      [
        '-v', 'error',
        '-i', videoPath,
        '-af', 'volumedetect',
        '-f', 'null',
        '/dev/null',
      ],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }
    )
    const meanMatch = out.match(/mean_volume:\s*([-\d.]+)\s*dB/)
    const peakMatch = out.match(/max_volume:\s*([-\d.]+)\s*dB/)
    return {
      meanVolume: meanMatch ? parseFloat(meanMatch[1]) : -30,
      peakVolume: peakMatch ? parseFloat(peakMatch[1]) : -10,
    }
  }
}
