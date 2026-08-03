import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, existsSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { execFileSync } from 'child_process'

let NewsBroadcastEngine
try {
  ({ NewsBroadcastEngine } = await import('../src/index.mjs'))
} catch (e) {
  console.warn('engine import failed:', e.message)
}

function mockArticle(overrides = {}) {
  return {
    title: 'OpenAI launches new flagship AI model for video generation',
    description: 'OpenAI has announced a new model capable of generating studio-quality video from text prompts. The model understands camera angles, lighting, and narrative structure.',
    source: 'Tech News',
    url: 'https://example.com/ai-model',
    category: 'technology',
    ...overrides,
  }
}

test('pipeline: engine constructs all subsystems', () => {
  if (!NewsBroadcastEngine) return assert.fail('NewsBroadcastEngine import failed')
  const engine = new NewsBroadcastEngine()
  for (const key of ['voiceSync', 'soundFX', 'qualityChecker', 'audioMixer', 'scenePlanner', 'storyDirector', 'scriptContract', 'visualReasoner', 'retentionDirector']) {
    assert.ok(engine[key], `missing subsystem: ${key}`)
  }
})

test('pipeline: category config maps templates', () => {
  if (!NewsBroadcastEngine) return assert.fail('NewsBroadcastEngine import failed')
  const engine = new NewsBroadcastEngine()
  const tech = engine.getCategoryConfig('technology')
  assert.equal(tech.duration, 30)
  assert.equal(tech.template, 'tech-news.json')
  assert.ok(tech.visual_style.length > 10)
  const fallback = engine.getCategoryConfig('unknown-category')
  assert.equal(fallback.template, 'tech-news.json')
})

test('pipeline: template variable injection', () => {
  if (!NewsBroadcastEngine) return assert.fail('NewsBroadcastEngine import failed')
  const engine = new NewsBroadcastEngine()
  const out = engine.injectVariables({ headline: '{{title}} is {{status}}' }, { title: 'AI', status: 'live' })
  assert.equal(out.headline, 'AI is live')
  const missing = engine.injectVariables({ a: '{{nope}}' }, {})
  assert.equal(missing.a, '{{nope}}')
})

test('pipeline: template file loads and parses', async () => {
  if (!NewsBroadcastEngine) return assert.fail('NewsBroadcastEngine import failed')
  const engine = new NewsBroadcastEngine()
  const template = await engine.loadTemplate('technology')
  assert.ok(Array.isArray(template.scenes))
  assert.ok(template.scenes.length >= 1)
  assert.ok(template.resolution?.width)
})

test('pipeline: preflight blocks malformed article', async () => {
  if (!NewsBroadcastEngine) return assert.fail('NewsBroadcastEngine import failed')
  const engine = new NewsBroadcastEngine()
  await assert.rejects(
    () => engine.generateFromArticle({ title: 'no category' }, mkdtempSync(join(tmpdir(), 'pf-'))),
    /preflight/i
  )
})

test('pipeline: end-to-end render produces mp4', { timeout: 240000 }, async () => {
  if (!NewsBroadcastEngine) return assert.fail('NewsBroadcastEngine import failed')
  const engine = new NewsBroadcastEngine()

  engine.loadTemplate = async () => ({
    version: 'test',
    resolution: { width: 640, height: 360 },
    fps: 12,
    duration: 4,
    scenes: [
      { id: 1, type: 'hook', start: 0, end: 2, text: 'Breaking AI news', headline: 'AI MODEL', subheadline: 'test', visual: 'tech', effect: 'none', audio: 'ambient' },
      { id: 2, type: 'fact', start: 2, end: 4, text: 'Details inside', headline: 'DETAILS', subheadline: 'test', visual: 'tech', effect: 'none', audio: 'ambient' },
    ],
    ticker: [],
  })

  engine.storyDirector.plan = async () => ({
    headline: 'AI MODEL LAUNCHED',
    scenePlan: [
      { type: 'hook', duration: 2, narration: 'A new AI model is here.', visual: { subject: 'chip', style: 'clean' }, camera: 'close', transition: 'cut', emotion: 'curiosity', caption: { focus: 'AI' } },
      { type: 'fact', duration: 2, narration: 'It generates studio quality video.', visual: { subject: 'screen', style: 'clean' }, camera: 'medium', transition: 'cut', emotion: 'inform', caption: { focus: 'video' } },
    ],
    emotionalArc: ['curiosity', 'inform'],
  })

  engine.visualReasoner.select = async () => null
  engine.audioMixer.ensureMusicExists = async () => {}
  engine.voiceSync.generateTTS = async (_script, voicePath) => {
    execFileSync('ffmpeg', ['-y', '-f', 'lavfi', '-i', 'anullsrc=r=44100:cl=mono', '-t', '2', voicePath], { stdio: 'pipe' })
  }
  engine.voiceSync.getDuration = () => 2.0

  const outDir = mkdtempSync(join(tmpdir(), 'pipe-'))
  try {
    const { videoPath } = await engine.generateFromArticle(mockArticle(), outDir, null, { quick: true })
    assert.ok(videoPath, 'videoPath returned')
    assert.ok(existsSync(videoPath), `mp4 exists: ${videoPath}`)
    assert.ok(existsSync(join(outDir, 'final.mp4')) || existsSync(videoPath), 'final output present')
  } finally {
    rmSync(outDir, { recursive: true, force: true })
  }
})
