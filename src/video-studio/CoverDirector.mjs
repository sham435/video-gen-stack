import { BrandStyleResolver } from '../visual/BrandStyleResolver.mjs'
import { seededFrom } from '../style/seeded-random.mjs'

const CATEGORY_VISUALS = {
  technology: { hero: 'cinematic close-up of a futuristic smartphone, AI holographic interface, dramatic lighting, dark premium technology background, 8K', style: 'premium tech magazine', mood: 'innovative futuristic' },
  ai: { hero: 'futuristic AI neural interface, glowing holographic brain, dark cinematic environment, cyberpunk lighting, 8K', style: 'sci-fi editorial', mood: 'innovative futuristic' },
  gaming: { hero: 'next generation gaming console, neon cyberpunk environment, dramatic cinematic lighting, esports magazine style, 8K', style: 'esports magazine', mood: 'hype' },
  space: { hero: 'Mars colony, astronaut silhouette, deep space background, National Geographic documentary style, 8K', style: 'documentary', mood: 'epic' },
  science: { hero: 'laboratory research, microscopic detail, blue scientific lighting, photorealistic, 8K', style: 'scientific journal', mood: 'discovery' },
  politics: { hero: 'documentary photojournalism, authoritative newsroom, dramatic lighting, 8K', style: 'news documentary', mood: 'serious' },
  finance: { hero: 'premium newsroom, stock market tickers, gold and navy accents, professional, 8K', style: 'financial report', mood: 'authoritative' },
  health: { hero: 'clean medical visualization, clinical white environment, professional, 8K', style: 'medical editorial', mood: 'trustworthy' },
  sports: { hero: 'peak action moment, dramatic stadium lighting, motion energy, 8K', style: 'sports broadcast', mood: 'energetic' },
  default: { hero: 'cinematic news scene, dramatic lighting, premium editorial quality, 8K', style: 'news editorial', mood: 'breaking' },
}

const OVERLAY_PAIRS = [
  ['AI REVEAL', 'GAME CHANGER'],
  ['EXCLUSIVE', 'BREAKTHROUGH'],
  ['BREAKING', 'NEW DETAILS'],
  ['FIRST LOOK', 'INNOVATION'],
  ['WHY IT', 'MATTERS'],
  ['THE TRUTH', 'BEHIND IT'],
  ['INSIDE', 'THE STORY'],
  ['NOBODY', 'EXPECTED THIS'],
  ['CHANGED', 'OVERNIGHT'],
  ['WHAT HAPPENED', 'NEXT'],
]

export class CoverDirector {
  constructor(aiProvider = null) {
    this.ai = aiProvider
    this.resolver = new BrandStyleResolver()
  }

  async analyzeStory(article, options = {}) {
    const ai = await this._aiConcept(article)
    const fallback = this._deterministic(article)
    // Style variant override for tournament mode
    const styleOverride = options.style ? this._styleVariant(options.style, fallback) : null
    return {
      headline: article.title || 'Tech News',
      subject: ai.subject || fallback.subject,
      visual_style: styleOverride?.visual_style || ai.style || fallback.visual_style,
      mood: styleOverride?.mood || ai.mood || fallback.mood,
      accent_color: ai.brandColor || fallback.accent_color,
      hero_prompt: styleOverride?.hero_prompt || ai.hero_prompt || fallback.hero_prompt,
      text_overlay: styleOverride?.text_overlay || ai.text_overlay || fallback.text_overlay,
      keywords: ai.keywords || fallback.keywords,
      source: ai.source || 'deterministic',
      style_variant: options.style || null,
      algorithm: fallback.algorithm || ai.algorithm || null,
    }
  }

  _styleVariant(style, fallback) {
    const base = fallback
    switch (style) {
      case 'breaking':
        return { visual_style: 'breaking news broadcast', mood: 'breaking', text_overlay: { top: base.text_overlay?.top || 'BREAKING', bottom: 'NEW DETAILS' }, hero_prompt: 'high urgency newsroom, red alert lighting, breaking news ticker, 8K' }
      case 'cinematic':
        return { visual_style: 'cinematic film', mood: 'epic', hero_prompt: `${base.hero_prompt || base.subject}, cinematic film grade, anamorphic, dramatic, 8K` }
      case 'minimal':
        return { visual_style: 'minimal editorial', mood: 'clean', text_overlay: { top: base.text_overlay?.top, bottom: base.text_overlay?.bottom }, hero_prompt: 'clean minimal composition, negative space, soft even lighting, premium editorial' }
      case 'reaction':
        return { visual_style: 'reaction close-up', mood: 'emotional', hero_prompt: 'extreme close-up emotional subject, dramatic eyes, shallow depth of field, high contrast' }
      case 'data':
        return { visual_style: 'data visualization', mood: 'authoritative', hero_prompt: 'big numbers, data charts, infographic style, glowing data on dark background, professional' }
      default:
        return null
    }
  }

  async _aiConcept(article) {
    if (!this.ai) return {}
    try {
      const result = await this.ai.generate([
        {
          role: 'system',
          content: `You are a Cover Director for a news video channel. Given a headline and category, output a cover brief as JSON.

Output ONLY JSON:
{
  "subject": "main visual subject",
  "hero_prompt": "detailed cinematic image prompt for the hero background",
  "visual_style": "editorial style name",
  "mood": "one word",
  "accent_color": "#HEX",
  "text_overlay": { "top": "2-3 word badge", "bottom": "2-3 word badge" },
  "keywords": ["3 visual search terms"]
}`
        },
        {
          role: 'user',
          content: `Headline: ${article.title || ''}\nCategory: ${article.category || 'technology'}\nSummary: ${(article.description || '').slice(0, 400)}`
        }
      ], { json: true })
      if (!result || (!result.subject && !result.hero_prompt)) return {}
      return {
        subject: result.subject,
        hero_prompt: result.hero_prompt,
        visual_style: result.visual_style,
        mood: result.mood,
        accent_color: result.accent_color,
        text_overlay: { top: (result.text_overlay?.top || '').toUpperCase(), bottom: (result.text_overlay?.bottom || '').toUpperCase() },
        keywords: result.keywords || [],
        source: 'ai',
      }
    } catch { return {} }
  }

  _deterministic(article) {
    const category = (article.category || 'default').toLowerCase()
    const catVisual = CATEGORY_VISUALS[category] || CATEGORY_VISUALS.default
    // 48-algorithm diversity: resolve() now returns algorithm + shifted color +
    // per-algorithm visual style, so covers never repeat the same look twice.
    const resolved = this.resolver.resolve(article.title || '', category)
    const algo = resolved.algorithm
    const brand = resolved.brand
    const subject = brand || (article.title || 'TECH').split(' ').slice(0, 2).join(' ')
    // Deterministic overlay pick — seeded by title so identical input → identical cover.
    const idx = seededFrom(article.title || '') % OVERLAY_PAIRS.length
    const [top, bottom] = OVERLAY_PAIRS[idx]
    const words = (article.title || '').replace(/[^a-zA-Z0-9 ]/g, ' ').split(' ').filter(w => w.length > 3)
    const badge = brand ? brand.toUpperCase() : (words[0] || 'TECH').toUpperCase()
    return {
      subject,
      visual_style: algo?.visual?.prompt || catVisual.style,
      mood: catVisual.mood,
      accent_color: resolved.brandColor || '#E10600',
      hero_prompt: catVisual.hero,
      text_overlay: { top: badge, bottom },
      keywords: [algo?.visual?.pexels, ...words.slice(0, 2)].filter(Boolean),
      source: 'deterministic',
      algorithm: algo,
    }
  }
}
