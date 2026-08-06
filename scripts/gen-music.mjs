// NEWS-MONSTER MusicGenerationEngine v2 — cinematic original soundtrack
// collection generator.
//
// User direction (2026): stock loops sound cheap and carry content-ID risk.
// Replace the trending-genre loops with a PREMIUM cinematic engine that
// captures the FEELING of viral reference tracks (e.g. warm Indian-flavored
// lo-fi night-drive moods, trailer tension, tech-reveal wonder, luxury
// documentary space) WITHOUT copying any melody, arrangement or sample.
//
// Everything is synthesized from scratch as PCM (kick/snare/hats/boom/tam,
// pads with detune stacks, sub basses, piano-like tones, risers, crashes)
// then mixed through a cinematic echo-space bus and normalized to
// I=-14:TP=-1.5:LRA=11 — the short-form loudness target.
//
// Four families × 12 tracks = 48 loops, each a seamless 8-bar loop that
// repeats under narration via -stream_loop -1:
//
//   cinematic-tech-reveal  — curiosity/discovery, futuristic pulses
//   emotional-story        — warm nostalgic lo-fi (the "Pachai" feeling:
//                            analog warmth, vinyl texture, emotional pads)
//   action-energy          — trailer tension, dark bass, hits every ~4s
//   luxury-future          — premium orchestral-space, slow and massive
//
// Each video deterministically picks ONE track: article title hash →
// track index WITHIN the family matched by MusicFamily.resolveMusicFamily.
//
// Usage: node scripts/gen-music.mjs [count=48] [--family name]

import fs from 'fs'
import path from 'path'
import { execFileSync } from 'child_process'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..')
const OUT_DIR = path.join(ROOT, 'assets', 'music')

const SR = 44100
const A4 = 440.0
const familyOnly = (process.argv.findIndex(a => a === '--family') !== -1)
  ? process.argv[process.argv.findIndex(a => a === '--family') + 1]
  : null
const COUNT = familyOnly ? 12 : Math.max(1, parseInt((process.argv[2] || '48'), 10))

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

const freq = (midi) => A4 * Math.pow(2, (midi - 69) / 12)
const MINOR = [0, 2, 3, 5, 7, 8, 10]
const MAJOR = [0, 2, 4, 5, 7, 9, 11]
const chordOf = (root, degree, scale = MINOR) =>
  [root + scale[degree % 7], root + scale[(degree + 2) % 7], root + scale[(degree + 4) % 7]]

// ---- four families ---------------------------------------------------------
const FAMILIES = [
  {
    key: 'cinematic-tech-reveal', bpm: [112, 118, 124], roots: [45, 43, 41, 40, 38],
    energy: 0.75, emotion: 'wonder', mood: 'curiosity',
    prog: [0, 5, 3, 4], scale: MINOR, drums: 'tech',
  },
  {
    key: 'emotional-story', bpm: [72, 80, 88], roots: [43, 41, 40, 38, 45],
    energy: 0.3, emotion: 'nostalgia', mood: 'warm',
    prog: [0, 5, 3, 4], scale: MINOR, drums: 'lofi',
  },
  {
    key: 'action-energy', bpm: [142, 150, 158], roots: [40, 38, 36, 43, 41],
    energy: 1.0, emotion: 'tension', mood: 'urgent',
    prog: [0, 3, 5, 4], scale: MINOR, drums: 'trap',
  },
  {
    key: 'luxury-future', bpm: [84, 92, 100], roots: [38, 40, 43, 45, 36],
    energy: 0.45, emotion: 'premium', mood: 'epic',
    prog: [0, 5, 3, 6], scale: MAJOR, drums: 'cinematic',
  },
]
const FAMILY_KEYS = FAMILIES.map(f => f.key)

// ---- low-level voices ------------------------------------------------------
function wave(shape, p) {
  switch (shape) {
    case 'sine': return Math.sin(p)
    default: {
      const ph = (((p / (2 * Math.PI)) % 1) + 1) % 1
      switch (shape) {
        case 'square': return ph < 0.5 ? 1 : -1
        case 'saw': return 2 * ph - 1
        case 'tri': return 1 - 4 * Math.abs(ph - 0.5)
        default: return Math.sin(p)
      }
    }
  }
}

