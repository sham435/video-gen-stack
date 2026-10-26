/**
 * TimingAdapter — stage 4 (localized narration timing) of the
 * LocalizationPipeline (NEWS-MONSTER core).
 *
 * Problem solved (evidence): the engine renders ONE continuous narration
 * track against PLAN-based scene windows. When the localized language needs
 * more speaking time (Tamil narration of the same story ran 39.5s rendered
 * vs 31.7s EN on run v6), the pipeline extends the TOTAL duration but the
 * per-scene windows never adapt — scenes/captions drift away from the voice.
 *
 * Approach:
 *   1. TTS each narration-bearing scene SEPARATELY (same voice config the
 *      single-track path uses) and measure real audio duration per chunk.
 *   2. Re-time the scene windows: each narration window grows to cover its
 *      own chunk (min = plan duration), preserving scene order → captions
 *      and shots stay with the voice.
 *   3. Place every chunk at its scene's new start offset (ffmpeg amix,
 *      normalize=0) so the narration track is EXACTLY aligned to the
 *      re-timed windows; the track ends where the window ends.
 *   4. Report adapted scenes + per-scene audio timing so the caller rebuilds
 *      Timeline(timedScenes) BEFORE rendering and skips the legacy
 *      total-duration extend/pad path (whose behavior caused the drift).
 *
 * Non-EN only by contract: callers gate on langPack.translate (EN keeps the
 * original single-track path — zero regression for the English master).
 */
import { execFileSync } from 'child_process'
import fs from 'node:fs'
import path from 'node:path'

const MIN_GAP_SECS = 0.18 // breather between scenes; a stretched window adds no dead air

export class TimingAdaptError extends Error {}

/**
 * scenes: timedScenes (start/end seconds; narration field = spoken text)
 * makeChunk: async (text, filePath) — caller provides the VoiceSync-bound
 *            generator so per-scene chunks use the SAME voice as legacy.
 * Returns { scenes, chunks, audioPath, totalDuration, stats }
 * Throws TimingAdaptError — caller falls back to the legacy single track.
 */
export async function adaptTimeline(scenes, { makeChunk, outDir, minGap = MIN_GAP_SECS } = {}) {
  if (!makeChunk) throw new TimingAdaptError('TimingAdapter: makeChunk callback required')
  if (!outDir) throw new TimingAdaptError('TimingAdapter: outDir required')
  const spoken = (scenes || [])
    .map((scene, i) => ({ scene, i }))
    .filter(({ scene }) => scene && typeof scene.narration === 'string' && scene.narration.trim())
  if (!spoken.length) throw new TimingAdaptError('TimingAdapter: no narration-bearing scenes to adapt')

  fs.mkdirSync(outDir, { recursive: true })
  const chunks = []
  for (const { scene, i } of spoken) {
    const chunkPath = path.join(outDir, `narr_seg_${String(i).padStart(3, '0')}.mp3`)
    // Parity with the legacy joint track: the planner join inserts '. '
    // between sentences, so a scene-final chunk keeps its terminal period.
    const text = /[.!?।]$/.test(scene.narration.trim()) ? scene.narration.trim() : `${scene.narration.trim()}.`
    await makeChunk(text, chunkPath)
    const dur = Number(fs.existsSync(chunkPath) ? getDuration(chunkPath) : 0)
    if (!(dur > 0.05) || dur > 60) {
      throw new TimingAdaptError(`TimingAdapter: chunk scene#${i} unusable (dur=${dur}s)`)
    }
    chunks.push({ sceneIndex: i, path: chunkPath, duration: dur })
  }

  const adapted = scenes.map((s) => ({ ...s }))
  let prevEnd = null
  for (const c of chunks) {
    const sc = adapted[c.sceneIndex]
    const planDur = Math.max((Number(sc.end) || 0) - (Number(sc.start) || 0), 0)
    const start = prevEnd != null ? prevEnd + minGap : (Number(sc.start) || 0)
    // Window must cover the chunk; when the plan already gives room, keep a
    // small tail gap. When adaptation stretches the window, no dead air.
    const coverDur = c.duration + (c.duration + minGap <= Math.max(planDur, minGap * 2) ? minGap : 0)
    const newDur = Math.max(planDur, coverDur)
    sc.start = round3(start)
    sc.end = round3(start + newDur)
    c.audioStart = sc.start
    prevEnd = sc.end
    // Scenes AFTER this chunk (narrated or not) keep plan length but shift
    // right so chronology survives a stretched voice. Caption-bearing scenes
    // without narration must still be visible → minimum 1.5s window.
    for (let k = c.sceneIndex + 1; k < adapted.length; k++) {
      const nx = adapted[k]
      const oldDur = (Number(nx.end) || 0) - (Number(nx.start) || 0)
      const minDur = nx.caption ? Math.max(oldDur, 1.5) : oldDur
      if (Number(nx.start) < prevEnd) {
        nx.start = prevEnd
        nx.end = prevEnd + Math.max(minDur, 0.5)
      }
    }
  }
  const totalDuration = round3(adapted[adapted.length - 1].end + 0.5)
  const audioPath = placeChunks(chunks, totalDuration, outDir)

  return {
    scenes: adapted,
    chunks: chunks.map((c) => ({ sceneIndex: c.sceneIndex, audioStart: round3(c.audioStart), duration: round3(c.duration), path: c.path })),
    audioPath,
    totalDuration,
    stats: {
      scenes: scenes.length,
      narrated: chunks.length,
      planTotal: round3(Number(scenes[scenes.length - 1]?.end) || 0),
      adaptedTotal: totalDuration,
    },
  }
}

/** Place chunks at offsets → one narration.mp3 (stereo 44.1k, level-preserving mix). */
export function placeChunks(chunks, totalDuration, outDir) {
  const outPath = path.join(outDir, 'narration.mp3')
  if (chunks.length === 1) {
    execFileSync('ffmpeg', [
      '-y', '-i', chunks[0].path,
      '-af', `apad=whole_dur=${totalDuration.toFixed(3)}`,
      '-t', totalDuration.toFixed(3), '-c:a', 'libmp3lame', '-b:a', '128k',
      outPath,
    ], { stdio: 'pipe', timeout: 120000 })
    return outPath
  }
  const args = []
  for (const c of chunks) args.push('-i', c.path)
  const chains = chunks.map((c, k) =>
    `[${k}:a]aformat=sample_rates=44100:channel_layouts=stereo,adelay=${Math.round(c.audioStart * 1000)}:all=1[a${k}]`
  )
  const mixIn = chunks.map((_, k) => `[a${k}]`).join('')
  const filter = `${chains.join(';')};${mixIn}amix=inputs=${chunks.length}:normalize=0,apad=whole_dur=${totalDuration.toFixed(3)}[out]`
  args.push('-filter_complex', filter, '-map', '[out]', '-t', totalDuration.toFixed(3), '-c:a', 'libmp3lame', '-b:a', '128k', outPath)
  execFileSync('ffmpeg', args, { stdio: 'pipe', timeout: 300000 })
  return outPath
}

function getDuration(audioPath) {
  const out = execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=noprint_wrappers=1:nokey=1', audioPath], { stdio: ['ignore', 'pipe', 'ignore'], timeout: 30000 })
  return parseFloat(Buffer.from(out).toString('utf8')) || 0
}

function round3(x) {
  return Math.round(Number(x) * 1000) / 1000
}

export const _internals = { getDuration, round3, MIN_GAP_SECS }
