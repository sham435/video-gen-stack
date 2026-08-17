import { pickAlgorithm } from '../ai/StoryAlgorithmRegistry.mjs'

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
  ai: { color: '#00E5FF', style: 'dark futuristic, holographic UI, neon data streams', mood: 'futuristic', anchorHook: 'NOBODY SAW THIS COMING' },
  space: { color: '#FFFFFF', style: 'cinematic NASA style, deep space, stars, nebula', mood: 'epic', anchorHook: 'NOBODY EXPECTED THIS MOVE' },
  gaming: { color: '#E100FF', style: 'neon, characters, hardware, arcade glow', mood: 'hype', anchorHook: 'NOBODY EXPECTED THIS MOVE' },
  politics: { color: '#E10600', style: 'documentary photojournalism, newsroom', mood: 'serious', anchorHook: 'NOBODY EXPECTED THIS MOVE' },
  finance: { color: '#FFD700', style: 'premium newsroom, stock tickers, gold accents', mood: 'authoritative', anchorHook: 'NOBODY EXPECTED THIS MOVE' },
  health: { color: '#00FF88', style: 'clean medical visualization, white clinical', mood: 'trustworthy', anchorHook: 'NOBODY EXPECTED THIS MOVE' },
  science: { color: '#00E5FF', style: 'laboratory, blue tones, microscopic detail', mood: 'discovery', anchorHook: 'NOBODY EXPECTED THIS MOVE' },
  sports: { color: '#FFD700', style: 'stadium energy, motion, vibrant', mood: 'energetic', anchorHook: 'NOBODY EXPECTED THIS MOVE' },
  robotics: { color: '#FF6B00', style: 'mechanical detail, industrial lighting', mood: 'innovative', anchorHook: 'NOBODY EXPECTED THIS MOVE' },
  cybersecurity: { color: '#00FF41', style: 'dark digital, glowing code, matrix', mood: 'threat', anchorHook: 'NOBODY EXPECTED THIS MOVE' },
  technology: { color: '#E10600', style: 'futuristic technology, neon blue/red, cyberpunk', mood: 'breaking', anchorHook: 'NOBODY EXPECTED THIS MOVE' },
  lifestyle: { color: '#FF6B9D', style: 'clean modern, warm lighting, premium', mood: 'aspirational', anchorHook: 'NOBODY EXPECTED THIS MOVE' },
  business: { color: '#3B82F6', style: 'corporate, financial district, professional', mood: 'authoritative', anchorHook: 'NOBODY EXPECTED THIS MOVE' },
  entertainment: { color: '#E100FF', style: 'vibrant, colorful, dynamic', mood: 'exciting', anchorHook: 'NOBODY EXPECTED THIS MOVE' },
  default: { color: '#E10600', style: 'cinematic news broadcast, dramatic lighting', mood: 'breaking', anchorHook: 'NOBODY EXPECTED THIS MOVE' },
}

export const ANCHOR_CONFIG = { name: 'sham435', label: 'sham435 · ANCHOR', channel: 'NEWS-MONSTER' }

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
    const algorithm = pickAlgorithm({ title, category })
    return {
      brand: brand.brand,
      brandColor: this._shiftColor(color, algorithm.number),
      style: algorithm.visual.prompt,
      mood: cat.mood,
      anchorHook: cat.anchorHook || 'NOBODY EXPECTED THIS MOVE',
      algorithm,
    }
  }

  _shiftColor(hex, n) {
    if (!/^#[0-9A-Fa-f]{6}$/.test(hex)) return hex
    const r = parseInt(hex.slice(1, 3), 16)
    const g = parseInt(hex.slice(3, 5), 16)
    const b = parseInt(hex.slice(5, 7), 16)
    const s = (n * 7) % 30 - 15
    const cl = v => Math.max(0, Math.min(255, v + s))
    return `rgb(${cl(r)},${cl(g)},${cl(b)})`
  }

  static get BRAND_COLORS() { return BRAND_COLORS }
  static get CATEGORY_STYLES() { return CATEGORY_STYLES }
}
