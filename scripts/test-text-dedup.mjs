// Unit test: duplicate-text class ("SECRET rendered twice" bug).
// Verifies contract-time dedupe, planner separation, manifest layers,
// and the TextConflictResolver safety net.
// Run: node scripts/test-text-dedup.mjs
import assert from 'node:assert/strict'
import { ScriptContract } from '../src/video-studio/ScriptContract.mjs'
import { ScenePlanner } from '../src/ai/ScenePlanner.mjs'
import { SceneTextManifest } from '../src/pipeline/SceneTextManifest.mjs'
import { TextConflictResolver } from '../src/pipeline/TextConflictResolver.mjs'

const article = {
  title: 'SECRET APPLE VISION PRO LEAKED PRICE REVEALED',
  category: 'technology',
  source: 'Test News',
  description: 'A secret Apple Vision Pro price leak reveals the true cost.',
}

const directorStory = {
  headline: 'THE DETAIL EVERYONE MISSED ABOUT APPLE',
  emotionalArc: ['curiosity', 'surprise'],
  scenePlan: [
    {
      type: 'hook',
      duration: 2.5,
      narration: 'Nobody expected this from Apple.',
      visual: { subject: 'Vision Pro headset', style: 'cinematic', composition: 'close_up' },
      camera: 'push_in',
      transition: 'cut',
      emotion: 'curiosity',
      caption: { focus: 'SECRET', fullText: 'SECRET APPLE VISION PRO LEAKED PRICE' },
    },
  ],
}

let passed = 0
const ok = (name) => { passed++; console.log('  ok —', name) }

// 1. Contract-time dedupe: caption must not repeat the emphasis keyword
console.log('ScriptContract.build:')
const contract = new ScriptContract().build(article, directorStory)
const scene0 = contract.scenes[0]
assert.equal(scene0.caption_focus, 'SECRET')
assert.ok(!/\bSECRET\b/i.test(scene0.caption), `caption still contains focus word: "${scene0.caption}"`)
ok(`caption "${scene0.caption}" excludes focus word SECRET`)
assert.ok(scene0.caption.length > 0, 'caption should keep the non-focus text')
ok('non-focus caption text preserved')

// 2. ScenePlanner: caption never falls back to caption_focus or narration words
console.log('ScenePlanner.buildScene:')
const planner = new ScenePlanner()
const scene = planner.buildScene({ id: 1, type: 'hook', duration: 2.5, narration: 'SECRET APPLE leaked today.', caption_focus: 'SECRET' }, 0, article)
assert.equal(scene.caption, '')
assert.equal(scene.captionFocus, 'SECRET')
ok('planner keeps caption_focus separate, caption empty')

// 3. Manifest + resolver safety net: emphasis word stripped, empty caption hidden
console.log('SceneTextManifest + TextConflictResolver:')
const manifest = SceneTextManifest.build({ id: 1, type: 'hook', caption_focus: 'SECRET', caption: 'APPLE VISION PRO LEAKED PRICE', narration: 'x', text: 'BREAKING: SECRET APPLE VISION PRO' })
const emphasis = manifest.text_layers.find(l => l.type === 'emphasis')
assert.equal(emphasis.text, 'SECRET')
const resolved = new TextConflictResolver().process(JSON.parse(JSON.stringify(manifest)))
const cap = resolved.text_layers.find(l => l.type === 'caption')
assert.ok(!/\bSECRET\b/i.test(cap.text), `resolved caption still has SECRET: "${cap.text}"`)
ok(`resolver strips emphasis word: "${cap.text}"`)

const hidden = new TextConflictResolver().process(SceneTextManifest.build({ id: 2, type: 'fact', caption_focus: 'PRICE', caption: 'PRICE', narration: 'x' }))
const cap2 = hidden.text_layers.find(l => l.type === 'caption')
assert.equal(cap2.visible, false)
ok('all-emphasis caption hidden (no empty subtitle)')

// 4. End-to-end: the keyword lives only in the emphasis layer, never in caption
// (the headline layer may restate the title — that is the BREAKING banner design)
console.log('End-to-end:')
const capE2E = resolved.text_layers.find(l => l.type === 'caption')
assert.equal(/\bSECRET\b/i.test(capE2E.text), false, `caption repeats keyword: "${capE2E.text}"`)
assert.equal(resolved.text_layers.find(l => l.type === 'emphasis').text, 'SECRET')
ok(`keyword appears in emphasis only; caption "${capE2E.text}" is clean`)

console.log(`\nAll ${passed} checks passed.`)
