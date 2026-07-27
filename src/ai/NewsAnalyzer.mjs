export class NewsAnalyzer {
  analyze(article) {
    const title = article.title || ''
    const desc = article.description || ''
    const source = article.source?.name || article.source || 'NewsAPI'

    const scenes = this.buildScenes(title, desc, source)
    const keywords = this.extractKeywords(title, desc)

    return { scenes, keywords, source }
  }

  buildScenes(title, desc, source) {
    const clean = title.replace(/[^a-zA-Z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim()
    const words = clean.split(' ').filter(w => w.length > 0)
    const topWords = words.slice(0, 4).map(w => w.toUpperCase())

    const brand = this.detectBrand(title)

    return {
      hook: {
        text: `${topWords[0] || 'BREAKING'} ${topWords[1] || 'NEWS'}`,
        headline: 'BREAKING',
        subheadline: title.slice(0, 60),
      },
      facts: [
        { text: (brand || topWords[0] || 'TECH').toUpperCase(), visual: 'logo' },
        { text: (words.slice(1, 3).join(' ') || 'ANNOUNCEMENT').toUpperCase(), visual: 'product' },
        { text: 'NOW AVAILABLE', visual: 'global' },
        { text: this.extractTimeframe(desc), visual: 'time' },
      ],
      explanation: this.generateExplanation(desc, title),
      retention: this.generateRetentionHook(title, desc),
    }
  }

  detectBrand(title) {
    const brands = {
      apple: 'APPLE', ios: 'APPLE', iphone: 'APPLE', mac: 'APPLE',
      samsung: 'SAMSUNG', galaxy: 'SAMSUNG',
      google: 'GOOGLE', pixel: 'GOOGLE',
      microsoft: 'MICROSOFT', windows: 'MICROSOFT',
      meta: 'META', facebook: 'META', instagram: 'META',
      tesla: 'TESLA', twitter: 'X', x: 'X',
      openai: 'OPENAI', chatgpt: 'OPENAI', gpt: 'OPENAI',
      amazon: 'AMAZON', aws: 'AMAZON', alexa: 'AMAZON',
      nvidia: 'NVIDIA',
    }
    const t = title.toLowerCase()
    for (const [key, brand] of Object.entries(brands)) {
      if (t.includes(key)) return brand
    }
    return null
  }

  extractKeywords(title, desc) {
    const stopWords = new Set(['the', 'a', 'an', 'is', 'are', 'was', 'were', 'to', 'of', 'in', 'for', 'on', 'and', 'or', 'but', 'this', 'that', 'with', 'from', 'its', 'has', 'had', 'have', 'not', 'will', 'new'])
    const words = title.toLowerCase().replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).filter(w => w.length > 3 && !stopWords.has(w))
    const map = {
      apple: 'iPhone technology', ios: 'iPhone', samsung: 'Galaxy smartphone', galaxy: 'Galaxy',
      google: 'Google technology', microsoft: 'Microsoft', tesla: 'Tesla electric car',
      ai: 'artificial intelligence technology', crypto: 'cryptocurrency',
    }
    return words.map(w => map[w] || w).slice(0, 4)
  }

  extractTimeframe(desc) {
    const lower = desc.toLowerCase()
    if (lower.includes('today') || lower.includes('just')) return 'RELEASED TODAY'
    if (lower.includes('yesterday')) return 'RELEASED YESTERDAY'
    if (lower.includes('this week')) return 'THIS WEEK'
    if (lower.includes('next week') || lower.includes('upcoming')) return 'COMING SOON'
    return 'LATEST UPDATE'
  }

  generateExplanation(desc, title) {
    if (!desc || desc.length < 20) {
      return [`${title}. This is a major development in the technology sector.`, `Industry experts are closely watching this story unfold.`]
    }
    const sentences = desc.split(/[.!?]+/).filter(s => s.trim().length > 10)
    return sentences.slice(0, 4).map(s => s.trim() + '.')
  }

  generateRetentionHook(title, desc) {
    const hooks = [
      `But there is one hidden detail nobody noticed...`,
      `However, there is a catch you need to know about.`,
      `What the company did not tell you is surprising.`,
      `This changes everything for the industry. Here is how.`,
    ]
    return hooks[Math.floor(Math.random() * hooks.length)]
  }
}
