import { StoryboardGenerator } from '../../packages/branding/storyboard.js'
import { fetchTopHeadlines } from '../../apps/api/services/news.js'
import { writeFileSync } from 'fs'

const category = process.env.INPUT_CATEGORY || 'technology'

try {
  const articles = await fetchTopHeadlines({ category, pageSize: 5 })
  const gen = new StoryboardGenerator()
  const storyboard = gen.generate(articles)
  writeFileSync('/tmp/storyboard.json', JSON.stringify(storyboard))
  console.log(`✅ Storyboard: ${storyboard.totalScenes} scenes, ${storyboard.totalDuration}s`)
} catch (e) {
  console.error('❌ Generate Storyboard failed:', e.stack || e)
  process.exit(1)
}
