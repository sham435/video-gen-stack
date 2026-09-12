/**
 * ACROSS-VIDEO NARRATION-DEDUP gate tests.
 *
 * Covers the registry-backed layer added on top of the within-video statics
 * (tests/narration-gate.test.mjs):
 *   1. StoryDirector plan-time ACROSS-video validation — one bounded LLM
 *      regeneration pass when the generated script collides with a PAST
 *      script in the shared ledger, FAIL CLOSED (throw NARRATION GATE) when
 *      regeneration fails or the duplicate persists.
 *   2. Engine pre-TTS gate fingerprint — the exact sequence index.mjs runs
 *      before generateTTS (validateWithinVideo + registry-backed
 *      ScriptUniqueness.validate) rejects a script that repeats a recorded
 *      one, and accepts a fresh one.
 *
 * All registry tests use a TEMP ledger file — never the shared
 * data/asset-registry.json.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { ScriptUniqueness } from '../src/uniqueness/ScriptUniqueness.mjs'
import { AssetRegistry } from '../src/uniqueness/AssetRegistry.mjs'
import { StoryDirector } from '../src/ai/StoryDirector.mjs'

const mkTempRegistry = () => new AssetRegistry({ filePath: path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'narration-dedup-')), 'registry.json') })

const uniquePlan = {
  headline: 'Apple did it again',
  scenePlan: [
    { type: 'fact', duration: 5.5, narration: 'Apple unveiled its biggest chip yet today.' },
    { type: 'fact', duration: 5.5, narration: 'The new silicon doubles last years performance.' },
    { type: 'reveal', duration: 4.5, narration: 'The whole industry is paying attention now.' },
  ],
}

const dupPlan = {
  headline: 'Apple did it again',
  scenePlan: [
    { type: 'fact', duration: 5.5, narration: 'Apple unveiled its biggest chip yet today.' },
    { type: 'fact', duration: 5.5, narration: 'Apple unveiled its biggest chip yet today.' },
    { type: 'fact', duration: 5.5, narration: 'Apple unveiled its biggest chip yet today.' },
    { type: 'reveal', duration: 4.5, narration: 'The whole industry is paying attention now.' },
  ],
}

// The ledger records the JOINED script text, exactly like the engine records
// captionScript post-success. Helpers here mirror ScriptUniqueness.validate
// semantics used by the engine gate.
const joined = (plan) => plan.scenePlan.map(s => s.narration || '').filter(Boolean).join(' ')

test('across-video: fresh script passes an empty ledger', async () => {
  const registry = mkTempRegistry()
  const scriptUniqueness = new ScriptUniqueness(registry)
  let calls = 0
  const provider = {
    generate: async () => { calls += 1; return JSON.stringify(uniquePlan) },
  }
  const director = new StoryDirector(provider, { scriptUniqueness })
  const story = await director.plan({ title: 'Apple', category: 'tech' })
  assert.equal(calls, 1, 'no correction pass needed')
  assert.equal(scriptUniqueness.validate(joined(story), { title: story.headline }).pass, true)
})

test('across-video: duplicate of a recorded script regenerates once and passes', async () => {
  const registry = mkTempRegistry()
  const scriptUniqueness = new ScriptUniqueness(registry)
  // Seed the ledger with the SAME script text as the first provider response.
  scriptUniqueness.record(joined(uniquePlan), { title: 'Apple' })
  assert.equal(scriptUniqueness.validate(joined(uniquePlan), { title: 'Apple' }).pass, false, 'precondition: recorded script must be flagged')

  let calls = 0
  const provider = {
    generate: async () => {
      calls += 1
      if (calls === 1) return JSON.stringify(uniquePlan)
      // Bounded correction pass returns a rewritten, distinct script.
      return JSON.stringify({
        headline: 'Apple did it again',
        scenePlan: [
          { type: 'fact', duration: 5.5, narration: 'Cupertino shocked analysts with new silicon.' },
          { type: 'fact', duration: 5.5, narration: 'Benchmarks jumped by a full generation.' },
          { type: 'reveal', duration: 4.5, narration: 'Rivals are scrambling to respond.' },
        ],
      })
    },
  }
  const director = new StoryDirector(provider, { scriptUniqueness })
  const story = await director.plan({ title: 'Apple', category: 'tech' })
  assert.equal(calls, 2, 'exactly one bounded across-video correction pass')
  assert.equal(scriptUniqueness.validate(joined(story), { title: story.headline }).pass, true, 'regenerated script must clear the gate')
})

test('across-video: duplicate + failed regeneration FAILS CLOSED (NARRATION GATE)', async () => {
  const registry = mkTempRegistry()
  const scriptUniqueness = new ScriptUniqueness(registry)
  scriptUniqueness.record(joined(uniquePlan), { title: 'Apple' })

  let calls = 0
  const provider = {
    generate: async () => {
      calls += 1
      if (calls === 2) throw new Error('fix LLM down')
      return JSON.stringify(uniquePlan)
    },
  }
  const director = new StoryDirector(provider, { scriptUniqueness })
  await assert.rejects(
    () => director.plan({ title: 'Apple', category: 'tech' }),
    /NARRATION GATE/,
    'must fail closed — never hand a duplicate script downstream'
  )
})

test('across-video: duplicate persisting after regeneration FAILS CLOSED', async () => {
  const registry = mkTempRegistry()
  const scriptUniqueness = new ScriptUniqueness(registry)
  scriptUniqueness.record(joined(dupPlan), { title: 'Apple' })

  let calls = 0
  const provider = {
    generate: async () => {
      calls += 1
      // Regeneration returns a script that STILL collides with the ledger.
      return JSON.stringify(dupPlan)
    },
  }
  const director = new StoryDirector(provider, { scriptUniqueness })
  await assert.rejects(
    () => director.plan({ title: 'Apple', category: 'tech' }),
    /persisted after regeneration/,
    'regeneration that keeps colliding must still throw'
  )
})

test('across-video: no guard when no registry is provided (backward compatible)', async () => {
  let calls = 0
  const provider = {
    generate: async () => { calls += 1; return JSON.stringify(uniquePlan) },
  }
  const director = new StoryDirector(provider)
  const story = await director.plan({ title: 'Apple', category: 'tech' })
  assert.equal(calls, 1, 'no registry, no correction pass')
  assert.equal(ScriptUniqueness.validateWithinVideo(story.scenePlan.map(s => s.narration)).pass, true)
})

test('across-video: same-job idempotent re-render self-excludes, others stay blocked', async () => {
  const registry = mkTempRegistry()
  const scriptUniqueness = new ScriptUniqueness(registry)
  const text = joined(uniquePlan)
  scriptUniqueness.record(text, { jobId: 'video-abc', title: 'Apple' })
  // Any OTHER job is hard-blocked...
  assert.equal(scriptUniqueness.validate(text, { jobId: 'video-other', title: 'Other' }).pass, false, 'other jobs must be blocked')
  // ...but the SAME job may re-render idempotently (composer retry / same-day re-produce).
  assert.equal(scriptUniqueness.validate(text, { jobId: 'video-abc', title: 'Apple' }).pass, true, 'same-job re-render must self-exclude')
})

test('engine gate fingerprint: pre-TTS sequence rejects a recorded script and accepts a fresh one', async () => {
  // Mirrors src/index.mjs: validateWithinVideo(timedScenes...), then the
  // registry-backed ScriptUniqueness.validate(captionScript) on the joined
  // narration — exactly what runs before generateTTS.
  const registry = mkTempRegistry()
  const scriptUniqueness = new ScriptUniqueness(registry)
  scriptUniqueness.record(joined(uniquePlan), { title: 'Apple' })

  const within = ScriptUniqueness.validateWithinVideo(uniquePlan.scenePlan.map(s => s.narration))
  assert.equal(within.pass, true, 'scene-level narration is internally unique')

  const dup = scriptUniqueness.validate(joined(uniquePlan), { title: 'Apple' })
  assert.equal(dup.pass, false, 'pre-TTS gate rejects a script repeating a recorded one')
  assert.match(dup.reason, /duplicate/i)

  const fresh = scriptUniqueness.validate('Completely new narration about a different story.', { title: 'Fresh' })
  assert.equal(fresh.pass, true, 'fresh scripts still pass')
})