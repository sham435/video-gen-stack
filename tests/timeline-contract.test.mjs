import { test } from 'node:test'
import assert from 'node:assert/strict'
import { TextTimelineScheduler, PRIORITY } from '../src/video/TextTimelineScheduler.mjs'

const HOOK_SCENE = { id: 'h1', type: 'hook', duration: 4, text: 'Nobody expected this move', caption: '', captionHidden: false }

test('timeline: hook sequence banner → hero → secondary → ai is monotonic and disjoint', () => {
  const tl = TextTimelineScheduler.buildTimeline(HOOK_SCENE, 4)
  const byId = Object.fromEntries(tl.layers.map(l => [l.id, l]))
  // banner: 0-0.30 (fractions of duration)
  assert.deepEqual([byId.banner.start, byId.banner.end], [0, 0.30])
  // hero: starts at 0.35, ends at t0 + 0.55 * remaining
  const t0 = 0.35
  const remaining = Math.max(0.5, 1 - t0)
  assert.equal(byId.hero.start, t0)
  assert.equal(byId.hero.end, t0 + remaining * 0.55)
  // secondary: starts exactly where hero ends — no overlap, no gap
  assert.equal(byId.secondary.start, byId.hero.end)
  assert.equal(byId.secondary.end, byId.hero.end + remaining * 0.25)
  // ai: starts exactly where secondary ends, runs to the scene end
  assert.equal(byId.ai.start, byId.secondary.end)
  assert.equal(byId.ai.end, 1)
  // priorities strictly increase along the sequence
  const seq = ['banner', 'hero', 'secondary', 'ai']
  for (let i = 1; i < seq.length; i++) {
    assert.ok(PRIORITY[seq[i]] > PRIORITY[seq[i - 1]], `${seq[i]} after ${seq[i - 1]}`)
  }
})

test('timeline: no two focal layers ever share a time window (hook)', () => {
  const tl = TextTimelineScheduler.buildTimeline(HOOK_SCENE, 4)
  const focal = tl.layers.filter(l => l.priority <= PRIORITY.ai && !l.allowOverlap)
  for (const a of focal) {
    for (const b of focal) {
      if (a.id === b.id) continue
      const overlap = Math.min(a.end, b.end) - Math.max(a.start, b.start)
      assert.ok(overlap <= 0, `${a.id} overlaps ${b.id} by ${overlap.toFixed(3)}`)
    }
  }
})

test('timeline: assertFrame permits the active layer and rejects conflicts', () => {
  const tl = TextTimelineScheduler.buildTimeline(HOOK_SCENE, 4)
  const active = TextTimelineScheduler.assertFrame(tl, 0.10, 'h1')
  assert.ok(active.some(l => l.id === 'banner'))
  TextTimelineScheduler.assertFrame(tl, 0.50, 'h1') // hero
  TextTimelineScheduler.assertFrame(tl, 0.80, 'h1') // secondary
  TextTimelineScheduler.assertFrame(tl, 0.95, 'h1') // ai

  // force hero + secondary to collide → hard failure
  const broken = structuredClone(tl)
  broken.layers.find(l => l.id === 'secondary').start = 0.5
  assert.throws(
    () => TextTimelineScheduler.assertFrame(broken, 0.55, 'h1'),
    /TEXT_TIMELINE_CONFLICT:sceneh1:hero\+secondary/
  )

  // hero + ai collision
  const brokenAi = structuredClone(tl)
  brokenAi.layers.find(l => l.id === 'ai').start = 0.5
  assert.throws(
    () => TextTimelineScheduler.assertFrame(brokenAi, 0.55, 'h1'),
    /TEXT_TIMELINE_CONFLICT:sceneh1:hero\+ai/
  )
})

test('timeline: envelope is 0 outside the window, fades in, holds, fades out', () => {
  const tl = TextTimelineScheduler.buildTimeline(HOOK_SCENE, 4)
  const hero = tl.layers.find(l => l.id === 'hero')
  assert.equal(TextTimelineScheduler.envelope(hero, 0.34), 0)          // before start
  assert.equal(TextTimelineScheduler.envelope(hero, hero.start), 0)    // fade-in begins
  const fadeInDone = hero.start + hero.animationIn
  assert.equal(TextTimelineScheduler.envelope(hero, fadeInDone), 1)    // full opacity
  const fadeOutStart = hero.end - hero.animationOut
  assert.ok(TextTimelineScheduler.envelope(hero, fadeOutStart + (hero.end - fadeOutStart) / 2) < 1)
  assert.equal(TextTimelineScheduler.envelope(hero, hero.end), 0)      // after end
})

test('timeline: caption only scheduled when present and not hidden', () => {
  const withCaption = { ...HOOK_SCENE, caption: 'NOBODY EXPECTED THIS', captionHidden: false }
  const tl = TextTimelineScheduler.buildTimeline(withCaption, 4)
  assert.ok(tl.layers.some(l => l.id === 'caption'))
  assert.equal(TextTimelineScheduler.layersAt(tl, 0.5).filter(l => l.id === 'caption').length, 1)

  const hidden = { ...HOOK_SCENE, caption: 'NOBODY EXPECTED THIS', captionHidden: true }
  const tlHidden = TextTimelineScheduler.buildTimeline(hidden, 4)
  assert.ok(!tlHidden.layers.some(l => l.id === 'caption'))

  const noCaption = { ...HOOK_SCENE, caption: '' }
  const tlNone = TextTimelineScheduler.buildTimeline(noCaption, 4)
  assert.ok(!tlNone.layers.some(l => l.id === 'caption'))
})

test('timeline: non-hook scenes get one focal layer + optional caption', () => {
  const fact = TextTimelineScheduler.buildTimeline({ type: 'fact', duration: 4, text: 'x', caption: '' }, 4)
  const factFocal = fact.layers.filter(l => l.priority <= PRIORITY.ai && !l.allowOverlap)
  assert.equal(factFocal.length, 1)
  assert.equal(factFocal[0].id, 'hero')

  const explanation = TextTimelineScheduler.buildTimeline({ type: 'explanation', duration: 4, text: 'x', caption: '' }, 4)
  const expFocal = explanation.layers.filter(l => l.priority <= PRIORITY.ai && !l.allowOverlap)
  assert.equal(expFocal.length, 1)
  assert.equal(expFocal[0].id, 'ai')
})

test('timeline: secondary words stagger at 0.06s per word', () => {
  const tl = TextTimelineScheduler.buildTimeline(HOOK_SCENE, 4)
  const secondary = tl.layers.find(l => l.id === 'secondary')
  assert.equal(TextTimelineScheduler.wordStart(secondary, 0), secondary.start)
  assert.equal(TextTimelineScheduler.wordStart(secondary, 2), secondary.start + 0.12)
})