function addTone(dst, start, dur, f, opts = {}) {
  const { shape = 'sine', attack = 0.01, decay = dur, volume = 1, detune = 0 } = opts
  const n = Math.min(Math.floor(dur * SR), dst.length - start)
  if (n <= 0) return
  const f0 = f * (1 + detune)
  const attN = Math.max(1, attack * SR)
  let phase = 0
  for (let i = 0; i < n; i++) {
    const t = i / SR
    const att = i < attN ? i / attN : 1
    dst[start + i] += wave(shape, phase) * att * Math.exp(-t / decay) * volume
    phase += 2 * Math.PI * f0 / SR
  }
}

function addNoise(dst, start, dur, opts = {}) {
  const { attack = 0.01, decay = dur, volume = 1, color = 'white' } = opts
  const n = Math.min(Math.floor(dur * SR), dst.length - start)
  if (n <= 0) return
  const attN = Math.max(1, attack * SR)
  let lp = 0
  for (let i = 0; i < n; i++) {
    const t = i / SR
    let x = Math.random() * 2 - 1
    if (color === 'pink') { lp = 0.995 * lp + 0.005 * x; x = x * 0.5 + lp * 2.2 }
    const att = i < attN ? i / attN : 1
    dst[start + i] += x * att * Math.exp(-t / decay) * volume
  }
}

function lowpass(buf, cutoff) {
  const rc = 1 / (2 * Math.PI * cutoff)
  const dt = 1 / SR
  const a = dt / (rc + dt)
  let y = 0
  for (let i = 0; i < buf.length; i++) { y += a * (buf[i] - y); buf[i] = y }
}

function oneShot(dst, start, type, opts = {}) {
  const f = opts.f ?? 0
  switch (type) {
    case 'kick': { // pitch-swept thump 150->45
      const n = Math.min(Math.floor(0.4 * SR), dst.length - start)
      for (let i = 0; i < n; i++) {
        const t = i / SR
        const ff = 150 * Math.exp(-t * 18) + 45
        dst[start + i] += Math.sin(2 * Math.PI * ff * t) * Math.exp(-t * 26) * (opts.v ?? 1)
      }
      break
    }
    case 'snare': {
      const n = Math.min(Math.floor(0.32 * SR), dst.length - start)
      for (let i = 0; i < n; i++) {
        const t = i / SR
        const noise = Math.random() * 2 - 1
        dst[start + i] += (noise * Math.exp(-t * 90) * 0.5 + Math.sin(2 * Math.PI * 190 * t) * Math.exp(-t * 55) * 0.45) * (opts.v ?? 1)
      }
      break
    }
    case 'hat': {
      const open = !!opts.open
      const n = Math.min(Math.floor((open ? 0.22 : 0.09) * SR), dst.length - start)
      for (let i = 0; i < n; i++) {
        const t = i / SR
        const noise = Math.random() * 2 - 1
        dst[start + i] += noise * Math.exp(-t * (open ? 40 : 200)) * (opts.v ?? 0.5)
      }
      break
    }
    case 'boom': { // cinematic tam-tam-ish low boom
      const n = Math.min(Math.floor(2.2 * SR), dst.length - start)
      for (let i = 0; i < n; i++) {
        const t = i / SR
        const ff = 74 * Math.exp(-t * 4) + 44
        dst[start + i] += (Math.sin(2 * Math.PI * ff * t) * Math.exp(-t * 2.6) * 0.85 + (Math.random() * 2 - 1) * Math.exp(-t * 55) * 0.14) * (opts.v ?? 1)
      }
      break
    }
    case 'hit': { // trailer slam — transient + 180Hz body
      const n = Math.min(Math.floor(0.4 * SR), dst.length - start)
      for (let i = 0; i < n; i++) {
        const t = i / SR
        dst[start + i] += ((Math.random() * 2 - 1) * Math.exp(-t * 42) * 0.55 + Math.sin(2 * Math.PI * 180 * t) * Math.exp(-t * 30) * 0.7) * (opts.v ?? 1)
      }
      break
    }
    case 'crash': { // metallic shimmer + noise burst
      const n = Math.min(Math.floor(2.6 * SR), dst.length - start)
      for (let i = 0; i < n; i++) {
        const t = i / SR
        dst[start + i] += ((Math.random() * 2 - 1) * Math.exp(-t * 6) * 0.3
          + Math.sin(2 * Math.PI * 6200 * t) * Math.exp(-t * 9) * 0.16) * (opts.v ?? 1)
      }
      break
    }
  }
}

