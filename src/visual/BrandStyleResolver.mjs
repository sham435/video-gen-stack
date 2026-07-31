const BRAND_COLORS = {
  apple: '#A2AAAD', iphone: '#A2AAAD', ios: '#A2AAAD', mac: '#A2AAAD',
  samsung: '#1428A0', galaxy: '#1428A0',
  google: '#4285F4', pixel: '#4285F4',
  microsoft: '#F25022', windows: '#0078D4', xbox: '#107C10',
  meta: '#0668E1', facebook: '#1877F2', instagram: '#E4405F', whatsapp: '#25D366',
  tesla: '#CC0000', spacex: '#005288',
  openai: '#10A37F', chatgpt: '#10A37F', gpt: '#10A37F',
  amazon: '#FF9900', aws: '#FF9900', alexa: '#00A8E1',
  nvidia: '#76B900',
  twitter: '#1D9BF0', x: '#000000',
  netflix: '#E50914', spotify: '#1DB954',
  sony: '#003791', playstation: '#003791', ps5: '#003791',
  intel: '#0071C5', amd: '#ED1C24',
  qualcomm: '#3253DC', snapdragon: '#3253DC',
  tiktok: '#00F2EA', uber: '#000000',
  nintendo: '#E60012', switch: '#E60012',
  riot: '#D13639', epic: '#000000', fortnite: '#7F7F7F',
}

const CATEGORY_STYLES = {
  ai: { color: '#00E5FF', style: 'dark futuristic, holographic UI, neon data streams', mood: 'futuristic' },
  space: { color: '#FFFFFF', style: 'cinematic NASA style, deep space, stars, nebula', mood: 'epic' },
  gaming: { color: '#E100FF', style: 'neon, characters, hardware, arcade glow', mood: 'hype' },
  politics: { color: '#E10600', style: 'documentary photojournalism, newsroom', mood: 'serious' },
  finance: { color: '#FFD700', style: 'premium newsroom, stock tickers, gold accents', mood: 'authoritative' },
  health: { color: '#00FF88', style: 'clean medical visualization, white clinical', mood: 'trustworthy' },
  science: { color: '#00E5FF', style: 'laboratory, blue tones, microscopic detail', mood: 'discovery' },
  sports: { color: '#FFD700', style: 'stadium energy, motion, vibrant', mood: 'energetic' },
  robotics: { color: '#FF6B00', style: 'mechanical detail, industrial lighting', mood: 'innovative' },
  cybersecurity: { color: '#00FF41', style: 'dark digital, glowing code, matrix', mood: 'threat' },
  technology: { color: '#E10600', style: 'futuristic technology, neon blue/red, cyberpunk', mood: 'breaking' },
  lifestyle: { color: '#FF6B9D', style: 'clean modern, warm lighting, premium', mood: 'aspirational' },
  business: { color: '#3B82F6', style: 'corporate, financial district, professional', mood: 'authoritative' },
  entertainment: { color: '#E100FF', style: 'vibrant, colorful, dynamic', mood: 'exciting' },
  default: { color: '#E10600', style: 'cinematic news broadcast, dramatic lighting', mood: 'breaking' },
}

export class BrandStyleResolver {
  resolveBrand(title) {
    const lower = (title || '').toLowerCase()
    for (const [key, color] of Object.entries(BRAND_COLORS)) {
      if (lower.includes(key)) return { brand: key, color }
    }
    return { brand: null, color: null }
  }

  resolveCategory(category) {
    return CATEGORY_STYLES[category] || CATEGORY_STYLES.default
  }

  resolve(title, category) {
    const brand = this.resolveBrand(title)
    const cat = this.resolveCategory(category)
    const color = brand.color || cat.color
    return {
      brand: brand.brand,
      brandColor: color,
      style: cat.style,
      mood: cat.mood,
    }
  }

  static get BRAND_COLORS() { return BRAND_COLORS }
  static get CATEGORY_STYLES() { return CATEGORY_STYLES }
}
