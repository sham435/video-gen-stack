// Retention Learning Loop — pulls real YouTube analytics for published
// videos and calibrates ProductionMemory with data-backed retention impact.
// Idempotent: safe to run on any schedule (daily cron recommended).
//
//   node scripts/retention-learning.mjs
//
// Requires YOUTUBE_REFRESH_TOKEN/CLIENT_ID/CLIENT_SECRET and published
// snapshots (data/retention-analytics.json, written at publish time).
import { RetentionPatternLearner } from '../src/analytics/RetentionPatternLearner.mjs'
import { ProductionMemory } from '../src/pipeline/ProductionMemory.mjs'

async function run() {
  const learner = new RetentionPatternLearner({ memory: new ProductionMemory() })
  const result = await learner.learn({ verbose: true })

  if (!result.analyzed && !result.learned.length) {
    console.log(result.message || 'No videos with enough views yet — nothing to learn')
    return
  }
  console.log(`\nRetention learning: ${result.analyzed} videos analyzed, ${result.skipped} skipped`)
  for (const r of result.learned) {
    console.log(`  ${r.rule}: ${r.frequency} videos, impact ${r.retentionImpact > 0 ? '+' : ''}${r.retentionImpact}%, confidence ${r.confidence}`)
  }
}

run().catch(e => {
  console.error('Retention learning failed:', e.message)
  process.exit(1)
})