function addRiser(dst, start, dur, opts = {}) {
  const n = Math.min(Math.floor(dur * SR), dst.length - start)
  if (n <= 0) return
  for (let i = 0; i < n; i++) {
    const t = i / SR
    const prog = i / n
    const trem = 1 + 0.5 * Math.sin(2 * Math.PI * (0.7 + prog * 2.4) * t)
    dst[start + i] += (Math.random() * 2 - 1) * trem * Math.pow(prog, 1.25) * (opts.v ?? 0.32)
  }
}

// ---- per-family arrangement ------------------------------------------------
// Renders one 8-bar loop into Float64 L/R buses (bass, pad, drums, fx, lead)
// then mixes, adds width, normalizes and encodes.
function renderTrack(idx) {
  const family = FAMILIES[idx % FAMILIES.length]
  const sub = Math.floor(idx / FAMILIES.length) // 0..11 within family
  const rng = mulberry32(idx * 7919 + 101)
  const bpm = family.bpm[Math.floor(rng() * family.bpm.length)]
  const root = family.roots[Math.floor(rng() * family.roots.length)]
  const step = 60 / bpm / 4
  const bars = 8
  const steps = bars * 16
  const dur = steps * step
  const n = Math.ceil(dur * SR)
  const L = new Float64Array(n)
  const R = new Float64Array(n)
  const bass = new Float64Array(n)
  const pad = new Float64Array(n)
  const lead = new Float64Array(n)
  const drums = new Float64Array(n)
  const fx = new Float64Array(n)

  const prog = family.prog.map(d => chordOf(root, d, family.scale))
  const barChord = (s) => prog[Math.floor(s / 16) % prog.length]
  const barAt = (s) => Math.floor(s / 16) % prog.length
  const st = (s) => Math.round(s * step * SR)

  const drumsPat = {
    tech:  { kick: [0, 4, 8, 12], snare: [], hat: [2, 6, 10, 14], hatOpen: [14] },
    lofi:  { kick: [0, 7, 10], snare: [4, 12], hat: [2, 4, 10, 12], hatOpen: [] },
    trap:  { kick: [0, 5, 10], snare: [8], hat: [0, 2, 4, 6, 8, 10, 12, 14], hatOpen: [15] },
    cinematic: { kick: [0, 8], snare: [], hat: [], hatOpen: [] },
  }[family.drums]

  // ---------------- drums ----------------
  for (let s = 0; s < steps; s++) {
    const t16 = s % 16
    const start = st(s)
    if (family.energy >= 0.5 && drumsPat.kick.some(g => g === t16)) oneShot(drums, start, 'kick', { v: family.key === 'action-energy' ? 1.1 : 0.9 })
    if (family.energy >= 0.5 && drumsPat.snare.some(g => g === t16)) oneShot(drums, start, 'snare', { v: family.key === 'action-energy' ? 0.85 : 0.7 })
    if (drumsPat.hat.some(g => g === t16)) oneShot(drums, start, 'hat', { v: 0.32 })
    if (drumsPat.hatOpen.some(g => g === t16)) oneShot(drums, start, 'hat', { v: 0.2, open: true })
  }
  // lofi swing hats + soft kick (deep lowpassed kick flavor already soft)
  if (family.key === 'emotional-story') {
    for (let s = 0; s < steps; s++) {
      const t16 = s % 16
      if (t16 === 2 || t16 === 6 || t16 === 10 || t16 === 14) oneShot(drums, st(s), 'hat', { v: 0.1, open: true })
    }
  }
  // action: hits every 2 bars (~4s) + snare rolls + riser into the loop
  if (family.key === 'action-energy') {
    for (let bar = 0; bar < bars; bar += 2) oneShot(fx, st(bar * 16), 'hit', { v: 1.0 })
    for (let s = steps - 16; s < steps; s += 2) oneShot(fx, st(s), 'snare', { v: 0.22 })
    addRiser(fx, st(steps - 16), step * 16, { v: 0.34 })
    oneShot(fx, st(0), 'crash', { v: 0.5 })
  }
  // luxury: slow boom every 2 bars + airy riser into loop
  if (family.key === 'luxury-future') {
    for (let bar = 0; bar < bars; bar += 2) oneShot(fx, st(bar * 16), 'boom', { v: 0.9 })
    addRiser(fx, st(steps - 16), step * 16, { v: 0.2 })
  }
  // tech: crash into loop point + soft riser
  if (family.key === 'cinematic-tech-reveal') {
    addRiser(fx, st(steps - 8), step * 8, { v: 0.24 })
    oneShot(fx, st(0), 'crash', { v: 0.4 })
  }
  // emotional: gentle vinyl crackle throughout (Pachai-style analog texture)
  if (family.key === 'emotional-story') {
    addNoise(pad, 0, dur, { volume: 0.016, decay: 999, color: 'pink' })
    for (let s = 0; s < steps; s += 4) {
      if (rng() < 0.5) addNoise(pad, st(s), 0.06, { volume: 0.12, decay: 0.02 })
    }
  }

  // ---------------- bass ----------------
  const bassPat = {
    'cinematic-tech-reveal': { grid: [0, 2, 5, 6, 10, 13], v: 0.5, shape: 'sine' },
    'emotional-story':       { grid: [0], v: 0.42, shape: 'sine' },
    'action-energy':         { grid: [0, 3, 6, 10], v: 0.95, shape: 'saw' },
    'luxury-future':         { grid: [0], v: 0.5, shape: 'sine' },
  }[family.key]
  for (let s = 0; s < steps; s++) {
    const t16 = s % 16
    if (!bassPat.grid.some(g => g === t16)) continue
    const ch = barChord(s)
    const f = freq(ch[0] - 12)
    const len = family.key === 'emotional-story' || family.key === 'luxury-future' ? step * 14 : step * 2.4
    addTone(bass, st(s), len, f, { shape: bassPat.shape, attack: 0.004, decay: len * 0.9, volume: bassPat.v })
  }
  lowpass(bass, 320)

  // ---------------- pad ----------------
  const padGain = { 'cinematic-tech-reveal': 0.14, 'emotional-story': 0.16, 'action-energy': 0.0, 'luxury-future': 0.2 }[family.key]
  if (padGain > 0) {
    const attack = family.key === 'luxury-future' ? 2.6 : 1.2
    for (let bar = 0; bar < bars; bar++) {
      const ch = prog[bar % prog.length]
      const start = st(bar * 16)
      const len = step * 16
      for (const degChord of ch) {
        const f = freq(degChord)
        addTone(pad, start, len, f, { shape: 'sine', attack, decay: len, volume: padGain * 0.9, detune: 0.003 })
        addTone(pad, start, len, f, { shape: 'sine', attack, decay: len, volume: padGain * 0.7, detune: -0.003 })
        addTone(pad, start, len, f * 2.01, { shape: 'sine', attack, decay: len, volume: padGain * 0.16 })
      }
    }
    lowpass(pad, family.key === 'luxury-future' ? 950 : 1600)
    // slow tremolo on emotional pads (breathing, warm)
    if (family.key === 'emotional-story') {
      for (let i = 0; i < n; i++) pad[i] *= 0.82 + 0.18 * Math.sin(2 * Math.PI * 0.18 * (i / SR))
      // "Rainy Season Memories" (Suno reference) — the FEELING, not the song:
      // tanpura-style drone (root + fifth) + soft rain texture + vocal-warm
      // pad shimmer. All generic Indian-ambient sonics, no melody content.
      const d1 = freq(root)
      const d2 = freq(root + 7)
      for (let i = 0; i < n; i++) {
        const t = i / SR
        const breath = 0.8 + 0.2 * Math.sin(2 * Math.PI * 0.11 * t)
        pad[i] += Math.sin(2 * Math.PI * d1 * t) * 0.028 * breath
        pad[i] += Math.sin(2 * Math.PI * d2 * t) * 0.022 * breath
        const vib = 0.018 * Math.sin(2 * Math.PI * 5.3 * t)
        pad[i] += Math.sin(2 * Math.PI * d1 * (1 + vib) * t) * 0.016 * breath
      }
      // rain: faint bandpassed pink noise with slow swells
      let rn = 0
      for (let i = 0; i < n; i++) {
        const t = i / SR
        rn = 0.985 * rn + 0.015 * (Math.random() * 2 - 1)
        const swell = 0.75 + 0.25 * Math.sin(2 * Math.PI * 0.07 * t + 1.2)
        pad[i] += rn * 0.09 * swell
      }
    }
    if (family.key === 'luxury-future') {
      // airy room breath across the loop point
      for (let i = 0; i < n; i++) {
        const t = i / SR
        pad[i] += (Math.random() * 2 - 1) * 0.004 * (0.5 + 0.5 * Math.sin(2 * Math.PI * 0.05 * t + 0.7))
      }
    }
  }

  // ---------------- lead / arps ----------------
  if (family.key === 'cinematic-tech-reveal') {
    const arpGates = [0, 5, 8, 10, 12, 15]
    for (let s = 0; s < steps; s++) {
      const t16 = s % 16
      if (!arpGates.includes(t16)) continue
      const ch = barChord(s)
      const deg = [0, 1, 2, 1][Math.floor(s / 16) % 4]
      addTone(lead, st(s), step * 0.7, freq(ch[deg] + 12), { shape: 'square', attack: 0.002, decay: 0.5, volume: 0.14 })
    }
    lowpass(lead, 2600)
  }
  if (family.key === 'emotional-story') {
    // sparse nostalgic melody line — always consonant, never a copied riff
    const melody = [0, -3, 2, -2, 3, 1, -1, 0]
    for (let bar = 0; bar < bars; bar++) {
      if (bar % 2 !== 0) continue
      const ch = prog[barAt(bar * 16)]
      const notes = 2
      for (let k = 0; k < notes; k++) {
        const s = bar * 16 + k * 8
        const deg = melody[(bar * 2 + k + sub) % melody.length]
        const f = freq(ch[((deg % 3) + 3) % 3] + 12)
        addTone(lead, st(s), step * 6, f, { shape: 'tri', attack: 0.02, decay: 4.5, volume: 0.2, detune: 0.001 })
        addTone(lead, st(s), step * 6, f, { shape: 'sine', attack: 0.02, decay: 4.5, volume: 0.24, detune: -0.002 })
      }
    }
  }
  if (family.key === 'luxury-future') {
    // sparse celesta-like sparkle in the final bars, octave shimmer
    for (let s = steps - 24; s < steps; s += 6) {
      const ch = barChord(s)
      addTone(lead, st(s), step * 2.4, freq(ch[2] + 24), { shape: 'tri', attack: 0.004, decay: 1.6, volume: 0.08 })
    }
  }
  if (family.key === 'action-energy') {
    // dark octave ostinato + driving eighth pulse
    for (let s = 0; s < steps; s += 2) {
      const ch = barChord(s)
      addTone(lead, st(s), step * 1.8, freq(ch[0] - 12 + 12), { shape: 'saw', attack: 0.004, decay: 1.2, volume: 0.16 })
    }
    for (let s = 0; s < steps; s++) {
      if (s % 2 !== 0) continue
      const ch = barChord(s)
      addTone(lead, st(s), step * 0.9, freq(ch[0] + 12), { shape: 'square', attack: 0.002, decay: 0.6, volume: 0.1 })
    }
    lowpass(lead, 1800)
  }

  // ---------------- mix ----------------
  for (let i = 0; i < n; i++) {
    L[i] = drums[i] + bass[i] * 1.6 + pad[i] + lead[i] + fx[i]
    R[i] = L[i]
  }
  // width: short Haas smear, low gain
  const drift = Math.round(SR * 0.011)
  for (let i = drift; i < n; i++) {
    R[i] += L[i - drift] * 0.16
    L[i] += R[i - drift] * 0.16
  }
  // Consistent perceptual level: normalize to a fixed RMS target (-15.5),
  // works identically for dense (action/tech) and sparse (emotional) mixes
  // because it's computed on the actual PCM, not a gated meter.
  let sum = 0
  for (let i = 0; i < n; i++) sum += L[i] * L[i] + R[i] * R[i]
  const rms = Math.sqrt(sum / (2 * n))
  const rmsDB = 20 * Math.log10(rms + 1e-9)
  const g = Math.min(30, Math.max(0.02, Math.pow(10, (-12.5 - rmsDB) / 20)))
  for (let i = 0; i < n; i++) { L[i] *= g; R[i] *= g }
  let peak = 0
  for (let i = 0; i < n; i++) peak = Math.max(peak, Math.abs(L[i]), Math.abs(R[i]))
  if (peak > 0.891) {
    const p = 0.891 / peak
    for (let i = 0; i < n; i++) { L[i] *= p; R[i] *= p }
  }
  if (process.env.DEBUG_RMS === '1') console.log(`[RMS] idx=${idx} fam=${family.key} bpm=${bpm} rmsDB=${rmsDB.toFixed(1)} g=${g.toFixed(3)} peak=${(peak * (peak > 0.891 ? 0.891 / peak : 1)).toFixed(3)} finite=${Number.isFinite(rms)}`)

  if (process.env.DEBUG_RMS === '1' && !Number.isFinite(rms)) {
    for (const [name, arr] of [['drums', drums], ['bass', bass], ['pad', pad], ['lead', lead], ['fx', fx]]) {
      let bad = 0, maxAbs = 0
      for (let i = 0; i < n; i++) {
        const a = Math.abs(arr[i])
        if (a > maxAbs) maxAbs = a
        if (!Number.isFinite(arr[i]) && bad === 0) bad = arr[i]
      }
      console.log(`  bus ${name}: bad=${bad} maxAbs=${maxAbs.toExponential(2)}`)
    }
  }

  const wav = encodeWav(Float32Array.from(L), Float32Array.from(R))
  const file = path.join(OUT_DIR, `nm-track-${String(idx + 1).padStart(2, '0')}-${family.key}-${bpm}.mp3`)
  const tmpWav = file.replace('.mp3', '.wav')
  fs.writeFileSync(tmpWav, wav)
  return { tmpWav, file, family: family.key, bpm, root }
}

