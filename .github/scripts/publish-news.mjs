import { fetchTopHeadlines } from '../../apps/api/services/news.js'
import { renderNewsVideo } from '../../apps/api/services/renderer.js'
import { uploadShort } from '../../apps/api/publishers/youtube.js'
import { readFileSync, unlinkSync } from 'fs'

const category = process.env.INPUT_CATEGORY || 'technology'

try {
  // Secret checks
  if (!process.env.NEWSAPI_KEY) { console.error('Missing NEWSAPI_KEY secret'); process.exit(1) }
  if (!process.env.YOUTUBE_REFRESH_TOKEN) { console.error('Missing YOUTUBE_REFRESH_TOKEN secret'); process.exit(1) }

  const articles = await fetchTopHeadlines({ category, pageSize: 5 })
  if (!articles.length) { console.log('No articles'); process.exit(0) }

  console.log('Rendering:', articles[0].title?.slice(0, 60))
  const videoPath = await renderNewsVideo(articles.slice(0, 5))
  const buffer = readFileSync(videoPath)
  const base64 = buffer.toString('base64')
  unlinkSync(videoPath)

  const title = `📰 ${articles[0].title?.slice(0, 90)}`
  const desc = `${title}\n\nSource: ${articles[0].source?.name || 'NewsAPI'}\n\n#tech #news #AI`
  const result = await uploadShort(`data:video/mp4;base64,${base64}`, title, desc, 'public')

  console.log(`✅ Published: https://youtu.be/${result?.id}`)
} catch (e) {
  console.error('❌ Publish failed:', e.stack || e)
  process.exit(1)
}
