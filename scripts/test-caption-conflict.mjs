// Unit test: CaptionConflictResolver — semantic-aware caption cleanup.
// Replaces blind focus-word stripping that mangled natural language
// ("The real price of the headset" -> "The real of the headset").
// Run: node scripts/test-caption-conflict.mjs
import assert from 'node:assert/strict'
import { CaptionConflictResolver } from '../src/pipeline/CaptionConflictResolver.mjs'

let passed = 0
const ok = (name) => { passed++; console.log('  ok —', name) }

const r = new CaptionConflictResolver()

// 1. Keep important words — mid-sentence focus is grammatically essential
console.log('Keep important words:')
let out = r.resolve({ focus: 'PRICE', caption: 'The real price of the headset' })
assert.equal(out.caption, 'The real price of the headset')
assert.equal(out.visible, true)
ok('PRICE kept in "The real price of the headset"')

// 2. Remove pure duplication — keyword-style caption repeats the emphasis
console.log('Remove pure duplication:')
out = r.resolve({ focus: 'SECRET', caption: 'SECRET APPLE LEAK' })
assert.equal(out.caption, 'APPLE LEAK')
ok(`SECRET removed from "SECRET APPLE LEAK" -> "${out.caption}"`)

// 3. Preserve phrases — compound noun at caption start is meaningful
console.log('Preserve phrases:')
out = r.resolve({ focus: 'BATTERY', caption: 'Battery life improved by 40%' })
assert.equal(out.caption, 'Battery life improved by 40%')
ok('BATTERY kept in "Battery life improved by 40%"')

// 4. Repeated headline phrase — caption adds nothing, strip headline words
console.log('Repeated headline phrase:')
out = r.resolve({ focus: 'PRICE', headline: 'APPLE VISION PRO PRICE LEAK', caption: 'Apple Vision Pro price details revealed' })
assert.equal(out.caption, 'details revealed')
ok(`headline echo stripped -> "${out.caption}"`)

// 5. All-emphasis caption -> hidden (no empty subtitle box)
console.log('All-emphasis caption:')
out = r.resolve({ focus: 'PRICE', caption: 'PRICE' })
assert.equal(out.visible, false)
assert.equal(out.caption, '')
ok('PRICE-only caption hidden')

// 6. Focus absent -> untouched
console.log('Focus absent:')
out = r.resolve({ focus: 'PRICE', caption: 'Nothing to see here' })
assert.equal(out.caption, 'Nothing to see here')
ok('caption untouched when focus absent')

// 7. Mid-sentence focus survives headline stripping (no gap mangling)
console.log('No gap mangling:')
out = r.resolve({ focus: 'PRICE', headline: 'BREAKING: SECRET APPLE VISION PRO LEAKED PRICE REVEALED', caption: 'The real price of the headset' })
assert.equal(out.caption, 'The real price of the headset')
ok('mid-sentence PRICE kept even when headline contains it')

// 8. Multi-word focus phrase kept when meaningful
console.log('Multi-word focus:')
out = r.resolve({ focus: 'VISION PRO', caption: 'Vision Pro launches next month' })
assert.equal(out.caption, 'Vision Pro launches next month')
ok('VISION PRO kept in "Vision Pro launches next month"')

// 9. Close-scene guard (manifest level): CTA caption survives the echo rule
console.log('Close-scene CTA:')
import { TextConflictResolver } from '../src/pipeline/TextConflictResolver.mjs'
import { SceneTextManifest } from '../src/pipeline/SceneTextManifest.mjs'
const tcr = new TextConflictResolver()
const closeManifest = SceneTextManifest.build({ id: 9, type: 'close', text: 'SUB FOR THE NEXT APPLE LEAK', caption: 'SUB FOR THE NEXT APPLE LEAK', caption_focus: 'SUB', narration: 'Sub for the next Apple leak!' })
const closeResolved = tcr.process(JSON.parse(JSON.stringify(closeManifest)))
const closeCap = closeResolved.text_layers.find(l => l.type === 'caption')
assert.notEqual(closeCap.visible, false, 'close caption must stay visible')
assert.ok(closeCap.text.length > 0, 'close caption must keep the CTA text')
ok(`close CTA caption preserved: "${closeCap.text}"`)

console.log(`\nAll ${passed} checks passed.`)