function encodeWav(L, R) {
  const n = L.length
  const buf = Buffer.alloc(44 + n * 4)
  buf.write('RIFF', 0)
  buf.writeUInt32LE(36 + n * 4, 4)
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

function encodeTrack(job) {
  const out = job.file
  // Cinematic echo-space bus + safety limiter. Level is already set by the
  // RMS-target normalize in renderTrack, so this pass is purely spatial.
  const chain = '[0:a]aformat=channel_layouts=stereo,aecho=1.0:0.62:90|132|188:0.15|0.11|0.07,alimiter=limit=0.95[a]'
  execFileSync('ffmpeg', ['-y', '-i', job.tmpWav, '-filter_complex', chain, '-map', '[a]', '-c:a', 'libmp3lame', '-b:a', '192k', out], { stdio: 'pipe', timeout: 90000 })
  fs.unlinkSync(job.tmpWav)
}

function durationOf(file) {
  try {
    const j = execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'json', file], { stdio: 'pipe' })
    return Math.round(JSON.parse(j.toString()).format.duration * 10) / 10
  } catch { return null }
}

function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true })
  console.log(`Rendering ${COUNT} cinematic tracks → ${OUT_DIR}${familyOnly ? ` (family: ${familyOnly})` : ''}`)
  const jobs = []
  for (let i = 0; i < COUNT; i++) {
    const fam = familyOnly ? familyOnly : FAMILIES[i % FAMILIES.length].key
    if (familyOnly && fam !== familyOnly) continue
    const idx = familyOnly ? i : i
    try {
      const tr = renderTrack(idx)
      jobs.push(tr)
    } catch (e) { console.error(`track ${idx + 1} synth failed: ${e.message}`) }
  }
  for (const j of jobs) {
    try { encodeTrack(j); console.log(`  ✓ ${path.basename(j.file)} (${j.bpm}bpm, ${j.root})`) }
    catch (e) { console.error(`  encode failed: ${e.message}`) }
  }

  // write manifest (MusicLibraryMemory)
  const tracks = jobs.map(j => ({
    index: parseInt(path.basename(j.file).match(/^nm-track-(\d+)/)?.[1] || '0', 10),
    family: j.family,
    bpm: j.bpm,
    root: j.root,
    file: path.basename(j.file),
    duration: durationOf(j.file),
  }))
  const manifest = {
    engine: 'newsmonster-musicgen-v2',
    total: tracks.length,
    normalization: 'I=-14:TP=-1.5:LRA=11',
    families: Object.fromEntries(FAMILIES.map(f => [f.key, {
      bpm: f.bpm, emotion: f.emotion, mood: f.mood, energy: f.energy,
      tracks: tracks.filter(t => t.family === f.key).length,
    }])),
    tracks,
  }
  fs.writeFileSync(path.join(OUT_DIR, 'manifest.json'), JSON.stringify(manifest, null, 2))
  console.log(`Manifest: ${path.join(OUT_DIR, 'manifest.json')} (${tracks.length} tracks)`)
  console.log('Done.')
}
main()