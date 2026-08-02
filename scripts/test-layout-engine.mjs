// Unit test: TextLayoutEngine V1 — deterministic layout computation.
// Proves width measurement (W vs i), line wrapping, role-aware priority,
// safe-zone containment, and the renderer contract (overflow:false before
// render starts).
// Run: node scripts/test-layout-engine.mjs
import assert from 'node:assert/strict'
import { FontMetrics } from '../src/layout/FontMetrics.mjs'
import { LineWrapper } from '../src/layout/LineWrapper.mjs'
import { TextLayoutEngine } from '../src/layout/TextLayoutEngine.mjs'
import { SafeZoneManager } from '../src/layout/SafeZoneManager.mjs'
import { TextLayoutPreflight } from '../src/layout/TextLayoutPreflight.mjs'

let passed = 0
const ok = (name) => { passed++; console.log('  ok —', name) }

const CANVAS = { width: 1080, height: 1920 }

// 1. Real font metrics: wide glyphs measure wider than narrow glyphs
console.log('Width measurement (real font metrics):')
const wide = FontMetrics.measure('WWWW', 72, 'Anton')
const narrow = FontMetrics.measure('iiii', 72, 'Anton')
assert.ok(wide > narrow, `expected WWWW > iiii, got ${wide} vs ${narrow}`)
ok(`WWWW (${wide.toFixed(0)}px) > iiii (${narrow.toFixed(0)}px) @72px`)

// 2. Line wrapping: greedy wrap keeps the text within maxLines
console.log('Line wrapping:')
const wrapped = LineWrapper.wrap({
  text: 'APPLE VISION PRO PRICE DETAILS REVEALED',
  maxWidth: 918, fontSize: 48, fontFamily: 'Anton', maxLines: 2,
})
assert.ok(wrapped.lines.length <= 2, `expected <=2 lines, got ${wrapped.lines.length}`)
assert.equal(wrapped.overflow, false)
ok(`${wrapped.lines.length} lines: ${wrapped.lines.map(l => JSON.stringify(l)).join(', ')}`)
const tooBig = LineWrapper.wrap({
  text: 'APPLE VISION PRO PRICE DETAILS REVEALED',
  maxWidth: 918, fontSize: 120, fontFamily: 'Anton', maxLines: 2,
})
assert.equal(tooBig.overflow, true, 'honest overflow reporting when text cannot fit')
ok('oversized text reports overflow:true (never silent clipping)')

// 3. Role priority: emphasis stays bigger than caption when space is tight
console.log('Role priority (emphasis > headline > caption):')
const squeezedText = 'X'.repeat(400)
const emphasis = TextLayoutEngine.layout({ text: squeezedText, role: 'emphasis', canvas: CANVAS })
const headline = TextLayoutEngine.layout({ text: squeezedText, role: 'headline', canvas: CANVAS })
const caption = TextLayoutEngine.layout({ text: squeezedText, role: 'caption', canvas: CANVAS })
assert.ok(emphasis.fontSize > headline.fontSize, `${emphasis.fontSize} !> ${headline.fontSize}`)
assert.ok(headline.fontSize > caption.fontSize, `${headline.fontSize} !> ${caption.fontSize}`)
ok(`emphasis ${emphasis.fontSize}px > headline ${headline.fontSize}px > caption ${caption.fontSize}px`)

// 4. Safe zone: layout is contained inside the role safe zone
console.log('Safe zone containment:')
const zone = SafeZoneManager.roleZone('caption', CANVAS)
const captionLayout = TextLayoutEngine.layout({ text: 'Nobody expected this move from the new headset', role: 'caption', canvas: CANVAS })
assert.ok(captionLayout.x >= zone.left, `x ${captionLayout.x} < left ${zone.left}`)
assert.ok(captionLayout.x + captionLayout.width <= zone.right, `right edge ${captionLayout.x + captionLayout.width} > ${zone.right}`)
ok(`x ${captionLayout.x}..${captionLayout.x + captionLayout.width} inside [${zone.left}..${zone.right}]`)

// 5. Renderer contract: overflow:false before render starts
console.log('Renderer contract:')
const news = TextLayoutEngine.layout({
  text: 'APPLE VISION PRO PRICE DETAILS REVEALED AFTER MAJOR LEAK',
  role: 'headline', canvas: CANVAS,
})
assert.equal(news.overflow, false)
assert.doesNotThrow(() => TextLayoutPreflight.validate(news))
ok('overflow:false — preflight passes')

// 6. Layout manifest shape
console.log('Layout manifest shape:')
const manifest = TextLayoutEngine.layout({ text: 'PRICE', role: 'emphasis', canvas: CANVAS })
for (const key of ['text', 'lines', 'fontSize', 'lineHeight', 'width', 'height', 'x', 'y', 'scalePercent', 'overflow']) {
  assert.ok(key in manifest, `missing key: ${key}`)
}
assert.ok(manifest.lines.length > 0)
assert.equal(manifest.fontSize, 58, 'short emphasis keeps preferred size')
ok(`keys present; fontSize ${manifest.fontSize}px (${manifest.scalePercent}%)`)

// 7. Height budget: total layout height stays inside the zone height
console.log('Height budget:')
assert.ok(news.height <= zone.height + 1, `height ${news.height} > zone ${zone.height}`)
ok(`height ${news.height}px <= ${zone.height}px`)

console.log(`\nAll ${passed} checks passed.`)
