// quote-format tests — "Shelter in Rain" engagement-quote format.
//
// Coverage:
//   - Timeline / flash-reveal envelope math (blur-in, hold, blur-out).
//   - QuoteLineAgent dedup: recorded line-4 values are never regenerated;
//     LLM retry loop produces a unique line; deterministic no-provider pool.
//   - Renderer: a frame renders as a valid PNG; flash-reveal states differ.
//   - Engine fail-closed uniqueness: second run with the same line-4 OR the
//     same scene images is rejected through the SHARED ledger (script exact
//     dup + 7-day image quarantine); a fully distinct run passes.
//
// Network-free by default. Set QUOTE_SMOKE=1 to run the full render+ffmpeg
// end-to-end path (slower, requires ffmpeg on PATH).

import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'

import { AssetRegistry } from '../src/uniqueness/AssetRegistry.mjs'
import { ImageDatabase } from '../src/assets/ImageDatabase.mjs'
import { QuoteLineAgent, QUOTE_LINES_FIXED, FALLBACK_POOL } from '../src/formats/quote/QuoteLineAgent.mjs'
import { QuoteRenderer, buildTimeline, lineState } from '../src/formats/quote/QuoteRenderer.mjs'
import { QuoteVideoEngine } from '../src/formats/quote/QuoteVideoEngine.mjs'

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'quote-test-'))
}

function makeRegistry(file = path.join(tmpDir(), 'registry.json')) {
  return new AssetRegistry({ filePath: file })
}

function makeDb(file = path.join(tmpDir(), 'img.sqlite')) {
  return new ImageDatabase(file)
}

const H1 = 'a'.repeat(64)
const H2 = 'b'.repeat(64)
const H3 = 'c'.repeat(64)
const H4 = 'd'.repeat(64)

function fakeVisuals() {
  return [
    [{ url: 'https://fake.test/one.jpg', sha256: H1, keyword: 'rain' }],
    [{ url: 'https://fake.test/two.jpg', sha256: H2, keyword: 'shelter' }],
    [{ url: 'https://fake.test/three.jpg', sha256: H3, keyword: 'crowd' }],
    [{ url: 'https://fake.test/four.jpg', sha256: H4, keyword: 'hope' }],
  ]
}

function fakeVisualsAlt() {
  return [
    [{ url: 'https://fake.test/a.jpg', sha256: '1'.repeat(64), keyword: 'rain' }],
    [{ url: 'https://fake.test/b.jpg', sha256: '2'.repeat(64), keyword: 'shelter' }],
    [{ url: 'https://fake.test/c.jpg', sha256: '3'.repeat(64), keyword: 'crowd' }],
    [{ url: 'https://fake.test/d.jpg', sha256: '4'.repeat(64), keyword: 'hope' }],
  ]
}

// ── Timeline / flash-reveal ────────────────────────────────────────────

test('quote: flash-reveal envelope ramps blur in, holds sharp, blurs out', () => {
  const { windows, totalDuration } = buildTimeline()
  assert.equal(windows.length, 4)
  assert.ok(totalDuration > 10 && totalDuration < 20, `totalDuration=${totalDuration}`)

  const w = windows[0]
  const midIn = w.start + w.phaseIn * 0.5
  const sIn = lineState(w, midIn)
  assert.ok(sIn.visible && sIn.blur > 4 && sIn.blur < 12, `blur-in state ${JSON.stringify(sIn)}`)
  assert.ok(sIn.alpha > 0 && sIn.alpha < 1)

  const sHold = lineState(w, w.start + w.phaseIn + 0.2)
  assert.equal(sHold.alpha, 1)
  assert.equal(sHold.blur, 0)

  const sOut = lineState(w, w.end - w.phaseOut * 0.5)
  assert.ok(sOut.blur > 4 && sOut.alpha < 0.6, `blur-out state ${JSON.stringify(sOut)}`)

  const sBefore = lineState(w, w.start - 0.01)
  assert.equal(sBefore.visible, false)
})

test('quote: line 4 holds longest (comment driver)', () => {
  const { windows } = buildTimeline()
  const holds = windows.map(w => w.hold)
  assert.ok(holds[3] === Math.max(...holds), `hold=${holds}`)
})

// ── QuoteLineAgent dedup ───────────────────────────────────────────────

test('quote: fixed lines are exactly the spec constants', () => {
  assert.deepEqual(QUOTE_LINES_FIXED, [
    'The power of never giving up.',
    'Have you ever built shelter in rain?',
    'Comment your story.',
  ])
})

