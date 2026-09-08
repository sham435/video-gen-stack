#!/usr/bin/env node
/**
 * AudioDirector loop-duration regression guards (CI: `npm test`).
 *
 * Guards the loopToDuration bug where the loop count ignored crossfade overlap:
 *   loopsNeeded = ceil(target/src) → chain 2*30-2 = 58s for a 60s target →
 *   atrim cannot extend → 1-2s silent bed tail on 59-60s videos.
 *
 * Three layers:
 *   [1] computeLoopsNeeded sweep — every distinct library track length in
 *       assets/music/manifest.json (12.3-30.0s) against a gap-target grid:
 *       crossfaded chain must ALWAYS reach >= target. Pure math, no ffmpeg.
 *   [2] guard — source <= crossfade throws a clear error instead of dividing
 *       badly (matters if a sub-2s stinger/SFX track is ever added).
 *   [3] real loopToDuration on a synthetic 3s sine → 5s target. The OLD
 *       formula would produce ceil(5/3)=2 → 2*3-2 = 4s < 5s → FAIL. Requires
 *       only ffmpeg (installed in CI), no library assets.
 *   [4] real loopToDuration on the 30s library wav → 60s (skips cleanly when
 *       mlx wavs are absent, e.g. CI without the audio assets).
 */

import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, existsSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { AudioDirector, computeLoopsNeeded, execFileAsync } from '../src/audio/AudioDirector.mjs'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dirname, '..')
const CROSSFADE = 2

// Targets deliberately include values just above/below known gap points
// (k*src - (k-1)*crossfade), not just typical video lengths.
const TARGETS = [15, 22, 28, 33, 41, 47, 52, 58, 59, 60, 61, 67, 75, 90]
const chainLength = (loops, src, c) => loops * src - (loops - 1) * c

const manifestPath = join(ROOT, 'assets', 'music', 'manifest.json')
const manifest = existsSync(manifestPath) ? JSON.parse(readFileSync(manifestPath, 'utf8')) : null
const trackLengths = manifest
  ? [...new Set(manifest.tracks.map(t => Math.round(t.duration * 10) / 10))].sort((a, b) => a - b)
  : null

test('computeLoopsNeeded — no track length × target ever under-fills', () => {
  if (!trackLengths) {
    console.warn('SKIP: assets/music/manifest.json missing')
    return
  }
  let rows = 0
  for (const src of trackLengths) {
    for (const target of TARGETS) {
      const loops = computeLoopsNeeded(src, target, CROSSFADE)
      const chain = chainLength(loops, src, CROSSFADE)
      assert.ok(chain >= target, `under-fill: ${src}s → ${target}s needs chain >= ${target}s, got ${chain}s (${loops} loops)`)
      rows++
    }
  }
  console.log(`sweep: ${trackLengths.length} lengths × ${TARGETS.length} targets = ${rows} rows, all reach target`)
})

test('computeLoopsNeeded — guard throws when source <= crossfade', () => {
  assert.throws(() => computeLoopsNeeded(1.5, 10, 2), /too short for crossfade/)
  assert.throws(() => computeLoopsNeeded(2, 10, 2), /too short for crossfade/) // equal edge
  assert.doesNotThrow(() => computeLoopsNeeded(12.3, 60, 2))
})

test('loopToDuration — synthetic 3s sine → 5s (old formula under-fills to 4s)', async (t) => {
  // Old math for this exact case: ceil(5/3) = 2 loops → 2*3-2 = 4s < 5s.
  const srcLoops = Math.ceil(5 / 3)
  assert.equal(chainLength(srcLoops, 3, CROSSFADE), 4, 'sanity: old formula under-fills this case')

  const workDir = mkdtempSync(join(tmpdir(), 'ad-loop-'))
  t.after(() => rmSync(workDir, { recursive: true, force: true }))
  const ad = new AudioDirector({ workDir })

  const src = join(workDir, 'sine3s.wav')
  await execFileAsync('ffmpeg', [
    '-y', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=3',
    '-ar', '48000', '-c:a', 'pcm_s24le', src
  ])
  const norm = await ad.normalize(src)
  const looped = await ad.loopToDuration(norm, 5)

  const { stdout } = await execFileAsync('ffprobe', [
    '-v', 'error', '-show_entries', 'format=duration', '-of', 'default=nw=1:nk=1', looped
  ])
  const actual = parseFloat(stdout.trim())
  assert.ok(Math.abs(actual - 5) < 0.1, `expected ~5.0s bed, got ${actual}s`)

  // Non-silent sanity (RMS present)
  const { stderr } = await execFileAsync('ffmpeg', [
    '-i', looped, '-af', 'astats=metadata=1:reset=1:measure_overall=1', '-f', 'null', '-'
  ])
  assert.match(stderr, /RMS level dB[^\n]*-\d/, 'output must contain measurable RMS (not silent)')
})

test('loopToDuration — 30s library wav → 60s (skips without mlx assets)', { skip: false }, async (t) => {
  const track = join(ROOT, 'assets', 'music', 'nm-track-55-cinematic-tech-reveal.wav')
  if (!existsSync(track)) {
    console.warn('SKIP [30s→60s regression]: mlx wav assets not present')
    return
  }
  const workDir = mkdtempSync(join(tmpdir(), 'ad-loop60-'))
  t.after(() => rmSync(workDir, { recursive: true, force: true }))
  const ad = new AudioDirector({ workDir })

  const norm = await ad.normalize(track)
  const looped = await ad.loopToDuration(norm, 60)
  const { stdout } = await execFileAsync('ffprobe', [
    '-v', 'error', '-show_entries', 'format=duration', '-of', 'default=nw=1:nk=1', looped
  ])
  const actual = parseFloat(stdout.trim())
  assert.ok(Math.abs(actual - 60) < 0.1, `expected 60.0s bed, got ${actual}s (was 58s pre-fix)`)
})