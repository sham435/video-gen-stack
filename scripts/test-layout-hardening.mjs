// Unit test: layout hardening — font metric caching, multilingual metrics
// (CJK/Arabic/Sinhala/Tamil/emoji), script-aware wrapping, retention-driven
// layout policy, and layout snapshots for regression testing.
// Run: node scripts/test-layout-hardening.mjs
import assert from 'node:assert/strict'
import { FontMetrics } from '../src/layout/FontMetrics.mjs'
import { LineWrapper } from '../src/layout/LineWrapper.mjs'
import { LayoutPolicy } from '../src/layout/LayoutPolicy.mjs'
import { LayoutSnapshotStore } from '../src/layout/LayoutSnapshotStore.mjs'
import { ViewerBehaviorModel } from '../src/quality/ViewerBehaviorModel.mjs'
import { TextLayoutEngine } from '../src/layout/TextLayoutEngine.mjs'

let passed = 0
const ok = (name) => { passed++; console.log('  ok —', name) }

// 1. Font metric caching: repeated measurement hits the cache
console.log('Font metric caching:')
FontMetrics.clearCache()
const a = FontMetrics.measure('APPLE VISION PRO', 72, 'Anton')
const b = FontMetrics.measure('APPLE VISION PRO', 72, 'Anton')
assert.equal(a, b)
const stats = FontMetrics.cacheStats()
assert.ok(stats.hits >= 1, `expected cache hits, got ${JSON.stringify(stats)}`)
ok(`hits=${stats.hits} misses=${stats.misses}`)

// 2. Multilingual metrics: CJK/emoji/Arabic/Sinhala/Tamil have defined widths
console.log('Multilingual metrics:')
const cjk = FontMetrics.measure('汉', 72, 'Inter')
assert.ok(cjk >= 68 && cjk <= 78, `CJK glyph width out of range: ${cjk}`)
const emoji = FontMetrics.measure('📱', 72, 'Inter')
assert.ok(emoji > FontMetrics.measure('i', 72, 'Inter'), 'emoji wider than narrow glyph')
const arabic = FontMetrics.measure('مثال', 72, 'Inter')
assert.ok(arabic > 0 && !Number.isNaN(arabic), `arabic width broken: ${arabic}`)
const sinhala = FontMetrics.measure('සිංහල', 72, 'Inter')
const tamil = FontMetrics.measure('தமிழ்', 72, 'Inter')
assert.ok(sinhala > 0 && tamil > 0 && !Number.isNaN(sinhala) && !Number.isNaN(tamil))
ok(`CJK ${cjk.toFixed(0)}px, emoji ${emoji.toFixed(0)}px, arabic ${arabic.toFixed(0)}px, sinhala ${sinhala.toFixed(0)}px, tamil ${tamil.toFixed(0)}px`)

// 3. Script-aware wrapping: CJK breaks by character, no spaces needed
console.log('Script-aware wrapping (CJK):')
const cjkWrapped = LineWrapper.wrap({
  text: '苹果视觉专业版价格泄露细节公布', maxWidth: 400, fontSize: 48, maxLines: 3,
})
assert.ok(cjkWrapped.lines.length > 1, `CJK should wrap to multiple lines, got ${cjkWrapped.lines.length}`)
assert.equal(cjkWrapped.lines.join('') + cjkWrapped.dropped.replace(/\s/g, ''), '苹果视觉专业版价格泄露细节公布')
ok(`CJK wraps to ${cjkWrapped.lines.length} lines without spaces`)

// 4. Arabic wrapping: breaks by cluster, no spaces needed
console.log('Script-aware wrapping (Arabic):')
const arWrapped = LineWrapper.wrap({
  text: 'الأسعار المسربة للجهاز الجديد', maxWidth: 350, fontSize: 28, maxLines: 2,
})
assert.ok(arWrapped.lines.length > 0 && arWrapped.overflow === false)
ok(`Arabic wraps to ${arWrapped.lines.length} lines`)

// 5. Emoji: surrogate pairs measure as single graphemes
console.log('Emoji grapheme measurement:')
const one = FontMetrics.measure('🎉', 72, 'Inter')
const two = FontMetrics.measure('🎉🎉', 72, 'Inter')
assert.ok(Math.abs(two - 2 * one) < 1, `surrogate pair counted wrong: ${one} vs ${two}`)
ok(`🎉=${one.toFixed(0)}px, 🎉🎉=${two.toFixed(0)}px (2x single)`)

// 6. Retention-driven layout policy
console.log('Retention-driven layout policy:')
const model = new ViewerBehaviorModel()
const overloaded = { type: 'fact', caption: 'x'.repeat(80), emotion: 'shock', duration: 3 }
const overloadPolicy = LayoutPolicy.policyFor(overloaded, model)
assert.equal(overloadPolicy.caption.maxLines, 1, 'text_overload -> fewer caption lines')
assert.ok(overloadPolicy.caption.preferredFontSize < 58, 'text_overload -> smaller caption')
const strongHook = { type: 'hook', hookScore: 92, duration: 3, emotion: 'shock', caption: 'hello' }
const hookPolicy = LayoutPolicy.policyFor(strongHook, model)
assert.ok(hookPolicy.emphasis.preferredFontSize > 58, 'strong hook -> emphasis boost')
const neutral = { type: 'fact', caption: 'ok', emotion: 'neutral', duration: 3 }
const neutralPolicy = LayoutPolicy.policyFor(neutral, model)
assert.equal(neutralPolicy.caption.preferredFontSize, 58)
ok(`text_overload -> caption ${overloadPolicy.caption.preferredFontSize}px x${overloadPolicy.caption.maxLines}L; strong hook -> emphasis ${hookPolicy.emphasis.preferredFontSize}px`)

// 7. Layout snapshots: record → save → load round-trip
console.log('Layout snapshots:')
const tmpSnap = '/tmp/nm-layout-snapshots-test.json'
const scene = { id: 7, type: 'fact' }
const lay = TextLayoutEngine.layout({ text: 'APPLE VISION PRO PRICE DETAILS', role: 'headline' })
const rec = LayoutSnapshotStore.record(scene, lay)
assert.equal(rec.sceneId, '7')
assert.equal(rec.role, 'headline')
assert.ok(Array.isArray(rec.lines) && rec.lines.length > 0)
LayoutSnapshotStore.save([rec], tmpSnap)
const loaded = LayoutSnapshotStore.load(tmpSnap)
assert.deepEqual(loaded, [rec])
ok('record -> save -> load round-trips')

console.log(`\nAll ${passed} checks passed.`)
