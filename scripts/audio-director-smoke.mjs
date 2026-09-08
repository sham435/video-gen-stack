#!/usr/bin/env node
/**
 * AudioDirector Direct Smoke Test — deterministic, NO AI providers.
 * Validates the mix engine in isolation using artifacts already on disk:
 *   - voice:  output/audio-quick-test/narration.mp3 (real narration from edge-tts)
 *   - music:  assets/music/nm-track-49-cinematic-tech-reveal.wav (mlx-generated 20s)
 *   - video:  output/audio-quick-test/silent_broadcast.mp4 (47.5s render)
 *
 * Checks:
 *   1. mix(): muxes voice+music(video) into 47.5s mp4; post-mix LUFS ≈ -14; audio present
 *   2. loopToDuration(): normalizes + crossfade-loops 20s wav → 47s; duration + seam loudness
 *   3. normalizeOne(): two-pass loudnorm round-trip (peak/lufs normalized)
 *
 * Usage: node scripts/audio-director-smoke.mjs
 */

import { AudioDirector, normalizeOne } from '../src/audio/AudioDirector.mjs'
import { execFileAsync } from '../src/audio/AudioDirector.mjs'
import { existsSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dirname, '..')
const OUT = join(ROOT, 'output', 'audio-director-smoke')
mkdirSync(OUT, { recursive: true })

const ad = new AudioDirector()

async function probeMeta(f) {
  const { stdout } = await execFileAsync('ffprobe', [
    '-v', 'error', '-show_entries', 'format=duration:stream=codec_type,channels', '-of', 'json', f
  ])
  return JSON.parse(stdout)
}

async function measureLUFS(f) {
  const { stdout, stderr } = await execFileAsync('ffmpeg', [
    '-i', f, '-af', 'loudnorm=I=-14:TP=-1:LRA=7:print_format=json', '-f', 'null', '-'
  ])
  const raw = `${stdout}\n${stderr}`
  const i = raw.lastIndexOf('{')
  const j = raw.indexOf('}', i)
  return JSON.parse(raw.slice(i, j + 1))
}

/**
 * RMS-level discontinuity across a crossfade seam centered at `centerT`.
 * Samples 1s before vs 1s after the seam center; returns the |Δ| in dB.
 */
async function seamDrop(path, totalDur, centerT) {
  const { stdout } = await execFileAsync('ffmpeg', [
    '-i', path, '-af', 'astats=metadata=1:reset=1,ametadata=print:key=lavfi.astats.Overall.RMS_level:file=-', '-f', 'null', '-'
  ])
  const rmsValues = [...stdout.matchAll(/RMS_level=([-\d.]+)/g)]
    .map(m => parseFloat(m[1])).filter(v => Number.isFinite(v) && v !== -Infinity)
  if (rmsValues.length === 0) return null
  const total = rmsValues.length
  const seg = Math.max(1, Math.floor(total / totalDur))
  const idx = t => Math.floor((t / totalDur) * total)
  const a = rmsValues.slice(idx(centerT - 1), idx(centerT - 1) + seg)
  const b = rmsValues.slice(idx(centerT), idx(centerT) + seg)
  return Math.abs(b.reduce((s, v) => s + v, 0) / b.length - a.reduce((s, v) => s + v, 0) / a.length)
}

let failures = 0
function report(name, ok, detail) {
  console.log(`  ${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`)
  if (!ok) failures++
}

