import { getDb, hashHeadline, normalizeHeadline } from '../../database/news-engine.mjs'
import { randomUUID } from 'crypto'

export class DuplicateDetector {
  constructor() {
    this.db = getDb()
  }

  /**
   * Check if an article is a duplicate based on multiple criteria
   */
  check(article) {
    const headline = article.title || ''
    const url = article.url || ''
    const source = article.source?.name || ''
    const normalized = normalizeHeadline(headline)
    const hash = hashHeadline(headline)
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()

    const results = []

    // 1. Same URL
    if (url) {
      const byUrl = this.db.prepare(
        'SELECT id, headline, created_at FROM published_articles WHERE url = ? AND created_at > ? LIMIT 1'
      ).get(url, thirtyDaysAgo)
      if (byUrl) results.push({ reason: 'same_url', existing: byUrl })
    }

    // 2. Same headline hash (normalized)
    const byHash = this.db.prepare(
      'SELECT id, headline, created_at FROM published_articles WHERE headline_hash = ? AND created_at > ? LIMIT 1'
    ).get(hash, thirtyDaysAgo)
    if (byHash) results.push({ reason: 'same_headline_hash', existing: byHash })

    // 3. Same source + similar headline (fuzzy)
    if (source && normalized.length > 20) {
      const recentBySource = this.db.prepare(`
        SELECT id, headline, headline_hash FROM published_articles
        WHERE source = ? AND created_at > ? AND status = 'published'
        ORDER BY created_at DESC LIMIT 10
      `).all(source, thirtyDaysAgo)

      for (const existing of recentBySource) {
        // Simple similarity: normalized hash comparison
        const existingNorm = normalizeHeadline(existing.headline)
        const words1 = new Set(normalized.split(' '))
        const words2 = new Set(existingNorm.split(' '))
        const intersection = new Set([...words1].filter(w => words2.has(w)))
        const union = new Set([...words1, ...words2])
        const similarity = intersection.size / union.size

        if (similarity > 0.7) {
          results.push({ reason: 'fuzzy_match', similarity, existing })
        }
      }
    }

    return {
      isDuplicate: results.length > 0,
      matches: results,
      hash,
      normalized,
    }
  }

  /**
   * Mark article as published (so future checks find it)
   */
  record(article, youtubeVideoId, qualityScore) {
    const headline = article.title || ''
    const hash = hashHeadline(headline)
    const contentId = `${new Date().toISOString().slice(0, 10).replace(/-/g, '')}-tech-${hash.slice(0, 12)}`

    const existing = this.db.prepare(
      'SELECT id FROM published_articles WHERE headline_hash = ?'
    ).get(hash)

    if (existing) {
      this.db.prepare(
        "UPDATE published_articles SET status = ?, youtube_video_id = ?, quality_score = ?, updated_at = datetime('now') WHERE id = ?"
      ).run('published', youtubeVideoId, qualityScore, existing.id)
      return existing.id
    }

    const id = randomUUID()
    this.db.prepare(`
      INSERT INTO published_articles (id, content_id, headline, headline_hash, url, source, author, youtube_video_id, quality_score, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id, contentId, headline, hash,
      article.url || '', article.source?.name || '',
      article.author || '',
      youtubeVideoId, qualityScore, 'published'
    )
    return id
  }

  logPipeline(contentId, stage, status, message, durationMs) {
    const id = randomUUID()
    this.db.prepare(`
      INSERT INTO pipeline_logs (id, content_id, stage, status, message, duration_ms)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(id, contentId, stage, status, message, durationMs)
  }

  close() {
    this.db.close()
  }
}
