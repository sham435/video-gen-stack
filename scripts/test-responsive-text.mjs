// Unit test: ResponsiveTextScaler — pre-render text fitting so nothing clips.
// Verifies long text shrinks, short text keeps its size, the minimum font
// floor is enforced (scale never negative), and the Shorts safe-margin
// presets (85% width / 25% height) are applied.
// Run: node scripts/test-responsive-text.mjs
import assert from 'node:assert/strict'
import { ResponsiveTextScaler } from '../src/pipeline/ResponsiveTextScaler.mjs'

let passed = 0
const ok = (name) => { passed++; console.log('  ok —', name) }

const CANVAS_W = 1080
const CANVAS_H = 1920

// 1. Long caption at 58px must shrink to fit the 85% safe zone
console.log('Long caption shrinks:')
const long = ResponsiveTextScaler.fitForCanvas({
  text: 'Nobody expected this move from SECRET.',
  canvasWidth: CANVAS_W, canvasHeight: CANVAS_H,
  fontSize: 58,
})
assert.ok(long.fontSize < 58, `expected shrink, got ${long.fontSize}px`)
assert.ok(long.scalePercent > 0 && long.scalePercent < 100)
ok(`58px -> ${long.fontSize}px (${long.scalePercent}%)`)

// 2. Short emphasis word keeps its size (no unnecessary shrinking)
console.log('Short word keeps size:')
const short = ResponsiveTextScaler.fitForCanvas({
  text: 'PRICE', canvasWidth: CANVAS_W, canvasHeight: CANVAS_H, fontSize: 58,
})
assert.equal(short.fontSize, 58)
assert.equal(short.scalePercent, 100)
ok('PRICE stays 58px / 100%')

// 3. Hook headline (92px) with a long title shrinks below the safe width
console.log('Long headline shrinks:')
const headline = ResponsiveTextScaler.fitForCanvas({
  text: 'BREAKING: SECRET APPLE VISION PRO LEAKED PRICE REVEALED',
  canvasWidth: CANVAS_W, canvasHeight: CANVAS_H, fontSize: 92,
})
assert.ok(headline.fontSize < 92)
ok(`92px headline -> ${headline.fontSize}px (${headline.scalePercent}%)`)

// 4. Minimum font floor — never zero, never negative
console.log('Min font clamp:')
const min = ResponsiveTextScaler.fit({ text: 'X'.repeat(500), maxWidth: 100, maxHeight: 100, fontSize: 58, minFontSize: 18 })
assert.ok(min.fontSize >= 18, `expected >= 18, got ${min.fontSize}`)
assert.ok(min.scalePercent >= 0, 'scalePercent must never be negative')
ok(`clamped at ${min.fontSize}px, scale ${min.scalePercent}%`)

// 5. Height budget respected for multi-line text
console.log('Height budget:')
const tallText = 'A '.repeat(40).trim()
const tall = ResponsiveTextScaler.fit({
  text: tallText, maxWidth: 200, maxHeight: 120, fontSize: 58, minFontSize: 18,
})
const estLines = Math.ceil((tallText.length * tall.fontSize * 0.55) / 200)
const estH = Math.max(1, estLines) * tall.fontSize * 1.25
assert.ok(estH <= 120 || tall.fontSize === 18, `height ${estH} exceeds budget`)
ok('multi-line height stays within maxHeight')

// 6. Direct fit() with explicit maxWidth/maxHeight (API parity)
console.log('fit() API:')
const direct = ResponsiveTextScaler.fit({ text: 'HELLO WORLD', maxWidth: 300, maxHeight: 80, fontSize: 92 })
assert.ok(direct.fontSize < 92)
assert.equal(typeof direct.overflow, 'boolean')
ok(`direct fit -> ${direct.fontSize}px, overflow=${direct.overflow}`)

console.log(`\nAll ${passed} checks passed.`)
