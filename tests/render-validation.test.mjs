import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, existsSync, rmSync, readFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { execFileSync } from 'child_process'
import { validateOutput, validateRenderOutput } from '../src/video/validateOutput.mjs'
import { PublishPreflight } from '../src/preflight/PublishPreflight.mjs'

function makeFixtureDir() {
  return mkdtempSync(join(tmpdir(), 'render-validation-'))
}

// Build a tiny but structurally-valid mp4 (video + audio) via ffmpeg.
function makeValidMp4(dir) {
  const out = join(dir, 'valid.mp4')
  execFileSync('ffmpeg', [
    '-y',
    '-f', 'lavfi', '-i', 'testsrc2=s=1280x1280:d=3:r=15',
    '-f', 'lavfi', '-i', 'sine=frequency=440:duration=3',
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p',
    '-c:a', 'aac', '-shortest',
    out,
  ], { stdio: 'ignore' })
  return out
}

function makeCorruptMp4(dir) {
  const out = join(dir, 'corrupt.mp4')
  writeFileSync(out, Buffer.alloc(4096, 0x00))
  return out
}

// Take a valid mp4 and physically truncate its tail — the exact failure class
// from production ("moov atom not found"): ffmpeg exited 0 earlier, the file
// is on disk, but the index atom is gone so nothing can consume it.
function makeTruncatedMp4(dir) {
  const src = makeValidMp4(dir)
  const original = readFileSync(src)
  const cut = original.subarray(0, Math.floor(original.length * 0.7))
  const out = join(dir, 'truncated.mp4')
  writeFileSync(out, cut)
  return out
}

// A video-only render — no audio stream at all.
function makeVideoOnlyMp4(dir) {
  const out = join(dir, 'video-only.mp4')
  execFileSync('ffmpeg', [
    '-y',
    '-f', 'lavfi', '-i', 'testsrc2=s=1280x1280:d=3:r=15',
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-an',
    out,
  ], { stdio: 'ignore' })
  return out
}

test('returns ok=false when path is missing', async () => {
  const res = await validateOutput(undefined)
  assert.equal(res.ok, false)
  assert.ok(res.errors.includes('VIDEO_PATH_MISSING'))
})

test('returns ok=false when file does not exist', async () => {
  const res = await validateOutput('/no/such/file.mp4')
  assert.equal(res.ok, false)
  assert.ok(res.errors.includes('FILE_MISSING'))
})

test('rejects a corrupt (missing moov) file', async () => {
  const dir = makeFixtureDir()
  try {
    const file = makeCorruptMp4(dir)
    const res = await validateOutput(file)
    assert.equal(res.ok, false)
    assert.ok(res.errors.includes('MOOV_ATOM_MISSING'))
    assert.ok(res.errors.some((e) => e.startsWith('FFPROBE_FAILED')))
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('returns ok=true for a valid mp4 with video and audio', async () => {
  let dir
  try {
    dir = makeFixtureDir()
    const file = makeValidMp4(dir)
    assert.ok(existsSync(file))
    const res = await validateOutput(file)
    assert.equal(res.ok, true, JSON.stringify(res.errors))
    assert.deepEqual(res.errors, [])
  } finally {
    if (dir) rmSync(dir, { recursive: true, force: true })
  }
})

test('flags a file that is too small', async () => {
  const dir = makeFixtureDir()
  try {
    const file = join(dir, 'tiny.mp4')
    writeFileSync(file, Buffer.alloc(1024, 0x41))
    const res = await validateOutput(file, { minSize: 1024 * 100 })
    assert.equal(res.ok, false)
    assert.ok(res.errors.some((e) => e.startsWith('FILE_TOO_SMALL')))
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('validateRenderOutput is the canonical export and validates a valid mp4', async () => {
  const dir = makeFixtureDir()
  try {
    const file = makeValidMp4(dir)
    const res = await validateRenderOutput(file)
    assert.equal(res.ok, true, JSON.stringify(res.errors))
    assert.ok(res.diagnostics.duration > 0, 'diagnostics carries duration')
    assert.equal(res.diagnostics.hasVideo, true)
    assert.equal(res.diagnostics.hasAudio, true)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('rejects a truncated mp4 (tail cut — moov atom gone)', async () => {
  const dir = makeFixtureDir()
  try {
    const file = makeTruncatedMp4(dir)
    const res = await validateRenderOutput(file)
    assert.equal(res.ok, false, 'truncated render must not pass')
    assert.ok(
      res.errors.some((e) => e.startsWith('FFPROBE_FAILED') || e.startsWith('ZERO_DURATION')),
      `expected probe failure, got ${res.errors.join(' | ')}`
    )
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('video-only render fails when audio is required, passes when not', async () => {
  const dir = makeFixtureDir()
  try {
    const file = makeVideoOnlyMp4(dir)
    const strict = await validateRenderOutput(file, { requireAudio: true })
    assert.equal(strict.ok, false)
    assert.ok(strict.errors.includes('NO_AUDIO_STREAM'))
    const lenient = await validateRenderOutput(file, { requireAudio: false })
    assert.equal(lenient.ok, true, JSON.stringify(lenient.errors))
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('PublishPreflight blocks an invalid render, not just a missing file', async () => {
  const dir = makeFixtureDir()
  try {
    const corrupt = join(dir, 'corrupt.mp4')
    writeFileSync(corrupt, Buffer.alloc(4096, 0x00))
    const res = await PublishPreflight.run({}, { outDir: dir, videoName: 'corrupt.mp4', bypassYoutube: true })
    assert.ok(res.errors.length > 0, 'corrupt render must produce publish errors')
    assert.ok(
      res.errors.some((e) => e.startsWith('VIDEO_INVALID:') && (e.includes('MOOV_ATOM_MISSING') || e.includes('FFPROBE_FAILED'))),
      `expected VIDEO_INVALID probe/moov code, got ${res.errors.join(' | ')}`
    )
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('PublishPreflight passes a valid render', async () => {
  const dir = makeFixtureDir()
  try {
    const file = makeValidMp4(dir)
    const res = await PublishPreflight.run({}, { outDir: dir, videoName: 'valid.mp4', bypassYoutube: true })
    assert.deepEqual(res.errors, [])
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('PublishPreflight reports VIDEO_MISSING when no file exists', async () => {
  const dir = makeFixtureDir()
  try {
    const res = await PublishPreflight.run({}, { outDir: dir, videoName: 'nope.mp4', bypassYoutube: true })
    assert.deepEqual(res.errors, ['VIDEO_MISSING'])
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})