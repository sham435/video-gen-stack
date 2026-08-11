import { fetchTopHeadlines, searchNews, articlesToSummary } from './news.js'
import { generateVideo } from './fal.js'

export async function generateNewsVideo({ topic, category, duration = 7, aspectRatio = '9:16', style = 'modern news' }) {
  // 1. Fetch news
  let articles
  if (topic) {
    articles = await searchNews(topic, { pageSize: 5 })
  } else {
    articles = await fetchTopHeadlines({ category, pageSize: 5 })
  }

  if (articles.length === 0) throw new Error('No news articles found')

  // 2. Generate video script from news using LLM
  const newsSummary = articlesToSummary(articles)
  const scriptPrompt = `Create a ${duration}-second video script from these news headlines. Style: ${style}. Format as a video generation prompt with scene descriptions, timing, text overlays, and transitions. Keep it concise and visually engaging.

News:
${newsSummary}

Output a single video generation prompt.`

  let optimizedPrompt
  if (process.env.GEMINI_API_KEY) {
    const resp = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': process.env.GEMINI_API_KEY },
        body: JSON.stringify({
          contents: [{ parts: [{ text: scriptPrompt }] }],
          generationConfig: { temperature: 0.7, maxOutputTokens: 2048 },
        }),
      }
    )
    const data = await resp.json()
    optimizedPrompt = data.candidates?.[0]?.content?.parts?.[0]?.text || newsSummary
  } else {
    optimizedPrompt = `News highlights: ${newsSummary}`
  }

  // 3. Generate video via Colab
  const result = await generateVideo({
    modelId: 'wan/v2.2',
    prompt: optimizedPrompt,
    duration,
    aspectRatio,
  })

  return {
    articles,
    prompt: optimizedPrompt,
    video: result.videos?.[0],
    provider: 'colab-wan',
    timestamp: new Date().toISOString(),
  }
}
