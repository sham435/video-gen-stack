// Unit test: broadcast text legibility — tokens meet minimums, preflight
// catches small text and stack collisions, and the conflict resolver hides
// captions that re-state the emphasis keyword.
// Run: node scripts/test-text-legibility.mjs
import assert from 'node:assert/strict'
import { BROADCAST_TEXT } from '../src/style/text-tokens.mjs'
import { ScenePreflight } from '../src/preflight/ScenePreflight.mjs'
import { TextConflictResolver } from '../src/pipeline/TextConflictResolver.mjs'

let passed = 0
const ok = (name) => { passed++; console.log('  ok —', name) }

// 1. Tokens meet broadcast minimums
console.log('Broadcast tokens:')
assert.ok(BROADCAST_TEXT.bug.size >= 32, `bug ${BROADCAST_TEXT.bug.size}`)
assert.ok(BROADCAST_TEXT.live.size >= 36, `live ${BROADCAST_TEXT.live.size}`)
assert.ok(BROADCAST_TEXT.footer.height >= 80, `footer ${BROADCAST_TEXT.footer.height}`)
assert.ok(BROADCAST_TEXT.footer.urlSize >= 30, `footer url ${BROADCAST_TEXT.footer.urlSize}`)
assert.ok(BROADCAST_TEXT.caption.minSize >= 32, `caption min ${BROADCAST_TEXT.caption.minSize}`)
assert.ok(BROADCAST_TEXT.emphasis.minSize >= 120, `emphasis min ${BROADCAST_TEXT.emphasis.minSize}`)
ok('bug 32 / live 36 / footer 80+32 / caption 32 / emphasis 120')

// 2. Preflight catches small text
console.log('TEXT_TOO_SMALL guard:')
const small = await ScenePreflight.run({
  scenes: [{ id: 1, captionLayout: { fontSize: 16, y: 1400 } }],
  layout: { width: 1080, height: 1920 },
})
assert.ok(small.warnings.some(w => w.startsWith('TEXT_TOO_SMALL')), `warnings: ${small.warnings}`)
ok('16px caption flagged')

// 3. Preflight catches stack collision (headline + visible caption same band)
console.log('TEXT_STACK_COLLISION guard:')
const stacked = await ScenePreflight.run({
  scenes: [{
    id: 2,
    headlineLayout: { fontSize: 92, y: 500 },
    captionLayout: { fontSize: 58, y: 520 },
    caption: 'hello world', captionHidden: false,
  }],
  layout: { width: 1080, height: 1920 },
})
assert.ok(stacked.warnings.some(w => w.startsWith('TEXT_STACK_COLLISION')), `warnings: ${stacked.warnings}`)
ok('headline+caption overlap flagged')

// 4. No false positive: hidden caption never collides
console.log('No false positive:')
const clean = await ScenePreflight.run({
  scenes: [{
    id: 3,
    headlineLayout: { fontSize: 92, y: 500 },
    captionLayout: { fontSize: 58, y: 520 },
    caption: 'hello world', captionHidden: true,
  }],
  layout: { width: 1080, height: 1920 },
})
assert.ok(!clean.warnings.some(w => w.startsWith('TEXT_STACK_COLLISION')), `warnings: ${clean.warnings}`)
ok('hidden caption not flagged')

// 5. Conflict resolver: caption re-stating >1 emphasis word is hidden
console.log('Emphasis-caption overlap rule:')
const resolver = new TextConflictResolver()
const hidden = resolver.process({
  type: 'fact',
  text_layers: [
    { type: 'emphasis', text: 'CHANGED THE PLAN' },
    { type: 'headline', text: 'THE PLAN' },
    { type: 'caption', text: 'This changed the plan overnight' },
  ],
})
const cap = hidden.text_layers.find(l => l.type === 'caption')
assert.equal(cap.visible, false, 'caption must hide when it re-states the keyword')
assert.equal(cap.text, '')
ok('"This changed the plan overnight" hidden when emphasis = CHANGED THE PLAN')

// 6. Single shared word still allowed (keyword highlight inside caption)
console.log('Single shared word kept:')
const kept = resolver.process({
  type: 'fact',
  text_layers: [
    { type: 'emphasis', text: 'PRICE' },
    { type: 'headline', text: 'THE PLAN' },
    { type: 'caption', text: 'The price is lower than expected' },
  ],
})
const cap2 = kept.text_layers.find(l => l.type === 'caption')
assert.notEqual(cap2.visible, false, 'caption should survive a single shared word')
ok('caption with one shared word kept')

console.log(`\nAll ${passed} checks passed.`)
