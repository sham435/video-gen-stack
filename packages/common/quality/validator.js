import { AudioManager } from '../../media/audio/manager.js'
import { TypographyManager } from '../../branding/templates/typography/manager.js'
import { getDb } from '../../database/news-engine.mjs'

export class QualityValidator {
  constructor() {
    this.audio = new AudioManager()
    this.typography = new TypographyManager()
    this.db = getDb()
  }

  validateAll(article, videoPath) {
    const results = {
      content: this.validateContent(article),
      template: this.validateTemplate(),
      audio: this.audio.checkQuality(videoPath),
      text: this.validateText(article),
      visual: this.validateVisual(article),
      totalScore: 0,
      passed: false,
    }

    const scores = {
      content: results.content.score,
      template: results.template.score,
      audio: results.audio.passed ? 100 : 30,
      text: results.text.score,
      visual: results.visual.score,
    }

    results.totalScore = Math.round(Object.values(scores).reduce((a, b) => a + b, 0) / Object.values(scores).length)
    results.passed = results.totalScore >= 70

    return results
  }

  validateContent(article) {
    const headline = article?.title || ''
    let score = 100
    const issues = []

    if (headline.length < 20) { score -= 20; issues.push('headline too short') }
    if (headline.length > 120) { score -= 15; issues.push('headline too long') }
    if (!article?.source?.name) { score -= 15; issues.push('missing source') }
    if (!article?.description || article.description.length < 30) { score -= 15; issues.push('missing or short description') }

    // Check for potentially problematic content
    const problematic = ['clickbait', 'fake', 'scam', 'shocking', 'you won\'t believe']
    if (problematic.some(w => headline.toLowerCase().includes(w))) {
      score -= 30; issues.push('clickbait language detected')
    }

    return { score: Math.max(0, score), issues, passed: score >= 70 }
  }

  validateTemplate() {
    const template = this.typography.getTemplate()
    const font = this.typography.getFont()
    let score = 100
    const issues = []

    if (!template) { score -= 50; issues.push('no active template') }
    if (!font) { score -= 30; issues.push('no font profile') }
    if (template && template.status !== 'active') { score -= 20; issues.push('template not active') }

    return { score: Math.max(0, score), issues, passed: score >= 70, template, font }
  }

  validateText(article) {
    const headline = article?.title || ''
    const result = this.typography.validateText(headline, null)
    let score = 100
    const issues = [...result.issues]

    // Check contrast (simplified - assumes dark bg + light text passes)
    const lower = headline.toLowerCase()
    if (lower.includes('scam') || lower.includes('shocking')) {
      score -= 20; issues.push('potentially misleading')
    }

    return { score: Math.max(0, score), issues, passed: score >= 70, ...result }
  }

  validateVisual(article) {
    // Simplified visual check
    let score = 100
    const issues = []

    if (!article?.urlToImage && !article?.description) {
      score -= 20; issues.push('no image available')
    }

    return { score: Math.max(0, score), issues, passed: score >= 70 }
  }

  async validateAudio(videoPath) {
    return this.audio.checkQuality(videoPath)
  }

  logValidation(articleId, results) {
    this.db.prepare(`
      UPDATE published_articles SET quality_score = ?, updated_at = datetime('now')
      WHERE id = ?
    `).run(results.totalScore, articleId)
  }
}
