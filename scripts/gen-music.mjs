// NEWS-MONSTER trending-style music collection generator.
//
// Produces N ORIGINAL background loops (default 48) in the sonics of viral
// shorts music (phonk, dance, trap, drill, lofi, synthwave, afrobeats) by
// synthesizing every element from scratch (kick, snare, hats, bass, lead,
// pads) as PCM samples. 100% original audio — nothing a content-ID can
// match, so published videos cannot get music claims.
//
// Each video targets ONE track from this collection (see getTrackFor in
// AudioMixer / scripts/audio.mjs).
//
// Usage: node scripts/gen-music.mjs [count]

import fs from 'fs'
import path from 'path'
import { execFileSync } from 'child_process'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..')
const OUT_DIR = path.join(ROOT, 'assets', 'music')

const SR = 44100
const COUNT = Math.max(1, parseInt((process.argv[2] || '48'), 10))
const A4 = 440.0

function mulberry32(seed) {
  let a = seed >>> 0
  return () => {
    a |= 0
    a = (a + 0x6D2B79F5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

// semitone index -> frequency (A4=440). midi 69 = A4.
const freq = (midi) => A4 * Math.pow(2, (midi - 69) / 12)

// Natural-minor scale degrees from a root midi note.
const MINOR = [0, 2, 3, 5, 7, 8, 10]
const chordOf = (root, degree) => [root + MINOR[degree % 7], root + MINOR[(degree + 2) % 7], root + MINOR[(degree + 4) % 7]]

const STYLES = [
  { name: 'phonk',     bpm: [140, 145, 148], prog: [0, 5, 3, 4], root: 45, energy: 1.0 },
  { name: 'dance',     bpm: [124, 128, 132], prog: [0, 5, 3, 4], root: 45, energy: 0.9 },
  { name: 'trap',      bpm: [145, 150, 155], prog: [0, 5, 3, 4], root: 40, energy: 1.0 },
  { name: 'drill',     bpm: [138, 142, 145], prog: [0, 3, 5, 4], root: 41, energy: 1.0 },
  { name: 'lofi',      bpm: [80, 86, 92],    prog: [0, 5, 3, 4], root: 38, energy: 0.35 },
  { name: 'synthwave', bpm: [116, 120, 126], prog: [0, 3, 5, 4], root: 45, energy: 0.8 },
  { name: 'afrobeats', bpm: [120, 123, 126], prog: [0, 3, 4, 5], root: 43, energy: 0.9 },
  { name: 'cinematic', bpm: [104, 108, 112], prog: [0, 5, 3, 6], root: 48, energy: 0.55 },
]

// One-shot synth builders (fill Float32Array "buf" with "dur" seconds).
function synthKick(buf, dur) {
  for (let i = 0; i < dur * SR && i < buf.length; i++) {
    const t = i / SR
    const f = 150 * Math.exp(-t * 16) + 55
    buf[i] = Math.sin(2 * Math.PI * f * t) * Math.exp(-t * 24) * 1.0
  }
}
function synthSnare(buf, dur) {
  for (let i = 0; i < dur * SR && i < buf.length; i++) {
    const t = i / SR
    const noise = Math.random() * 2 - 1
    buf[i] = noise * Math.exp(-t * 95) * 0.55 + Math.sin(2 * Math.PI * 200 * t) * Math.exp(-t * 70) * 0.4
  }
}
function synthHat(buf, dur, open) {
  for (let i = 0; i < dur * SR && i < buf.length; i++) {
    const t = i / SR
    const noise = Math.random() * 2 - 1
    buf[i] = (noise - (Math.random() * 2 - 1)) * (open ? Math.exp(-t * 45) : Math.exp(-t * 210)) * 0.5
  }
}
function synthTone(buf, dur, freq, shape) {
  for (let i = 0; i < dur * SR && i < buf.length; i++) {
    const t = i / SR
    const ph = 2 * Math.PI * (freq || 220) * t
    let w = Math.sin(ph)
    if (shape === 'square') w = Math.sin(ph) >= 0 ? 1 : -1
    else if (shape === 'saw') w = 2 * ((freq * t) % 1) - 1
    const env = Math.exp(-t * 6)
    buf[i] = w * env
  }
}

// simple in-place one-pole lowpass
function lowpass(buf, cutoff) {
  const rc = 1 / (2 * Math.PI * cutoff)
  const dt = 1 / SR
  const a = dt / (rc + dt)
  let y = 0
  for (let i = 0; i < buf.length; i++) { y += a * (buf[i] - y); buf[i] = y }
}

function renderTrack(idx) {
  const style = STYLES[idx % STYLES.length]
  const rng = mulberry32(idx * 7919 + 101)
  const bpm = style.bpm[Math.floor(rng() * style.bpm.length)]
  const root = style.root + Math.floor(rng() * 7)
  const step = 60 / bpm / 4                // 1/16 note seconds
  const bars = 4
  const steps = bars * 16
  const dur = steps * step
  const n = Math.ceil(dur * SR)
  const L = new Float32Array(n)
  const R = new Float32Array(n)

  const prog = style.prog.map(d => chordOf(root, d))
  const barChord = (s) => prog[Math.floor(s / 16) % prog.length]

  // Drum patterns per style (16-step grid).
  const drums = {
    phonk:     { kick: [0, 2, 5, 7, 10, 12], snare: [4, 12], hat: [0, 2, 4, 6, 8, 10, 12, 14] },
    dance:     { kick: [0, 4, 8, 12], snare: [8], hat: [2, 6, 10, 14] },
    trap:      { kick: [0, 5, 10], snare: [8], hat: every16() },
    drill:     { kick: [0, 6, 11], snare: [4, 12], hat: [2, 6, 10, 14] },
    lofi:      { kick: [0, 7, 10], snare: [4, 12], hat: [2, 6, 10, 14] },
    synthwave: { kick: [0, 4, 8, 12], snare: [8], hat: [2, 6, 10, 14] },
    afrobeats: { kick: [0, 7, 10], snare: [4, 8, 12], hat: every16() },
    cinematic: { kick: [0, 8], snare: [], hat: [] },
  }
  const D = drums[style.name] || drums.dance

  for (let s = 0; s < steps; s++) {
    const start = Math.round(s * step * SR)
    const hit = (grid) => grid.some(g => g === (s % 16))

    if (style.energy > 0.2 && hit(D.kick)) synthKick(L.subarray(start, start + SR * .45), .45)
    if (style.energy > 0.2 && hit(D.snare)) synthSnare(L.subarray(start, start + SR * .4), .4)
    if (hit(D.hat)) synthHat(L.subarray(start, start + SR * .12), .12, false)
    if (D.hat2 && hit(D.hat2)) synthHat(L.subarray(start, start + SR * .18), .18, true)
  }

  // bass + arp (beat-energy instruments)
  for (let s = 0; s < steps; s++) {
    const ch = barChord(s)
    const start = Math.round(s * step * SR)
    if (s % 2 === 0) {
      synthTone(L.subarray(start, start + SR * step), step * 1.0, freq(ch[0] - 12), 'saw')
    }
    if (style.energy > 0.4 && s % 4 === 2) {
      const arpF = freq(ch[(s / 4) % 3 | 0])
      synthTone(L.subarray(start, start + SR * step * .5), step * .5, arpF, 'square')
    }
  }
  lowpass(L, 5200)
  // pad for mellow styles
  if (style.energy <= 0.6) {
    const pbuf = new Float32Array(n)
    for (let bar = 0; bar < 4; bar++) {
      const ch = prog[bar]
      const start = Math.round(bar * 16 * step * SR)
      for (const degChord of ch) {
        synthTone(pbuf.subarray(start, start + SR * 8), 8, freq(degChord), 'sine')
      }
    }
    for (let i = 0; i < n; i++) { L[i] += pbuf[i] * .09 }
  }

  // copy mono->stereo with tiny width via delayed hat
  R.set(L)
  for (let s = 0; s < steps; s++) {
    const start = Math.round(s * step * SR)
    if ((D.hat || []).some(g => g === (s % 16))) synthHat(R.subarray(start, start + SR * .12), .12, true)
  }

  // soft normalize + gentle clip
  let peak = 0
  for (let i = 0; i < n; i++) peak = Math.max(peak, Math.abs(L[i]), Math.abs(R[i]))
  const g = peak > 0.9 ? 0.9 / peak : 1
  for (let i = 0; i < n; i++) { L[i] *= g; R[i] *= g }

  // write WAV (stereo 16-bit)
  const wav = encodeWav(L, R)
  const file = path.join(OUT_DIR, `nm-track-${String(idx + 1).padStart(2, '0')}-${style.name}-${bpm}.mp3`)
  const tmpWav = file.replace('.mp3', '.wav')
  fs.writeFileSync(tmpWav, wav)
  return { tmpWav, file }
}

function every16() { return Array.from({ length: 16 }, (_, i) => i) }

function encodeWav(L, R) {
  const n = L.length
  const buf = Buffer.alloc(44 + n * 4)
  buf.write('RIFF', 0)
  buf.writeUInt32LE(36 + n * 4, 4)
  buf.readInt32LE ? 0 : 0
  buf.write('WAVE', 8)
  buf.write('fmt ', 12)
  buf.writeUInt32LE(16, 16)
  buf.writeUInt16LE(1, 20)
  buf.writeUInt16LE(2, 22)
  buf.writeUInt32LE(SR, 24)
  buf.writeUInt32LE(SR * 4, 28)
  buf.writeUInt16LE(4, 32)
  buf.writeUInt16LE(16, 34)
  buf.write('data', 36)
  buf.writeUInt32LE(n * 4, 40)
  for (let i = 0; i < n; i++) {
    const li = Math.max(-1, Math.min(1, L[i])) * 32767
    const ri = Math.max(-1, Math.min(1, R[i])) * 32767
    buf.writeInt16LE(li | 0, 44 + i * 4)
    buf.writeInt16LE(ri | 0, 46 + i * 4)
  }
  return buf
}

function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true })
  console.log(`Rendering ${COUNT} original music tracks → ${OUT_DIR}`)
  const jobs = []
  for (let i = 0; i < COUNT; i++) {
    try {
      const tr = renderTrack(i)
      jobs.push(tr)
    } catch (e) { console.error(`track ${i + 1} synth failed: ${e.message}`) }
  }
  for (const { tmpWav } of jobs) {
    try {
      const out = tmpWav.replace(/\.wav$/, '.mp3')
      execFileSync('ffmpeg', ['-y', '-i', tmpWav, '-af', 'loudnorm=I=-16:TP=-1.5:LRA=11', '-c:a', 'libmp3lame', '-b:a', '192k', out], { stdio: 'pipe', timeout: 60000 })
      fs.unlinkSync(tmpWav)
    } catch (e) { console.error(`  encode failed: ${e.message}`) }
  }
  console.log('Done.')
}
main()