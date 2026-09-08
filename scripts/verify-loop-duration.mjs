#!/usr/bin/env node
/**
 * loopToDuration math + production sweep.
 *
 * Phase A — pure math, OLD vs NEW loop-count formula across every distinct
 *          library track length × target grid. Old formula must fail exactly
 *          at the gap points (chain < target); NEW formula must pass all.
 * Phase B — production: import the real AudioDirector, normalize one real
 *          track per distinct length, run loopToDuration at the target
 *          durations that the OLD formula would have broken, and ffprobe the
 *          actual output. Proves the production code, not a parallel copy.
 *
 * Usage: node scripts/verify-loop-duration.mjs
 */

import { AudioDirector } from '../src/audio/AudioDirector.mjs'
import { execFileAsync } from '../src/audio/AudioDirector.mjs'
import { readFileSync, existsSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dirname, '..')
const CROSSFADE = 2
const OUT = join(ROOT, 'output', 'verify-loop-duration')
mkdirSync(OUT, { recursive: true })

// ── Real library track lengths (seconds), from the manifest ─────────────
const manifest = JSON.parse(readFileSync(join(ROOT, 'assets/music/manifest.json'), 'utf8'))
const trackLengths = [...new Set(manifest.tracks.map(t => Math.round(t.duration * 10) / 10))].sort((a, b) => a - b)

// Target grid: deliberately includes values just above/below known gap points.
const TARGETS = [15, 22, 28, 33, 41, 47, 52, 58, 59, 60, 61, 67, 75, 90]

// OLD formula (pre-fix) — for demonstrating where the gap lives.
const oldLoops = (s, t, c) => Math.ceil(t / s)
const newLoops = (s, t, c) => {
  const eff = s - c
  if (eff <= 0) throw new Error(`source (${s}s) too short for crossfade (${c}s)`)
  return Math.max(1, Math.ceil((t - c) / eff))
}
const chain = (loops, s, c) => loops * s - (loops - 1) * c

let phaseAFailures = 0
console.log('══ Phase A: pure math — OLD vs NEW across library lengths ══')
console.log('src\ttarget\tOLD loops\tOLD chain\tNEW loops\tNEW chain\tresult')
for (const src of trackLengths) {
  for (const target of TARGETS) {
    const ol = Math.max(1, oldLoops(src, target, CROSSFADE))
    const olChain = chain(ol, src, CROSSFADE)
    const oldOk = olChain >= target
    const nl = newLoops(src, target, CROSSFADE)
    const nlChain = chain(nl, src, CROSSFADE)
    const newOk = nlChain >= target
    if (oldOk && !newOk) { console.error('  ! NEW worse than OLD — impossible'); process.exitCode = 1 }
    if (!newOk) phaseAFailures++
    const mark = (ok) => ok ? 'PASS' : 'FAIL'
    console.log(`${src}s\t${target}s\t${ol}\t\t${olChain}s\t${nl}\t\t${nlChain}s\t${mark(oldOk)}/${mark(newOk)}`)
  }
}
console.log(`Phase A: ${phaseAFailures === 0 ? 'ALL NEW PASS' : phaseAFailures + ' FAIL'} (OLD fails expected at gap points)`)
console.log('')

// ── Phase B: real production path ────────────────────────────────────────
console.log('══ Phase B: real AudioDirector.loopToDuration() ══')
const ad = new AudioDirector()
const probeDur = async (f) => {
  const { stdout } = await execFileAsync('ffprobe', [
    '-v', 'error', '-show_entries', 'format=duration', '-of', 'default=nw=1:nk=1', f
  ])
  return parseFloat(stdout.trim())
}
const pickTrack = (dur) => {
  const t = manifest.tracks.find(x => Math.round(x.duration * 10) / 10 === dur)
  if (!t) throw new Error(`no track for duration ${dur}`)
  return join(ROOT, 'assets', 'music', t.file)
}

let phaseBFailures = 0
let checked = 0
const targetSets = {}
for (const src of trackLengths) {
  // Targets that the OLD formula would under-fill for this source length.
  targetSets[src] = TARGETS.filter(t => chain(Math.max(1, oldLoops(src, t, CROSSFADE)), src, CROSSFADE) < t && t > src).slice(0, 4)
}

for (const src of trackLengths) {
  const targets = targetSets[src]
  if (targets.length === 0) { console.log(`${src}s: no gap targets (old formula never under-fills here)`); continue }
  const track = pickTrack(src)
  if (!existsSync(track)) { console.error(`  skip ${src}s: missing ${track}`); continue }
  const norm = await ad.normalize(track)
  for (const target of targets) {
    const looped = await ad.loopToDuration(norm, target)
    const actual = await probeDur(looped)
    checked++
    const ok = actual >= target - 0.05 && actual <= target + 0.1
    if (!ok) phaseBFailures++
    console.log(`${src}s track → ${target}s target: actual ${actual.toFixed(3)}s ${ok ? 'PASS' : 'FAIL'}`)
  }
}
console.log(`Phase B: ${checked} production runs, ${phaseBFailures === 0 ? 'ALL PASS' : phaseBFailures + ' FAIL'}`)

const total = phaseAFailures + phaseBFailures
console.log(total === 0 ? '\n✓ Sweep clean' : `\n✗ ${total} failure(s)`)
process.exit(total === 0 ? 0 : 1)