test('quote: recorded line-4 is never regenerated (no provider → seeded pool)', async () => {
  const registry = makeRegistry()
  const agent = new QuoteLineAgent(null, registry)
  const first = await agent.generate({ excludeJobId: 'job-1', topic: 'rain' })
  assert.ok(first.line4.length > 0)
  assert.equal(first.source, 'fallback')

  agent.record(first.line4, { jobId: 'job-1', videoId: 'v1', title: first.line4 })

  const agent2 = new QuoteLineAgent(null, registry)
  const second = await agent2.generate({ excludeJobId: 'job-2', topic: 'rain' })
  assert.notEqual(second.line4, first.line4, 'must not repeat a recorded line')
  assert.ok(second.line4.length > 0)
})

test('quote: LLM agent retries when candidate duplicates a recorded line', async () => {
  const registry = makeRegistry()
  const LINE = 'What kept you going is already used.'
  const a0 = new QuoteLineAgent(null, registry)
  a0.record(LINE, { jobId: 'seed', videoId: 'v-seed', title: LINE })

  let calls = 0
  const fakeProvider = {
    async generate() {
      calls += 1
      return JSON.stringify({ line4: calls === 1 ? LINE : 'Brand new closing line four here.' })
    },
  }
  const agent = new QuoteLineAgent(fakeProvider, registry)
  const r = await agent.generate({ excludeJobId: 'job-9', attempts: 3 })
  assert.equal(r.source, 'llm')
  assert.equal(r.line4, 'Brand new closing line four here.')
  assert.ok(calls >= 2, `expected the retry loop to run, got ${calls} LLM call(s)`)
})

test('quote: fails closed when every option is a duplicate', async () => {
  const registry = makeRegistry()
  const a0 = new QuoteLineAgent(null, registry)
  for (let i = 0; i < FALLBACK_POOL.length; i++) {
    a0.record(FALLBACK_POOL[i], { jobId: `seed-${i}`, videoId: 'v-seed', title: FALLBACK_POOL[i] })
  }
  // LLM keeps returning a recorded line, and the entire fallback pool is
  // recorded too → no unique line-4 can exist → must throw (never duplicate).
  const stuck = new QuoteLineAgent({
    async generate() { return JSON.stringify({ line4: FALLBACK_POOL[0] }) },
  }, registry)
  await assert.rejects(
    () => stuck.generate({ excludeJobId: 'last', attempts: 1 }),
    /no unique line-4 available/
  )
})

// ── Renderer ───────────────────────────────────────────────────────────

test('quote: a single frame renders as a valid PNG buffer', async () => {
  const renderer = new QuoteRenderer()
  const scenes = [
    { image: null, index: 0 },
    { image: null, index: 1 },
    { image: null, index: 2 },
    { image: null, index: 3 },
  ]
  const buf = await renderer.renderFrame(scenes, [...QUOTE_LINES_FIXED, 'What keeps you going?'], 6.0)
  assert.ok(buf.length > 100)
  assert.equal(buf.subarray(0, 8).toString('hex'), '89504e470d0a1a0a', 'PNG signature')
})

test('quote: frames in blur-in vs hold differ visually', async () => {
  const renderer = new QuoteRenderer()
  const scenes = [{ image: null }, { image: null }, { image: null }, { image: null }]
  const lines = [...QUOTE_LINES_FIXED, 'What keeps you going?']
  const w = buildTimeline().windows[0]
  const tIn = w.start + w.phaseIn * 0.5
  const tHold = w.start + w.phaseIn + 0.2
  const bufIn = await renderer.renderFrame(scenes, lines, tIn)
  const bufHold = await renderer.renderFrame(scenes, lines, tHold)
  assert.notDeepEqual(bufHold, bufIn, 'blur-in frame must differ from hold frame')
})

// ── Engine fail-closed uniqueness (shared ledger, no network) ─────────

test('quote: same line-4 across runs is rejected through the shared ledger', async () => {
  const dir = tmpDir()
  const registry = makeRegistry(path.join(dir, 'registry.json'))
  const db = makeDb(path.join(dir, 'img.sqlite'))
  const LINE = 'What is your shelter story?'

  const engine1 = new QuoteVideoEngine({ registry, imageDb: db, fakeVisuals: fakeVisuals() })
  const r1 = await engine1.run({ skipRender: true, fakeLine4: LINE, jobId: 'q1', videoId: 'v-q1' })
  assert.equal(r1.uniqueness.gatePassed, true)
  assert.equal(r1.videoPath, null)
  // committed: script recorded in the ledger
  assert.ok(registry.state.publishedVideos.some(v => v.scriptText === LINE))

  const engine2 = new QuoteVideoEngine({ registry, imageDb: db, fakeVisuals: fakeVisuals() })
  await assert.rejects(
    () => engine2.run({ skipRender: true, fakeLine4: LINE, jobId: 'q2', videoId: 'v-q2' }),
    /uniqueness gate FAILED/
  )
})

