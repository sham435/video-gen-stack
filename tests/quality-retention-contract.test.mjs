import { test } from 'node:test'
import assert from 'node:assert/strict'
import { CompositionJudge } from '../src/quality/CompositionJudge.mjs'
import { ViewerBehaviorModel } from '../src/quality/ViewerBehaviorModel.mjs'
import { RetentionSimulator } from '../src/quality/RetentionSimulator.mjs'
import { ProductionMemory } from '../src/pipeline/ProductionMemory.mjs'

// Deterministic, AI-free fixtures. Scenes carry the same production signals
// the pipeline computes before the render loop.

// Fresh, disk-free ProductionMemory: ProductionMemory() loads the real
// data/production-memory.json — tests must not read or pollute it.
function freshMemory() {
  const mem = new ProductionMemory()
  mem.memory = { rules: [] }
  mem._persist = () => {}
  return mem
}

const CLEAN_SCENE = {
  id: 1,
  type: 'hook',
  duration: 3,
  caption: 'Short caption',
  textManifest: { emphasis: ['AI'] },
  visualRelevanceScore: 90,
  hookScore: 90,
  image: 'frames/hero.png',
  camera: 'push_in',
  emotion: 'shock',
  transition: 'cut',
  cameraPlan: { motion: 'push_in' },
}

const DUPLICATE_TEXT_SCENE = {
  ...CLEAN_SCENE,
  id: 2,
  type: 'fact',
  caption: 'Nobody expected this move',
  compositionScore: { failed: ['duplicateText', 'safeZone'] },
}

const LONG_CAPTION_SCENE = {
  ...CLEAN_SCENE,
  id: 3,
  type: 'fact',
  duration: 4,
  caption: 'This is a far too long caption that exceeds the reading budget entirely',
  visualRelevanceScore: 40,
  camera: 'static',
}

// ---------------------------------------------------------------------------
// CompositionJudge contract
// ---------------------------------------------------------------------------

test('judge: clean scene passes deterministically (no AI)', async () => {
  const judge = new CompositionJudge({ aiEnabled: false })
  const out = await judge.evaluate([CLEAN_SCENE], { title: 'Test', category: 'technology' })
  const r = out.results[0]
  assert.equal(out.aiUsed, false)
  assert.equal(r.passed, true)
  assert.equal(r.recommendation, 'accept')
  assert.ok(r.score >= judge.threshold, `score ${r.score} >= ${judge.threshold}`)
  assert.deepEqual(r.issues, [])
  // deterministic: same input → same score, no randomness
  const out2 = await judge.evaluate([CLEAN_SCENE])
  assert.equal(out2.results[0].score, r.score)
})

test('judge: duplicate text + safe zone failures produce penalties', async () => {
  const judge = new CompositionJudge({ aiEnabled: false })
  const out = await judge.evaluate([DUPLICATE_TEXT_SCENE])
  const r = out.results[0]
  assert.ok(r.issues.includes('duplicate_text'), `issues: ${r.issues}`)
  assert.ok(r.score <= 60, `duplicate_text (-20) + safeZone pushed score to ${r.score}`)
  assert.equal(r.passed, false)
  assert.equal(r.recommendation, 'regenerate_scene')
})

test('judge: visual mismatch and weak relevance are penalized', async () => {
  const judge = new CompositionJudge({ aiEnabled: false })
  const out = await judge.evaluate([LONG_CAPTION_SCENE])
  const r = out.results[0]
  assert.ok(r.issues.includes('visual_unrelated'), `issues: ${r.issues}`)
  assert.ok(r.issues.includes('caption_too_long'), `issues: ${r.issues}`)
})

