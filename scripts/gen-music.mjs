// NEWS-MONSTER original background music generator.
//
// Why: the Pixabay "lofi-study" track got content-ID claimed by HAAWK
// (FASSounds). Downloaded stock loops are a copyright minefield, so the
// channel now generates its own ambient news bed with ffmpeg synthesis —
// 100% original audio, nothing to claim.
//
// Usage: node scripts/gen-music.mjs [outPath]
// Default: assets/music/nm-original-bed.mp3

import fs from 'fs'
import path from 'path'
import { execFileSync } from 'child_process'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..')
const OUT = process.argv[2] || path.join(ROOT, 'assets', 'music', 'nm-original-bed.mp3')

// Chord progression: Am — F — C — G (i VI III VII), classic news/mystery loop.
// Each chord: root, minor/major third, fifth, octave (Hz).
const CHORDS = [
  { name: 'Am', notes: [110.0, 130.81, 164.81, 220.0],  bass: 55.0 },
  { name: 'F',  notes: [87.31, 130.81, 174.61, 220.0],  bass: 43.65 },
  { name: 'C',  notes: [130.81, 196.0, 261.63, 329.63], bass: 65.41 },
  { name: 'G',  notes: [98.0, 146.83, 196.0, 246.94],   bass: 49.0 },
]

const CHORD_SEC = 4 // seconds per chord (16s loop)
const LOOP_AT_SEC = 64 // total loop length (4 bars x 4 chords)

function sh(args, opts = {}) {
  return execFileSync('ffmpeg', args, { stdio: 'pipe', timeout: 120000, ...opts })
}

function run() {
  const tmp = path.join(ROOT, 'output', '.music-tmp')
  fs.mkdirSync(tmp, { recursive: true })

  // 1) Render one 4s pad WAV per chord: layered sines with slow fades.
  const chordFiles = CHORDS.map((c, i) => {
    const wav = path.join(tmp, `chord-${i}.wav`)
    const inputs = []
    const parts = []
    c.notes.forEach((f, n) => {
      inputs.push('-f', 'lavfi', '-t', String(CHORD_SEC), '-i', `sine=frequency=${f}:sample_rate=44100`)
      parts.push(`[${n}:a]volume=0.16,afade=t=in:st=0:d=1.4,afade=t=out:st=${CHORD_SEC - 1.4}:d=1.4,lowpass=f=2400,highpass=f=60[p${n}]`)
    })
    inputs.push('-f', 'lavfi', '-t', String(CHORD_SEC), '-i', `sine=frequency=${c.bass}:sample_rate=44100`)
    const bassIdx = c.notes.length
    parts.push(`[${bassIdx}:a]volume=0.22,afade=t=in:st=0:d=0.8,afade=t=out:st=${CHORD_SEC - 0.8}:d=0.8,lowpass=f=300[b]`)
    const ins = c.notes.map((_, n) => `[p${n}]`).join('') + '[b]'
    parts.push(`${ins}amix=inputs=${c.notes.length + 1}:duration=first:normalize=0,pan=stereo|c0=c0|c1=c0[a]`)
    sh(['-y', ...inputs, '-filter_complex', parts.join(';'), '-map', '[a]', '-c:a', 'pcm_s16le', wav])
    return wav
  })

  // 2) Concat chords -> full loop length, add movement + texture.
  const listFile = path.join(tmp, 'list.txt')
  const repeats = Math.ceil(LOOP_AT_SEC / (CHORD_SEC * CHORDS.length))
  let entries = ''
  for (let r = 0; r < repeats; r++) {
    for (const w of chordFiles) entries += `file '${w}'\n`
  }
  fs.writeFileSync(listFile, entries)

  const looped = path.join(tmp, 'looped.wav')
  sh([
    '-y', '-f', 'concat', '-safe', '0', '-i', listFile,
    '-filter_complex',
    '[0:a]tremolo=f=0.4:d=0.15,tremolo=f=0.3:d=0.1,lowpass=f=3200,highpass=f=45[a]',
    '-map', '[a]', '-t', String(LOOP_AT_SEC), '-c:a', 'pcm_s16le', looped,
  ])

  // 3) Vinyl-ish texture bed (pink noise, very low) mixed under the pads.
  const textured = path.join(tmp, 'textured.wav')
  sh([
    '-y', '-i', looped,
    '-f', 'lavfi', '-t', String(LOOP_AT_SEC), '-i', 'anoisesrc=c=pink:a=0.008:r=44100',
    '-filter_complex',
    '[1:a]lowpass=f=800[n];[0:a][n]amix=inputs=2:duration=first:normalize=0,alimiter=limit=0.891:level=false[a]',
    '-map', '[a]', '-c:a', 'pcm_s16le', textured,
  ])

  // 4) Normalize to a consistent broadcast level and encode mp3.
  fs.mkdirSync(path.dirname(OUT), { recursive: true })
  sh([
    '-y', '-i', textured,
    '-af', 'loudnorm=I=-20:TP=-1.5:LRA=11',
    '-c:a', 'libmp3lame', '-b:a', '192k', OUT,
  ])

  fs.rmSync(tmp, { recursive: true, force: true })
  console.log(`✅ Original music bed: ${OUT} (${(fs.statSync(OUT).size / 1024).toFixed(0)}KB, ${LOOP_AT_SEC}s loop)`)
  return OUT
}

run()
