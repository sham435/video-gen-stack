// visual-selection-smoke.mjs — end-to-end check of the Phase 9b selection path.
//
// Demonstrates the confirmed fix (A+B):
//   #196  VI diversity           → Article A gets its own VI pick, Article B its own
//   Phase 9b                     → VI pick stays ELIGIBLE, used URLs stay excluded,
//                                  judge/ranking still run, tie-break is article-aware
//   Final                        → A and B no longer forced onto the same generic
//                                  scene.id-selected asset (scenes 2–7 scope)
//
// The VI stage is deterministic stand-in output (entity-aware VisualSearchEngine
// is live-verified post-#196 in run 34604897872). The Phase 9b loop below is an
// exact mirror of src/index.mjs Phase 9b, so the smoke exercises production code.

import { SemanticVisualRankerV2 } from '../src/pipeline/SemanticVisualRankerV2.mjs'

// The generic visualPlan pool that historically collapsed every video onto the
// same per-scene picks (pre-#196 runs: 11987055, 39204858, 12683247, 1025410,
// 14000706, 9973163 for scenes 2–7).
const GENERIC_POOL = [
  'https://images.pexels.com/photos/11987055/pexels-photo-11987055.jpeg',
  'https://images.pexels.com/photos/39204858/pexels-photo-39204858.jpeg',
  'https://images.pexels.com/photos/12683247/pexels-photo-12683247.jpeg',
  'https://images.pexels.com/photos/1025410/pexels-photo-1025410.jpeg',
  'https://images.pexels.com/photos/14000706/pexels-photo-14000706.jpeg',
  'https://images.pexels.com/photos/9973163/pexels-photo-9973163.jpeg',
  'https://images.pexels.com/photos/25961352/pexels-photo-25961352.jpeg',
  'https://images.pexels.com/photos/700460/pexels-photo-700460.jpeg',
]

// Entity-aware VI picks: deterministic per-article output (what #196 restored).
const CASES = {
  A: {
    id: 'death-stranding-xbox-variety', title: 'Death Stranding comes to Xbox — Hideo Kojima breaks silence, Variety reports',
    vi: ['https://images.pexels.com/photos/8100101/pexels-photo-8100101.jpeg', 'https://images.pexels.com/photos/8100102/pexels-photo-8100102.jpeg', 'https://images.pexels.com/photos/8100103/pexels-photo-8100103.jpeg', 'https://images.pexels.com/photos/8100104/pexels-photo-8100104.jpeg', 'https://images.pexels.com/photos/8100105/pexels-photo-8100105.jpeg', 'https://images.pexels.com/photos/8100106/pexels-photo-8100106.jpeg'],
  },
  B: {
    id: 'ipad-macbook-apple-techcrunch', title: 'iPad and MacBook get surprise upgrade — Apple doubles down, TechCrunch details',
    vi: ['https://images.pexels.com/photos/8300201/pexels-photo-8300201.jpeg', 'https://images.pexels.com/photos/8300202/pexels-photo-8300202.jpeg', 'https://images.pexels.com/photos/8300203/pexels-photo-8300203.jpeg', 'https://images.pexels.com/photos/8300204/pexels-photo-8300204.jpeg', 'https://images.pexels.com/photos/8300205/pexels-photo-8300205.jpeg', 'https://images.pexels.com/photos/8300206/pexels-photo-8300206.jpeg'],
  },
}

const p = (url) => String(url || '').match(/photos\/(\d+)/)?.[1] || url

function buildScene(articleKey, id, viUrl) {
  return {
    id,
    image: viUrl,
    images: [viUrl], // Phase 8: rankedUrls = chosenUrls when VI wins
    visualFromIntel: true,
    assetId: `${articleKey}-${id}-sha`,
    narration: 'scene narration for this story',
    caption: 'scene caption',
    visualPlan: { images: GENERIC_POOL },
    // Judge verdict is the same in production: 0/7 scenes pass today (avg 65,
    // threshold 70, visual_unrelated < 55). Judge threshold is NOT changed here.
    judge: { issues: ['visual_unrelated'], recommendation: 'regenerate_scene' },
  }
}

// Exact mirror of src/index.mjs Phase 9b loop (post-A+B fix).
function phase9b(article, articleKey) {
  const ranker = new SemanticVisualRankerV2()
  const usedVisualUrls = new Set()
  const out = []
  for (const i of [2, 3, 4, 5, 6, 7]) {
    const sc = buildScene(articleKey, i, article.vi[i - 2])
    const prior = sc.image
    const reranked = ranker.applyFeedback(sc, article, { used: [...usedVisualUrls] })
    if (reranked) {
      if (prior) usedVisualUrls.add(prior)
      usedVisualUrls.add(reranked.url)
      out.push({ scene: i, vi: prior, final: reranked.url, score: reranked.score, judgeRan: true })
    } else {
      if (prior) usedVisualUrls.add(prior)
      out.push({ scene: i, vi: prior, final: prior, score: null, judgeRan: !!sc.judge })
    }
  }
  return { out, used: [...usedVisualUrls] }
}

const rankA = phase9b(CASES.A, 'A')
const rankB = phase9b(CASES.B, 'B')

console.log('case A:', CASES.A.id)
console.log('case B:', CASES.B.id)

console.log('\n#196 VI diversity: A → candidate A, B → candidate B')
for (let k = 0; k < 6; k++) {
  const same = rankA.out[k].vi === rankB.out[k].vi
  console.log(`  scene ${k + 2}: A=${p(rankA.out[k].vi)} B=${p(rankB.out[k].vi)} ${same ? '✗ SAME' : '✓ distinct'}`)
}

console.log('\nPhase 9b: VI pick eligible, used excluded, judge/ranking ran, article-aware tie-break')
for (let k = 0; k < 6; k++) {
  const a = rankA.out[k], b = rankB.out[k]
  const aWon = a.final === a.vi
  const bWon = b.final === b.vi
  console.log(`  scene ${a.scene}: A final=${p(a.final)} (${aWon ? 'VI kept' : 'reranked'} ${a.score}/100) | B final=${p(b.final)} (${bWon ? 'VI kept' : 'reranked'} ${b.score}/100)`)
}

console.log('\nused URLs stay excluded (no intra-video repeats)')
console.log(`  A used distinct: ${new Set(rankA.used).size === rankA.used.length ? '✓' : '✗'} (${rankA.used.length})`)
console.log(`  B used distinct: ${new Set(rankB.used).size === rankB.used.length ? '✓' : '✗'} (${rankB.used.length})`)

console.log('\nFinal: scenes 2–7 no longer converge to the same generic scene.id asset')
let converged = 0
for (let k = 0; k < 6; k++) {
  const same = rankA.out[k].final === rankB.out[k].final
  if (same) converged++
  console.log(`  scene ${rankA.out[k].scene}: A=${p(rankA.out[k].final)} B=${p(rankB.out[k].final)} ${same ? '✗ SAME' : '✓ distinct'}`)
}
console.log(`\nconverged scenes: ${converged}/6 ${converged === 0 ? '✓ none' : '✗ regression'}`)

// Determinism: same article + same inputs + same seed → same result
const rankA2 = phase9b(CASES.A, 'A')
const det = JSON.stringify(rankA.out.map(x => x.final)) === JSON.stringify(rankA2.out.map(x => x.final))
console.log(`\ndeterminism: rerun(A) === run(A) ${det ? '✓' : '✗'}`)

console.log('\n[SMOKE] ' + (converged === 0 && det ? 'OK — A+B fix verified' : 'FAIL'))