try {
  // 1) mix() full path
  console.log('[1] mix(): voice + music + video → 47.5s mp4')
  const voice = join(ROOT, 'output', 'audio-quick-test', 'narration.mp3')
  const music = join(ROOT, 'assets', 'music', 'nm-track-49-cinematic-tech-reveal.wav')
  const video = join(ROOT, 'output', 'audio-quick-test', 'silent_broadcast.mp4')
  if (!existsSync(voice)) throw new Error(`voice missing: ${voice}`)
  if (!existsSync(music)) throw new Error(`music missing: ${music}`)
  if (!existsSync(video)) throw new Error(`video missing: ${video}`)

  // Mirror engine behavior: voice is loudnorm'd to -14 before mix
  const normVoice = await ad.normalize(voice)
  const mixOut = join(OUT, 'mix-47.5s.mp4')
  await ad.mix({
    videoPath: video, voicePath: normVoice, musicPath: music,
    totalDurationSec: 47.5, outPath: mixOut, envelope: null, sfx: []
  })
  const mixMeta = await probeMeta(mixOut)
  const mixDur = parseFloat(mixMeta.format.duration)
  const hasAudio = mixMeta.streams.some(s => s.codec_type === 'audio')
  report('mix duration ~47.5s', Math.abs(mixDur - 47.5) < 1, `${mixDur.toFixed(2)}s`)
  report('mix has audio stream', hasAudio)

  const mixLufs = await measureLUFS(mixOut)
  const lufs = parseFloat(mixLufs.input_i)
  report('mix integrated loudness ≈ -14 LUFS', lufs > -17 && lufs < -11, `${lufs.toFixed(1)} LUFS (I=-14 target)`)

  // 2) loopToDuration odd-length seam
  console.log('[2] loopToDuration(): 20s → 47s crossfade loop')
  const norm = await ad.normalize(music)
  const looped = await ad.loopToDuration(norm, 47)
  const loopMeta = await probeMeta(looped)
  const loopDur = parseFloat(loopMeta.format.duration)
  report('loop duration 47s', Math.abs(loopDur - 47) < 1, `${loopDur.toFixed(2)}s`)

  // Seam continuity check: RMS around crossfade center (23s) vs preceding second
  const drop = await seamDrop(looped, 47, 23)
  report('loop seam loudness continuity', drop !== null && drop < 6, `RMS Δ ${drop.toFixed(2)} dB across crossfade (22s→23s)`)

  // 3) normalizeOne two-pass
  console.log('[3] normalizeOne(): two-pass loudnorm round-trip')
  const normOut = join(OUT, 'normalized-flac.flac')
  await normalizeOne(music, normOut)
  const nLufs = await measureLUFS(normOut)
  report('normalized ≈ -14 LUFS', Math.abs(parseFloat(nLufs.input_i) + 14) < 1.5, `${nLufs.input_i} LUFS`)

  // 4) Regression: 30s library track → 60s target (40-60s video range).
  //    Old loopsNeeded = ceil(target/src) gave 30+30-2 = 58s → 2s silent tail.
  //    Fixed: post-crossfade segment length → 3 loops = 86s → trims to 60s.
  console.log('[4] loopToDuration() regression: 30s → 60s (two seams)')
  const track30 = join(ROOT, 'assets', 'music', 'nm-track-55-cinematic-tech-reveal.wav')
  if (!existsSync(track30)) throw new Error(`30s track missing: ${track30}`)
  const norm30 = await ad.normalize(track30)
  const looped60 = await ad.loopToDuration(norm30, 60)
  const loop60Meta = await probeMeta(looped60)
  const loop60Dur = parseFloat(loop60Meta.format.duration)
  report('loop duration 60s', Math.abs(loop60Dur - 60) < 0.1, `${loop60Dur.toFixed(3)}s`)
  const seam1 = await seamDrop(looped60, 60, 30) // join between seg1/seg2
  const seam2 = await seamDrop(looped60, 60, 58) // join between seg2/seg3
  report('seam1 (30s) continuity', seam1 !== null && seam1 < 6, `RMS Δ ${seam1.toFixed(2)} dB`)
  report('seam2 (58s) continuity', seam2 !== null && seam2 < 6, `RMS Δ ${seam2.toFixed(2)} dB`)

  console.log(`\n=== ${failures === 0 ? 'ALL PASS' : failures + ' FAILURES'} === artifacts: ${OUT}`)
  process.exitCode = failures === 0 ? 0 : 1
} catch (e) {
  console.error(`  ✗ died: ${e.message}`)
  console.error(e.stack)
  process.exitCode = 1
}