test('quote: same images within 7 days are quarantined even with a fresh line-4', async () => {
  const dir = tmpDir()
  const registry = makeRegistry(path.join(dir, 'registry.json'))
  const db = makeDb(path.join(dir, 'img.sqlite'))

  const engine1 = new QuoteVideoEngine({ registry, imageDb: db, fakeVisuals: fakeVisuals() })
  await engine1.run({ skipRender: true, fakeLine4: 'First unique closing line one.', jobId: 'q1', videoId: 'v-q1' })

  // Different line-4 (passes script gate) but SAME image hashes → quarantine.
  const engine2 = new QuoteVideoEngine({ registry, imageDb: db, fakeVisuals: fakeVisuals() })
  await assert.rejects(
    () => engine2.run({ skipRender: true, fakeLine4: 'Second different closing line two.', jobId: 'q2', videoId: 'v-q2' }),
    /uniqueness gate FAILED/
  )
})

test('quote: fully distinct run passes all scopes', async () => {
  const dir = tmpDir()
  const registry = makeRegistry(path.join(dir, 'registry.json'))
  const db = makeDb(path.join(dir, 'img.sqlite'))

  const engine1 = new QuoteVideoEngine({ registry, imageDb: db, fakeVisuals: fakeVisuals() })
  await engine1.run({ skipRender: true, fakeLine4: 'First unique closing line one.', jobId: 'q1', videoId: 'v-q1' })

  const engine2 = new QuoteVideoEngine({ registry, imageDb: db, fakeVisuals: fakeVisualsAlt() })
  const r2 = await engine2.run({ skipRender: true, fakeLine4: 'Second different closing line two.', jobId: 'q2', videoId: 'v-q2' })
  assert.equal(r2.uniqueness.gatePassed, true)
  assert.equal(r2.line4, 'Second different closing line two.')
})

test('quote: reserved assets are released on render failure', async () => {
  const dir = tmpDir()
  const registry = makeRegistry(path.join(dir, 'registry.json'))
  const db = makeDb(path.join(dir, 'img.sqlite'))
  const engine = new QuoteVideoEngine({ registry, imageDb: db, fakeVisuals: fakeVisuals() })

  // Force a post-reserve failure: renderer that throws.
  engine.renderer = {
    async renderAndAssemble() { throw new Error('boom') },
  }
  await assert.rejects(() => engine.run({ skipRender: false, fakeLine4: 'Fail-safe closing line four.', jobId: 'qfail' }), /boom/)
  assert.equal(registry.state.reservations['qfail'], undefined, 'reservation must be released')
})

// ── Optional end-to-end smoke (QUOTE_SMOKE=1, needs ffmpeg) ────────────

test('quote: end-to-end render + assemble smoke (QUOTE_SMOKE=1 only)', { skip: process.env.QUOTE_SMOKE !== '1' }, async () => {
  const dir = tmpDir()
  const registry = makeRegistry(path.join(dir, 'registry.json'))
  const db = makeDb(path.join(dir, 'img.sqlite'))
  const engine = new QuoteVideoEngine({
    registry,
    imageDb: db,
    fakeVisuals: fakeVisuals(),
    renderer: new QuoteRenderer(),
    outDir: path.join(dir, 'out'),
  })
  const r = await engine.run({ fakeLine4: 'Smoke test closing line.', jobId: 'qsmoke', videoId: 'v-qsmoke' })
  assert.ok(fs.existsSync(r.videoPath), 'video file must exist')
  const stat = fs.statSync(r.videoPath)
  assert.ok(stat.size > 1000, `video too small: ${stat.size}`)
  assert.ok(fs.existsSync(path.join(r.outDir, 'manifest.json')))
  // Output contract: landscape 1920x1080 @ 30fps (NOT vertical Shorts).
  const res = execFileSync(
    'ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height,r_frame_rate', '-of', 'csv=p=0', r.videoPath]
  ).toString().trim()
  assert.equal(res, '1920,1080,30/1', `expected 1920x1080@30fps, got ${res}`)
})