test('judge: ProductionMemory remediation truncates known bad patterns', async () => {
  const memory = freshMemory()
  const judge = new CompositionJudge({ aiEnabled: false, memory })
  const scene = structuredClone(LONG_CAPTION_SCENE)

  const first = await judge.evaluate([scene])
  assert.equal(first.results[0].appliedFix, 'truncate_caption')
  assert.equal(first.results[0].recommendation, 'applied:truncate_caption')
  assert.ok(scene.caption.length <= 38, `caption truncated to ${scene.caption.length}`)
  const learned = memory.lookup('caption_too_long')
  assert.ok(learned, 'pattern learned on first detection')
  assert.equal(learned.status, 'detected')

  // second pass: pattern is known → memory marks it resolved and reapplies
  const scene2 = structuredClone(LONG_CAPTION_SCENE)
  const second = await judge.evaluate([scene2])
  assert.equal(second.results[0].appliedFix, 'truncate_caption')
  assert.equal(memory.lookup('caption_too_long').status, 'resolved')
  assert.ok(scene2.caption.length <= 38)
})

// ---------------------------------------------------------------------------
// ViewerBehaviorModel contract
// ---------------------------------------------------------------------------

test('viewer model: risky scenes surface expected risks with confidence', () => {
  const model = new ViewerBehaviorModel()
  const risky = {
    id: 2,
    type: 'explanation',
    duration: 6,
    caption: 'x'.repeat(70),
    visualRelevanceScore: 40,
    camera: 'static',
    emotion: 'neutral',
  }
  const risks = model.risks(risky)
  const types = risks.map(r => r.type)
  assert.ok(types.includes('scene_drag'), types.join(','))
  assert.ok(types.includes('visual_repetition'), types.join(','))
  assert.ok(types.includes('text_overload'), types.join(','))
  assert.ok(types.includes('visual_mismatch'), types.join(','))
  assert.ok(types.includes('slow_information_delivery'), types.join(','))
  for (const r of risks) {
    assert.ok(r.confidence > 0 && r.confidence <= 0.97, `${r.type} confidence ${r.confidence}`)
  }
})

test('viewer model: clean hook scene carries no structural risks', () => {
  const model = new ViewerBehaviorModel()
  assert.deepEqual(model.risks(CLEAN_SCENE), [])
})

test('viewer model: recommendations map to actionable fixes', () => {
  const model = new ViewerBehaviorModel()
  const cases = [
    [{ type: 'scene_drag' }, 'shorten_scene'],
    [{ type: 'visual_repetition' }, 'add_motion'],
    [{ type: 'text_overload' }, 'truncate_caption'],
    [{ type: 'slow_information_delivery' }, 'move_key_fact_forward'],
    [{ type: 'slow_hook_open' }, 'strengthen_hook'],
    [{ type: 'unknown_risk' }, 'monitor'],
  ]
  for (const [risk, action] of cases) {
    const rec = model.recommendations(CLEAN_SCENE, { ...risk, risk: risk.type })
    assert.equal(rec.action, action, `${risk.type} → ${action}`)
    assert.equal(rec.scene, CLEAN_SCENE.id)
  }
})

test('viewer model: hazard orders risky scenes above clean hooks', () => {
  const model = new ViewerBehaviorModel()
  const risky = { id: 2, type: 'explanation', duration: 6, caption: 'x'.repeat(70), visualRelevanceScore: 40, camera: 'static', emotion: 'neutral' }
  assert.ok(model.hazard(risky) > model.hazard(CLEAN_SCENE), `${model.hazard(risky)} > ${model.hazard(CLEAN_SCENE)}`)
})

// ---------------------------------------------------------------------------
// RetentionSimulator contract
// ---------------------------------------------------------------------------

const SEQUENCE = [
  CLEAN_SCENE,
  { ...DUPLICATE_TEXT_SCENE, id: 2 },
  { ...LONG_CAPTION_SCENE, id: 3 },
]

