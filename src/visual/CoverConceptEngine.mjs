import { BrandStyleResolver } from './BrandStyleResolver.mjs'

export class CoverConceptEngine {
  constructor(aiProvider = null) {
    this.ai = aiProvider
    this.resolver = new BrandStyleResolver()
  }

  async generate(article, options = {}) {
    if (this.ai) {
      try {
        const result = await this.ai.generate([
          {
            role: 'system',
            content: `You are a visual director for a news video channel. Given a news headline, category, and summary, extract a cover concept as JSON.

Output ONLY JSON:
{
  "subject": "primary subject (company/product/entity)",
  "visual_keywords": ["3 specific objects for the background"],
  "mood": "one word: hype|breaking|mysterious|epic|serious|futuristic|energetic|discovery",
  "brand_color": "#HEX",
  "headline_style": "breaking|reveal|question|stat",
  "overlay_text": "short 2-4 word teaser badge (e.g. SWITCH 2 LEAK, XBOX VS PS5)"
}`
          },
          {
            role: 'user',
            content: `Title: ${article.title || ''}\nCategory: ${article.category || 'technology'}\nSummary: ${(article.description || '').slice(0, 400)}`
          }
        ], { json: true })

        if (result && (result.subject || result.visual_keywords)) {
          const fallback = this._deterministic(article)
          return {
            subject: result.subject || fallback.subject,
            visualKeywords: result.visual_keywords || fallback.visualKeywords,
            mood: result.mood || fallback.mood,
            brandColor: result.brand_color || fallback.brandColor,
            headlineStyle: result.headline_style || 'breaking',
            overlayText: (result.overlay_text || '').toUpperCase() || fallback.overlayText,
            source: 'ai',
          }
        }
      } catch (e) {
        console.log(`[CoverConcept] AI failed, using deterministic: ${e.message}`)
      }
    }
    return { ...this._deterministic(article), source: 'deterministic' }
  }

  _deterministic(article) {
    const title = article.title || 'Tech News'
    const category = article.category || 'technology'
    const { brand, brandColor, style, mood } = this.resolver.resolve(title, category)
    const words = title.replace(/[^a-zA-Z0-9 ]/g, ' ').split(' ').filter(w => w.length > 3)
    const subject = brand || (words[0] || 'TECH').toUpperCase()
    const overlayText = brand ? `${brand.toUpperCase()} UPDATE` : (words.slice(0, 2).join(' ').toUpperCase() || 'BREAKING NEWS')
    return {
      subject,
      visualKeywords: [subject, ...words.slice(0, 2)].filter(Boolean),
      mood,
      brandColor,
      headlineStyle: 'breaking',
      overlayText,
      style,
    }
  }
}
