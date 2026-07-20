import { Router } from 'express'
import { fetchTopHeadlines, searchNews, articlesToSummary } from '../services/news.js'

const router = Router()

router.get('/headlines', async (req, res) => {
  try {
    const { category, country, pageSize } = req.query
    const articles = await fetchTopHeadlines({ category, country, pageSize: parseInt(pageSize) || 10 })
    res.json({ articles, count: articles.length })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

router.get('/search', async (req, res) => {
  try {
    const { q, pageSize } = req.query
    if (!q) return res.status(400).json({ error: 'query param "q" required' })
    const articles = await searchNews(q, { pageSize: parseInt(pageSize) || 10 })
    res.json({ articles, count: articles.length })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

export default router
