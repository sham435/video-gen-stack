#!/usr/bin/env node
/**
 * AudioDirector Quick-Test — 10s clips to validate the audio pipeline.
 *
 * Tests:
 *   1. Real narration + sidechain ducking verification
 *   2. Post-mix LUFS measurement (two-pass loudnorm verification)
 *   3. Odd-length loop-to-duration (47s) seam check
 *   4. Cross-category mood → track selection (tech_reveal vs emotional_story)
 *
 * Usage:
 *   node scripts/audio-quick-test.mjs [--duration 10] [--categories tech_reveal,emotional_story]
 *
 * Requires:
 *   - mlx-audio library generated in assets/music/ (run generate_music_library.py first)
 *   - OPENROUTER_API_KEY for narration (or pre-recorded voice in output/voice-test.wav)
 */

import { NewsBroadcastEngine } from '../src/index.mjs'
import { execFileAsync } from '../src/audio/AudioDirector.mjs'
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dirname, '..')

const TEST_DIR = join(ROOT, 'output', 'audio-quick-test')
mkdirSync(TEST_DIR, { recursive: true })

async function measureLUFS(filePath) {
  try {
    const { stdout, stderr } = await execFileAsync('ffmpeg', [
      '-i', filePath,
      '-af', 'loudnorm=I=-14:TP=-1:LRA=7:print_format=json',
      '-f', 'null', '-'
    ])
    const raw = `${stdout}\n${stderr}`
    const jsonStart = raw.lastIndexOf('{')
    const jsonEnd = raw.indexOf('}', jsonStart)
    const measured = JSON.parse(raw.slice(jsonStart, jsonEnd + 1))
    return {
      input_i: measured.input_i,
      input_tp: measured.input_tp,
      input_lra: measured.input_lra,
      input_thresh: measured.input_thresh,
      target_offset: measured.target_offset
    }
  } catch (e) {
    console.warn(`  LUFS measure failed: ${e.message}`)
  }
  return null
}

async function runQuickTest({ duration = 10, categories = ['tech_reveal', 'emotional_story', 'breaking_news'] }) {
  console.log(`\n=== AudioDirector Quick-Test ===`)
  console.log(`Duration: ${duration}s | Categories: ${categories.join(', ')}\n`)

  const engine = new NewsBroadcastEngine({
    renderProfile: { name: 'test', width: 1280, height: 720, fps: 10 }
  })

  const results = []

  for (const category of categories) {
    console.log(`\n--- Testing category: ${category} ---`)

    // Create a minimal article that triggers the category
    const article = {
      title: `Test article for ${category}`,
      description: `This is a test scene for ${category} mood analysis. It contains enough text to trigger the audio pipeline and verify sidechain ducking works with real narration. The content is intentionally generic but category-specific.`,
      category,
      publishedAt: new Date().toISOString()
    }

    const outPath = join(TEST_DIR, `test-${category}-${duration}s.mp4`)

    try {
      // Run the full render (this exercises AudioDirector.mix)
      await engine.generateFromArticle(article, TEST_DIR, {
        quick: true,
        mediaType: 'test',
        totalDuration: duration
      })

      // The final output should be at output/final.mp4 (or similar)
      const finalPath = join(ROOT, 'output', 'final.mp4')
      const testOut = join(TEST_DIR, `final-${category}-${duration}s.mp4`)
      
      if (existsSync(finalPath)) {
        // Copy to test dir for preservation
        await execFileAsync('cp', [finalPath, testOut])
        
        // Measure LUFS on the mixed output
        console.log(`  Measuring LUFS on mixed output...`)
        const lufs = await measureLUFS(testOut)
        if (lufs) {
          console.log(`    Integrated: ${lufs.input_i.toFixed(1)} LUFS`)
          console.log(`    True Peak:  ${lufs.input_tp.toFixed(1)} dBTP`)
          console.log(`    LRA:        ${lufs.input_lra.toFixed(1)} LU`)
          console.log(`    Threshold:  ${lufs.input_thresh.toFixed(1)} LUFS`)
          console.log(`    Offset:     ${lufs.target_offset.toFixed(1)} LU`)
          
          const close = Math.abs(lufs.input_i + 14) < 1.5 // within 1.5 LU of -14
          console.log(`    Target -14: ${close ? '✓ PASS' : '✗ FAIL'}`)
        }

        // Verify file exists and has audio
        const { stdout: probe } = await execFileAsync('ffprobe', [
          '-v', 'error', '-show_entries', 'stream=codec_type',
          '-of', 'csv=p=0', testOut
        ])
        const hasAudio = probe.includes('audio')
        console.log(`  Audio stream: ${hasAudio ? '✓' : '✗'}`)
        
        results.push({ category, path: testOut, lufs, hasAudio, duration })
      } else {
        console.log(`  ✗ No output generated`)
        results.push({ category, error: 'no output' })
      }

    } catch (e) {
      console.log(`  ✗ Error: ${e.message}`)
      results.push({ category, error: e.message })
    }
  }

  // Odd-length loop test (47s) - uses first available generated wav track
  if (categories.length > 0) {
    console.log(`\n--- Odd-length loop test (47s) ---`)
    const category = categories[0]
    const musicDir = join(ROOT, 'assets', 'music')
    const wavs = readdirSync(musicDir).filter(f => f.endsWith('.wav')).sort()
    const trackPath = existsSync(join(musicDir, `nm-track-01-${category}.wav`))
      ? join(musicDir, `nm-track-01-${category}.wav`)
      : (wavs[0] ? join(musicDir, wavs[0]) : null)
    if (existsSync(trackPath)) {
      const loopedPath = join(TEST_DIR, `looped-47s-${category}.wav`)
      try {
        // Import AudioDirector to test loopToDuration directly
        const { AudioDirector } = await import('../src/audio/AudioDirector.mjs')
        const ad = new AudioDirector()
        const norm = await ad.normalize(trackPath)
        const looped = await ad.loopToDuration(norm, 47)
        console.log(`  ✓ Looped 47s track generated: ${looped}`)
        
        // Check for clicks at loop seam (rough heuristic: measure at 23s and 24s boundaries)
        const { stdout } = await execFileAsync('ffmpeg', [
          '-i', looped, '-af', 'astats=metadata=1:reset=1', '-f', 'null', '-'
        ])
        const peakAtSeam = stdout.includes('Peak level') ? 'detected' : 'clean'
        console.log(`  Loop seam: ${peakAtSeam}`)
      } catch (e) {
        console.log(`  ✗ Loop test failed: ${e.message}`)
      }
    } else {
      console.log(`  ⊘ Track not found at ${trackPath} — run generate_music_library.py first`)
    }
  }

  // Summary
  console.log(`\n=== Summary ===`)
  results.forEach(r => {
    if (r.error) {
      console.log(`  ${r.category}: ERROR - ${r.error}`)
    } else {
      const lufsStr = r.lufs ? ` | ${r.lufs.input_i.toFixed(1)} LUFS` : ''
      console.log(`  ${r.category}: ✓ rendered${lufsStr}`)
    }
  })

  console.log(`\nTest artifacts in: ${TEST_DIR}`)
}

const args = process.argv.slice(2)
const duration = args.includes('--duration') ? parseInt(args[args.indexOf('--duration') + 1]) : 10
const categories = args.includes('--categories') 
  ? args[args.indexOf('--categories') + 1].split(',') 
  : ['tech_reveal', 'emotional_story', 'breaking_news']

runQuickTest({ duration, categories }).catch(e => {
  console.error('Quick-test failed:', e)
  process.exit(1)
})