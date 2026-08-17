#!/usr/bin/env node
import { pickAlgorithm } from './src/ai/StoryAlgorithmRegistry.mjs'
import { tracker } from './src/analytics/AlgorithmPerformanceTracker.mjs'
import { HOOKS, ARCS, VISUAL_STYLES, TONES, STRUCTURES } from './src/ai/StoryAlgorithmRegistry.mjs'

const titles = [
  'Trump-appointed regulator OKs banking license for Trump-linked crypto firm - Politico',
  'Poor Baby Monkey Lost in the Rain Builds Shelter',
  'Apple unveils iPhone 17 leak shocks world',
  'Nvidia stock crashes 20 percent overnight',
  'OpenAI GPT-5 stuns developers',
  'Bitcoin hits 120k all time high',
  'Tesla robot falls in factory tragedy',
  'Meta bans AI videos globally',
  'Samsung Galaxy S25 broken toy fixed',
  'Hungry Monkey steals food shares with birds becomes hero',
  'Monkey Bullied in School Studies Hard Wins Prize',
  'Baby Monkey Fell in River Saves Fish',
]

console.log('=== M6a Diversity Check: 48 Algorithms ===\n')
const algos = titles.map(t => {
  return pickAlgorithm({ title: t, category: t.toLowerCase().includes('trump') ? 'business' : 'technology' })
})

algos.forEach((a, i) => {
  console.log(`#${a.number.toString().padStart(2, '0')}/48 | ${a.hook.padEnd(18)} | ${a.arc.padEnd(20)} | ${a.visual.id.padEnd(15)} | ${a.tone.id.padEnd(18)} | ${a.structure.id} | ${titles[i].slice(0, 40)}`)
})

const uniqueNumbers = new Set(algos.map(a => a.number)).size
const uniqueVisuals = new Set(algos.map(a => a.visual.id)).size
const uniqueTones = new Set(algos.map(a => a.tone.id)).size
const uniqueHooks = new Set(algos.map(a => a.hook)).size

// Component validation
const validHooks = new Set(HOOKS)
const validArcs = new Set(ARCS)
const validVisuals = new Set(VISUAL_STYLES.map(v => v.id))
const validTones = new Set(TONES.map(t => t.id))
const validStructures = new Set(STRUCTURES.map(s => s.id))
const invalidCombos = algos.filter(a =>
  !validHooks.has(a.hook) || !validArcs.has(a.arc) || !validVisuals.has(a.visual?.id) || !validTones.has(a.tone?.id) || !validStructures.has(a.structure?.id)
)

console.log('\n=== Diversity Report ===')
console.log(`Unique algos: ${uniqueNumbers}/${algos.length}`)
console.log(`Unique visuals: ${uniqueVisuals}/8`)
console.log(`Unique tones: ${uniqueTones}/6`)
console.log(`Unique hooks: ${uniqueHooks}/8`)
console.log(`Components valid: ${invalidCombos.length === 0 ? `ALL ${algos.length} VALID` : `INVALID: ${invalidCombos.length}`}`)
const diversityPass = uniqueNumbers >= Math.ceil(algos.length * 0.8)
console.log(`Is Diverse: ${diversityPass ? 'YES \u2705' : 'NO \u274C'} (${uniqueNumbers}/${algos.length} unique, threshold ${Math.ceil(algos.length * 0.8)})`)

console.log('\n=== Tracker Report (last 20) ===')
console.log(JSON.stringify(tracker.getDiversityReport(), null, 2))

console.log('\n=== Actually See Check ===')
const hasActuallySee = tracker.verifyNoActuallySee(titles.join(' ')) === false || algos.some(a => /actually see/i.test(a.id))
console.log(`Contains 'Actually See': ${hasActuallySee ? 'FAIL \u274C' : 'PASS \u2705 - Gone'}`)

const allPass = diversityPass && !hasActuallySee && invalidCombos.length === 0
console.log(`\nM6a ${allPass ? 'DONE \u2705' : 'FAILED \u274C'}. ${allPass ? 'If diverse YES and Actually See PASS, proceed to M6b render.' : 'Fix issues above.'}`)
process.exit(allPass ? 0 : 1)
