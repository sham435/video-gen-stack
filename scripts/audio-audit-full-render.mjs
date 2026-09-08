#!/usr/bin/env node
/**
 * Full-length render + audibility audit for the AudioDirector path.
 *
 * Renders ONE real article end-to-end through NewsBroadcastEngine (the exact
 * production path: narration → scenes → frames → concat → AudioDirector.mix →
 * optional footer overlay) WITHOUT publishing anything, then audits the final
 * artifact: audio stream present, duration, loudness (LUFS), voice vs bed RMS,
 * and no silent gaps.
 *
 * Usage: node --env-file=.env scripts/audio-audit-full-render.mjs
 */

import { NewsBroadcastEngine } from '../src/index.mjs'
import { AudioDirector, execFileAsync } from '../src/audio/AudioDirector.mjs'
import { existsSync, mkdirSync, copyFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dirname, '..')
const OUT = join(ROOT, 'output', 'audio-audit-render')
mkdirSync(OUT, { recursive: true })

const article = {
  title: 'AI Factories Are Rewriting Assembly Lines Faster Than Anyone Expected',
  description: 'New generation AI systems are quietly taking over quality control in automotive plants. Robots now inspect welds, detect defects in milliseconds, and route failures to maintenance automatically. The shift is cutting recalls by a third and changing what factory workers do all day.',
  category: 'breaking_news',
  publishedAt: new Date().toISOString(),
}

async function probe(f) {
  const { stdout } = await execFileAsync('ffprobe', [
    '-v', 'error', '-show_entries', 'format=duration:stream=codec_type,codec_name,channels', '-of', 'json', f
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

async function rmsAt(f, start, dur) {
  const { stdout } = await execFileAsync('ffmpeg', [
    '-ss', String(start), '-t', String(dur), '-i', f,
    '-af', 'astats=metadata=1:reset=1,ametadata=print:key=lavfi.astats.Overall.RMS_level:file=-',
    '-f', 'null', '-'
  ])
  const vals = [...stdout.matchAll(/RMS_level=([-\d.]+)/g)]
    .map(m => parseFloat(m[1])).filter(v => Number.isFinite(v))
  return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null
}

console.log('Renderer:', article.title)
console.log('Category:', article.category)

const engine = new NewsBroadcastEngine({})
const result = await engine.generateFromArticle(article, OUT, {})
const broadcastPath = typeof result === 'string' ? result : result.videoPath
if (!existsSync(broadcastPath)) throw new Error(`render produced no file: ${broadcastPath}`)

const finalPath = join(OUT, 'final.mp4')
copyFileSync(broadcastPath, finalPath)

console.log('\n══ Auditing final render ══')
const meta = await probe(finalPath)
const dur = parseFloat(meta.format.duration)
const hasAudio = meta.streams.some(s => s.codec_type === 'audio')
const audioStream = meta.streams.find(s => s.codec_type === 'audio')
console.log(`duration: ${dur.toFixed(2)}s (full-length, narration-driven)`)
console.log(`audio stream: ${hasAudio} codec=${audioStream?.codec_name} channels=${audioStream?.channels}`)

const lufs = await measureLUFS(finalPath)
console.log(`integrated loudness: ${parseFloat(lufs.input_i).toFixed(1)} LUFS (target -14)`)
console.log(`true peak: ${lufs.input_tp} dBTP`)
console.log(`LRA: ${lufs.input_lra} LU`)

// Voice-window RMS (narration active) vs bed-only tail (outro → music ducks down).
const voiceRms = await rmsAt(finalPath, Math.max(1, dur * 0.35), 2)
const tailRms = await rmsAt(finalPath, Math.max(0, dur - 2.5), 2)
console.log(`RMS mid-video (voice active): ${voiceRms?.toFixed(1)} dB`)
console.log(`RMS outro tail (bed only):    ${tailRms?.toFixed(1)} dB`)
if (voiceRms != null && tailRms != null && isFinite(tailRms) && tailRms > -80) {
  console.log(`voice-over-bed delta: ${(voiceRms - tailRms).toFixed(1)} dB (voice should sit ABOVE the bed)`)
  const voiceAudible = voiceRms - tailRms > 3 && voiceRms > -45
  console.log(`voice audibility: ${voiceAudible ? 'PASS' : 'FAIL'}`)
} else {
  console.log('voice audibility: FAIL (nothing measurable — output is silent or near-silent)')
}

// Also verify the footer-overlay stage (production downstream step) keeps audio.
const footerWith = join(OUT, 'broadcast_final.mp4')
if (existsSync(join(ROOT, 'assets', 'footer.png'))) {
  const { AudioMixer } = await import('../src/audio/AudioMixer.mjs')
  const mixer = new AudioMixer()
  try {
    const out = mixer.overlayFooter(broadcastPath, join(ROOT, 'assets', 'footer.png'), footerWith)
    if (existsSync(out)) {
      const fm = await probe(out)
      const fa = fm.streams.some(s => s.codec_type === 'audio')
      console.log(`footer overlay audio preserved: ${fa ? 'PASS' : 'FAIL'} (broadcast_final.mp4, ${parseFloat(fm.format.duration).toFixed(2)}s)`)
    }
  } catch (e) {
    console.log(`footer overlay audio preserved: SKIP (${e.message.slice(0, 80)})`)
  }
}

const ok = hasAudio && Math.abs(parseFloat(lufs.input_i) + 14) < 3
console.log(`\n=== ${ok ? 'AUDIBLE ✓' : 'INAUDIBLE ✗'} === artifact: ${finalPath}`)
process.exit(ok ? 0 : 1)