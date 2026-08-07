// Unit test: HeadlineEmphasisResolver + ScenePlanner wiring + preflight rule.
// Verifies the SECRET APPLE VISION PRO example resolves SECRET -> PRICE,
// brands are never chosen, memory lessons bias selection, and the preflight
// warning code fires for residual duplicates.
// Run: node scripts/test-emphasis-resolver.mjs
process.env.BRAND_MEMORY_FILE = `${(await import('os')).tmpdir()}/nm-test-brand-memory.json`
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { HeadlineEmphasisResolver } from '../src/pipeline/HeadlineEmphasisResolver.mjs'
import { ScenePlanner } from '../src/ai/ScenePlanner.mjs'
import { ScenePreflight } from '../src/preflight/ScenePreflight.mjs'
import { BrandPerformanceMemory } from '../src/pipeline/BrandPerformanceMemory.mjs'

let passed = 0
const ok = (name) => { passed++; console.log('  ok —', name) }

const resolver = new HeadlineEmphasisResolver()
const TITLE = 'SECRET APPLE VISION PRO LEAKED PRICE REVEALED'
const HEADLINE = 'BREAKING: SECRET APPLE VISION PRO LEAKED PRICE REVEALED'

// 1. Spec example: tech story should prefer PRICE over the duplicate SECRET
console.log('resolve():')
const chosen = resolver.resolve({ headline: HEADLINE, title: TITLE, current: 'SECRET', category: 'technology' })
assert.equal(chosen, 'PRICE', `expected PRICE, got ${chosen}`)
ok(`SECRET -> ${chosen} (duplicate keyword replaced)`)

// 2. Brands never chosen — APPLE stays only if it is the only candidate
const brandPick = resolver.resolve({ headline: HEADLINE, title: 'APPLE STOCK CRASHES', current: 'APPLE', category: 'business' })
assert.notEqual(brandPick, 'APPLE')
ok(`brand avoided: APPLE -> ${brandPick}`)

// 3. Politics category prefers RESIGNS over a person word
const pol = resolver.resolve({ headline: 'BIDEN RESIGNS AS PRESIDENT', title: 'BIDEN RESIGNS AS PRESIDENT', current: 'BIDEN', category: 'politics' })
assert.equal(pol, 'RESIGNS')
ok(`politics: BIDEN -> ${pol}`)

// 4. No headline -> keep a valid original keyword (no reason to replace)
const noHeadline = resolver.resolve({ headline: '', title: 'SOME TITLE', current: 'TITLE', category: 'technology' })
assert.equal(noHeadline, 'TITLE')
ok('no headline: original keyword kept')

// 5. Memory lesson biases selection toward the taught word (must be in title).
const memory = new BrandPerformanceMemory()
memory.recordEmphasisLesson({ category: 'technology', replaced: 'SECRET', with: 'REVEALED', retentionImpact: -8 })
const taught = resolver.resolve({
  headline: HEADLINE, title: TITLE, current: 'SECRET', category: 'technology',
  lessons: memory.emphasisLessonsFor('technology'),
})
assert.equal(taught, 'REVEALED', `expected taught REVEALED, got ${taught}`)
ok(`lesson applied: SECRET -> ${taught}`)

// 6. ScenePlanner wiring — caption_focus set from resolver, lesson recorded.
// Use a fresh in-memory store so test 5's lesson does not bias this fixture.
const planner = new ScenePlanner()
planner.brandMemory.memory = { patterns: [] }
const scene = planner.buildScene(
  { id: 1, type: 'hook', duration: 2.5, narration: 'SECRET APPLE VISION PRO LEAKED PRICE REVEALED', caption_focus: 'SECRET' },
  0, { title: TITLE, category: 'technology' },
)
assert.equal(scene.caption_focus, 'PRICE', `expected PRICE, got ${scene.caption_focus}`)
assert.equal(scene.captionFocus, 'PRICE')
ok(`planner emphasis: SECRET -> ${scene.caption_focus}`)
const lessons = new BrandPerformanceMemory().emphasisLessonsFor('technology')
assert.ok(lessons.length >= 1, 'replacement should be recorded in production memory')
ok(`production memory recorded ${lessons.length} lesson(s)`)

// 7. Preflight — residual duplicate triggers the warning code
console.log('ScenePreflight:')
const pre = await ScenePreflight.run({ scenes: [{ id: 1, type: 'hook', text: 'BREAKING: SECRET APPLE VISION PRO', subheadline: 'SECRET APPLE VISION PRO LEAKED', caption_focus: 'SECRET' }] })
assert.ok(pre.warnings.some(w => w.startsWith('HEADLINE_EMPHASIS_DUPLICATE')), `warnings: ${pre.warnings}`)
ok(`preflight warning code fired: ${pre.warnings[0]}`)

const clean = await ScenePreflight.run({ scenes: [
  { id: 1, type: 'hook', text: 'BREAKING: SECRET APPLE VISION PRO', subheadline: 'SECRET APPLE VISION PRO LEAKED', caption_focus: 'PRICE' },
  { id: 2, type: 'fact', text: 'THE LEAK', caption_focus: 'LIVE' },
  { id: 3, type: 'close', text: 'FOLLOW NEWS-MONSTER', caption_focus: 'CHANNEL' },
] })
assert.equal(clean.warnings.length, 0, `unexpected warnings: ${clean.warnings}`)
ok('preflight clean when emphasis avoids the headline word')

// 8. Close scenes keep their CTA focus — never swapped for a title word
console.log('Close scene emphasis:')
const closeScene = planner.buildScene(
  { id: 9, type: 'close', duration: 2.5, narration: 'Sub for the next Apple leak!', caption_focus: 'SUB' },
  8, { title: TITLE, category: 'technology' },
)
assert.equal(closeScene.caption_focus, 'SUB', `expected SUB, got ${closeScene.caption_focus}`)
ok('close scene CTA focus preserved: SUB')

console.log(`\nAll ${passed} checks passed.`)
try { fs.unlinkSync(process.env.BRAND_MEMORY_FILE) } catch { /* temp file already gone */ }
