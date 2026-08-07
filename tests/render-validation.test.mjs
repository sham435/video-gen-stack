import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, existsSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { execFileSync } from 'child_process'
import { validateOutput } from '../src/video/validateOutput.mjs'

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