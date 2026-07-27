const BRAND_MAP = {
  apple: 'APPLE', ios: 'APPLE', iphone: 'APPLE', mac: 'APPLE', ipad: 'APPLE',
  samsung: 'SAMSUNG', galaxy: 'SAMSUNG',
  google: 'GOOGLE', pixel: 'GOOGLE',
  microsoft: 'MICROSOFT', windows: 'MICROSOFT', xbox: 'MICROSOFT',
  meta: 'META', facebook: 'META', instagram: 'META', whatsapp: 'META',
  tesla: 'TESLA',
  openai: 'OPENAI', chatgpt: 'OPENAI', gpt: 'OPENAI',
  amazon: 'AMAZON', aws: 'AMAZON', alexa: 'AMAZON',
  nvidia: 'NVIDIA',
  twitter: 'X', x: 'X',
  netflix: 'NETFLIX',
  spotify: 'SPOTIFY',
  sony: 'SONY', playstation: 'SONY',
  intel: 'INTEL',
  amd: 'AMD',
  qualcomm: 'QUALCOMM', snapdragon: 'QUALCOMM',
  tiktok: 'TIKTOK',
  uber: 'UBER',
  spacex: 'SPACEX',
}

const STOP_WORDS = new Set([
  'the', 'a', 'an', 'is', 'are', 'was', 'were', 'to', 'of', 'in',
  'for', 'on', 'and', 'or', 'but', 'this', 'that', 'with', 'from',
  'its', 'has', 'had', 'have', 'not', 'will', 'new', 'how', 'why',
  'just', 'all', 'can', 'been', 'more', 'than', 'also', 'very',
])

export class ScriptPlanner {
  plan(title, description, source) {
    const brand = this.detectBrand(title)
    const keywords = this.extractKeywords(title)
    const facts = this.extractFacts(title, brand)
    const explanations = this.buildExplanations(title, description)
    const timeFrame = this.detectTimeFrame(description)

    return { brand, keywords, facts, explanations, timeFrame }
  }

  detectBrand(title) {
    const lower = title.toLowerCase()
    for (const [key, brand] of Object.entries(BRAND_MAP)) {
      if (lower.includes(key)) return brand
    }
    return null
  }

  extractKeywords(title) {
    const words = title.toLowerCase()
      .replace(/[^a-z0-9 ]/g, ' ')
      .split(/\s+/)
      .filter(w => w.length > 3 && !STOP_WORDS.has(w))

    if (words.length === 0) return ['technology']
    return words.slice(0, 4)
  }

  extractFacts(title, brand) {
    const clean = title.replace(/[^a-zA-Z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim()
    const words = clean.split(' ').filter(w => w.length > 0)

    const who = brand || (words[0]?.toUpperCase() || 'TECH')
    const what = words.slice(1, 3).join(' ').toUpperCase() || 'ANNOUNCEMENT'
    const where = this.detectLocation(title) || 'GLOBAL RELEASE'
    const when = 'LATEST UPDATE'

    return [
      { label: 'WHO', text: who, priority: 1 },
      { label: 'WHAT', text: `${who} ${what}`.slice(0, 30), priority: 1 },
      { label: 'WHERE', text: where, priority: 1 },
      { label: 'WHEN', text: when, priority: 1 },
    ]
  }

  detectLocation(title) {
    const lower = title.toLowerCase()
    if (lower.includes('worldwide') || lower.includes('global')) return 'GLOBAL RELEASE'
    if (lower.includes('us') || lower.includes('america') || lower.includes('united states')) return 'US RELEASE'
    if (lower.includes('europe') || lower.includes('eu') || lower.includes('uk')) return 'EUROPE RELEASE'
    if (lower.includes('china') || lower.includes('asia')) return 'ASIA RELEASE'
    if (lower.includes('india')) return 'INDIA RELEASE'
    return 'GLOBAL RELEASE'
  }

  detectTimeFrame(description) {
    if (!description) return 'LATEST UPDATE'
    const lower = description.toLowerCase()
    if (lower.includes('today') || lower.includes('just') || lower.includes('now')) return 'RELEASED TODAY'
    if (lower.includes('yesterday')) return 'RELEASED YESTERDAY'
    if (lower.includes('this week')) return 'THIS WEEK'
    if (lower.includes('next week') || lower.includes('coming')) return 'COMING SOON'
    if (lower.includes('2025') || lower.includes('2026') || lower.includes('2027')) return `RELEASED ${lower.match(/202[5-7]/)?.[0] || ''}`
    return 'LATEST UPDATE'
  }

  buildExplanations(title, description) {
    if (!description || description.length < 15) {
      return [
        `${title}. This is a major development in the technology sector.`,
        `Industry experts are closely monitoring this announcement.`,
      ]
    }
    const sentences = description.split(/[.!?]+/).filter(s => s.trim().length > 10)
    if (sentences.length === 0) {
      return [`${title}. ${description}`.slice(0, 200)]
    }
    return sentences.slice(0, 4).map(s => s.trim() + '.')
  }

  generateRetentionHook(title, brand) {
    const hooks = [
      `But there is one hidden detail nobody noticed...`,
      `However, there is a catch you need to know about.`,
      `What ${brand || 'the company'} did not tell you changes everything.`,
      `This shifts the entire industry. Here is how.`,
      `The real story is not what you think.`,
      `Behind the scenes, something bigger is happening.`,
    ]
    return hooks[Math.floor(Math.random() * hooks.length)]
  }

  estimateDuration(scenes) {
    return scenes.reduce((sum, s) => sum + (s.end - s.start), 0)
  }
}
