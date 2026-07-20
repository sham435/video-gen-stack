import { fetchTopHeadlines } from '../../apps/api/services/news.js'
import { renderNewsVideo } from '../../apps/api/services/renderer.js'
import { uploadShort } from '../../apps/api/publishers/youtube.js'
import { readFileSync, unlinkSync } from 'fs'

const category = process.env.INPUT_CATEGORY || 'technology'

try {
  if (!process.env.NEWSAPI_KEY) { console.error('Missing NEWSAPI_KEY secret'); process.exit(1) }
  if (!process.env.YOUTUBE_REFRESH_TOKEN) { console.error('Missing YOUTUBE_REFRESH_TOKEN secret'); process.exit(1) }

  const articles = await fetchTopHeadlines({ category, pageSize: 5 })
  if (!articles.length) { console.log('No articles'); process.exit(0) }

  // Use ONLY the top article - 1 article = 1 video
  const article = articles[0]
  console.log('Article:', article.title?.slice(0, 60))
  console.log('Source:', article.source?.name)
  console.log('Image:', article.urlToImage || 'none')

  // Get OG image
  let imageUrl = article.urlToImage || null
  if (!imageUrl && article.url) {
    try {
      const resp = await fetch(article.url, { signal: AbortSignal.timeout(5000) })
      const html = await resp.text()
      const match = html.match(/<meta[^>]+property="og:image"[^>]+content="([^"]+)"/)
      if (match) imageUrl = match[1]
    } catch {}
  }

  // Render 1 article with image
  const videoPath = await renderNewsVideo(
    [{ title: article.title, source: article.source?.name, imageUrl }],
    { category, imageUrl }
  )

  const buffer = readFileSync(videoPath)
  const base64 = buffer.toString('base64')
  unlinkSync(videoPath)

  const title = `📰 ${article.title?.slice(0, 90)}`
  const desc = `${title}\n\nSource: ${article.source?.name || 'NewsAPI'}\n\n#tech #news #${category}`
  const result = await uploadShort(`data:video/mp4;base64,${base64}`, title, desc, 'public')

  console.log(`✅ Published: https://youtu.be/${result?.id}`)
} catch (e) {
  console.error('❌ Publish failed:', e.stack || e)
  process.exit(1)
}
