import { QualityScorer } from '../../packages/common/quality/scorer.js'
import { readFileSync } from 'fs'

try {
  const storyboard = JSON.parse(readFileSync('/tmp/storyboard.json', 'utf8'))
  const scorer = new QualityScorer()
  const result = scorer.score(storyboard)

  console.log(`Visual Score: ${result.scores.visual}/100`)
  console.log(`Audio Score: ${result.scores.audio}/100`)
  console.log(`Text Score: ${result.scores.text}/100`)
  console.log(`Brand Score: ${result.scores.brand}/100`)
  console.log(`Total Score: ${result.total}/100`)
  console.log(`Status: ${result.passed ? '✅ APPROVED' : '❌ REJECTED'}`)

  if (!result.passed) {
    console.error('Issues:', result.issues.join(', '))
    process.exit(1)
  }
} catch (e) {
  console.error('❌ Quality Check failed:', e.stack || e)
  process.exit(1)
}