test('retention: simulate produces a monotone survival curve over total seconds', () => {
  const sim = new RetentionSimulator()
  const curve = sim.simulate(SEQUENCE)
  const totalSeconds = SEQUENCE.reduce((s, sc) => s + Math.round(sc.duration || 3), 0)
  assert.equal(curve.length, totalSeconds)
  assert.equal(curve[0].sceneId, 1)
  assert.ok(curve[0].survivors < 100 && curve[0].survivors > 0, `first second already decays: ${curve[0].survivors}`)
  for (let i = 1; i < curve.length; i++) {
    assert.ok(curve[i].survivors <= curve[i - 1].survivors, `monotone at ${i}`)
    assert.ok(curve[i].survivors >= 0)
  }
})

test('retention: evaluate returns the full contract shape, deterministically', () => {
  const sim = new RetentionSimulator()
  const out = sim.evaluate(SEQUENCE)
  for (const key of ['retentionScore', 'completionRate', 'avgWatch', 'curve', 'dropZones', 'dropRisks', 'recommendations']) {
    assert.ok(key in out, `shape key ${key}`)
  }
  assert.ok(out.retentionScore >= 0 && out.retentionScore <= 100)
  assert.ok(out.completionRate >= 0 && out.completionRate <= 100)
  assert.ok(Array.isArray(out.dropRisks))
  for (const r of out.dropRisks) {
    assert.ok(r.scene >= 1 && r.scene <= 3, `dropRisk scene ${r.scene}`)
    assert.ok(r.confidence > 0 && r.confidence <= 0.97)
  }
  assert.deepEqual(sim.evaluate(SEQUENCE), out, 'deterministic output')
})

test('retention: empty input returns a zeroed contract', () => {
  const sim = new RetentionSimulator()
  assert.deepEqual(sim.evaluate([]), { retentionScore: 0, completionRate: 0, avgWatch: 0, curve: [], dropZones: [], dropRisks: [], recommendations: [] })
})

test('retention: optimize applies shorten/truncate/strengthen/reorder fixes', () => {
  const sim = new RetentionSimulator()
  const scenes = structuredClone([
    { id: 1, type: 'hook', duration: 3, caption: '', captionHidden: true },
    { id: 2, type: 'explanation', duration: 6, caption: 'Details nobody knows yet' },
    { id: 3, type: 'fact', duration: 4, caption: 'x'.repeat(60) },
  ])
  const result = {
    recommendations: [
      { action: 'shorten_scene', scene: 2, seconds: 2 },
      { action: 'truncate_caption', scene: 3 },
      { action: 'strengthen_hook', scene: 1 },
      { action: 'move_key_fact_forward', scene: 3 },
    ],
    dropRisks: [{ scene: 2, risk: 'scene_drag', confidence: 0.8 }],
  }
  const { changes } = sim.optimize(scenes, result)
  assert.equal(scenes[1].duration, 4, 'explanation trimmed 6s → 4s')
  assert.ok(scenes[2].caption.length <= 38, 'fact caption truncated')
  assert.ok(scenes[0].caption.length >= 8 && scenes[0].captionHidden === false, 'hook caption strengthened')
  assert.equal(scenes[2].caption, '', 'promoted caption cleared from the demoted explanation')
  assert.equal(scenes[1].type, 'fact', 'key fact moved before exposition')
  assert.equal(scenes[2].type, 'explanation', 'exposition demoted after fact')
  assert.ok(changes.length >= 3, `changes applied: ${changes.join(' | ')}`)
})

test('retention: optimize learns retention patterns into ProductionMemory', () => {
  const memory = freshMemory()
  const sim = new RetentionSimulator({ memory })
  const scenes = [{ id: 1, type: 'hook', duration: 6, caption: 'x'.repeat(70) }]
  const result = {
    recommendations: [{ action: 'truncate_caption', scene: 1 }, { action: 'shorten_scene', scene: 1, seconds: 2 }],
    dropRisks: [{ scene: 1, risk: 'text_overload', confidence: 0.75 }],
  }
  sim.optimize(scenes, result)
  assert.equal(memory.lookup('text_overload').retentionImpact, -5)
  assert.equal(memory.lookup('retention_low').preventedBy, 'RetentionSimulator')
})
