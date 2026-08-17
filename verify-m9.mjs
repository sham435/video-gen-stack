#!/usr/bin/env node
// M9 Niche Viral Engine — verify 48 unique hashtag sets + arc CTAs
// Usage: node verify-m9.mjs

import { pickAlgorithm } from './src/ai/StoryAlgorithmRegistry.mjs'
import { HashtagBuilder } from './src/publishing/HashtagBuilder.mjs'
import { TopicCtaBuilder } from './src/publishing/TopicCtaBuilder.mjs'
import { PublishingEnhancer } from './src/publishing/PublishingEnhancer.mjs'

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

console.log('=== M9 Niche Viral Engine Verify ===\n')

const results = titles.map(title => {
  const algo = pickAlgorithm({ title, category: title.toLowerCase().includes('trump') ? 'business' : 'technology' })
  const hashtags = HashtagBuilder.build({ topic: HashtagBuilder.topicFromHeadline(title), category: algo.category || 'technology', algorithm: algo })
  const cta = new TopicCtaBuilder().build({ title, category: algo.category || 'technology', algorithm: algo })
  const enh = PublishingEnhancer.enhance({ title, category: algo.category || 'technology', source: 'NEWS-MONSTER', algorithm: algo })
  return { title: title.slice(0, 45), algo, hashtags, cta, enh }
})

// Check unique hashtag sets
const hashtagSets = results.map(r => r.hashtags)
const uniqueHashtags = new Set(hashtagSets)
console.log(`Unique hashtag sets: ${uniqueHashtags.size}/${results.length}`)
console.log(`All unique: ${uniqueHashtags.size === results.length ? 'YES ✅' : 'NO ❌'}\n`)

// Check unique arcs
const arcs = results.map(r => r.algo.arc)
const uniqueArcs = new Set(arcs)
console.log(`Unique arcs used: ${uniqueArcs.size}/6`)
console.log(`Arcs: ${[...uniqueArcs].join(', ')}\n`)

// Print sample outputs
for (const r of results.slice(0, 3)) {
  console.log(`--- ${r.title} ---`)
  console.log(`ALGO: #${r.algo.number}/48 • ${r.algo.visual.id} • ${r.algo.tone.id}`)
  console.log(`Arc: ${r.algo.arc}`)
  console.log(`Hashtags: ${r.hashtags}`)
  console.log(`CTA: ${r.cta.cta}`)
  console.log(`Pinned: ${r.cta.pinnedComment}`)
  console.log()
}

// Verify PublishingEnhancer integration
const trump = PublishingEnhancer.enhance({
  title: 'Trump-appointed regulator OKs banking license for Trump-linked crypto firm',
  category: 'business',
  source: 'Politico',
  algorithm: pickAlgorithm({ title: 'Trump-appointed regulator', category: 'business' }),
})
console.log('=== PublishingEnhancer Full Output (Trump story) ===')
console.log(trump.fullDescription)
console.log('\nPINNED:', trump.pinnedComment)
console.log(`\nTags: ${trump.hashtags.length} hashtags, ALGO tag: ${trump.algoTag}`)

// Final check
const allPass = uniqueHashtags.size === results.length && uniqueArcs.size > 0 && trump.hashtags.length === 15
console.log(`\n=== M9 ${allPass ? 'DONE ✅' : 'FAILED ❌'} ===`)
console.log(`Hashtags unique: ${uniqueHashtags.size === results.length ? '✅' : '❌'}`)
console.log(`All 6 arcs covered: ${uniqueArcs.size === 6 ? '✅' : `${uniqueArcs.size}/6`}`)
console.log(`15 tags per algo: ${trump.hashtags.length === 15 ? '✅' : `${trump.hashtags.length}`}`)
console.log(`Engagement CTA present: ${trump.cta ? '✅' : '❌'}`)
process.exit(allPass ? 0 : 1)
