export const THEMES = {
  technology: {
    name: 'technology_blue_v2',
    background: ['#071426', '#0B1D3A', '#0F2B4D'],
    primary: '#3B82F6',
    secondary: '#22D3EE',
    glow: '#60A5FA',
    accent: '#93C5FD',
    line: '#3B82F6',
    gradient: 'navy → blue → cyan',
    mood: 'premium futuristic',
  },
  ai: {
    name: 'ai_electric_v1',
    background: ['#0A0A1A', '#1A0A2E', '#0D1B3E'],
    primary: '#8B5CF6',
    secondary: '#3B82F6',
    glow: '#A78BFA',
    accent: '#C4B5FD',
    line: '#8B5CF6',
    gradient: 'deep black → electric purple → blue',
    mood: 'futuristic AI',
  },
  apple: {
    name: 'apple_premium_v1',
    background: ['#0A0A0F', '#1A1A2E', '#16213E'],
    primary: '#3B82F6',
    secondary: '#60A5FA',
    glow: '#93C5FD',
    accent: '#BFDBFE',
    line: '#3B82F6',
    gradient: 'deep black → navy → electric blue',
    mood: 'Apple keynote premium',
  },
  samsung: {
    name: 'samsung_modern_v1',
    background: ['#0B0F1A', '#1A0F2E', '#0F1B2E'],
    primary: '#6366F1',
    secondary: '#8B5CF6',
    glow: '#818CF8',
    accent: '#A5B4FC',
    line: '#6366F1',
    gradient: 'deep blue → purple → midnight',
    mood: 'modern technology',
  },
  cybersecurity: {
    name: 'security_red_v1',
    background: ['#0F0505', '#1A0808', '#2A0A0A'],
    primary: '#EF4444',
    secondary: '#DC2626',
    glow: '#F87171',
    accent: '#FCA5A5',
    line: '#EF4444',
    gradient: 'dark red → crimson → black',
    mood: 'security alert',
  },
  science: {
    name: 'science_teal_v1',
    background: ['#071F1A', '#0A2A24', '#0D352E'],
    primary: '#14B8A6',
    secondary: '#2DD4BF',
    glow: '#5EEAD4',
    accent: '#99F6E4',
    line: '#14B8A6',
    gradient: 'dark teal → emerald → deep green',
    mood: 'scientific discovery',
  },
  business: {
    name: 'business_green_v1',
    background: ['#0A1A0A', '#0F240F', '#142E14'],
    primary: '#10B981',
    secondary: '#34D399',
    glow: '#6EE7B7',
    accent: '#A7F3D0',
    line: '#10B981',
    gradient: 'dark green → emerald → forest',
    mood: 'professional finance',
  },
  health: {
    name: 'health_blue_v1',
    background: ['#071420', '#0B1F30', '#0F2940'],
    primary: '#06B6D4',
    secondary: '#22D3EE',
    glow: '#67E8F9',
    accent: '#A5F3FC',
    line: '#06B6D4',
    gradient: 'dark teal → cyan → deep blue',
    mood: 'medical professional',
  },
  entertainment: {
    name: 'entertainment_violet_v1',
    background: ['#140A1A', '#1F0F2E', '#2A143E'],
    primary: '#D946EF',
    secondary: '#E879F9',
    glow: '#F0ABFC',
    accent: '#F5D0FE',
    line: '#D946EF',
    gradient: 'deep violet → magenta → dark',
    mood: 'entertainment vibrant',
  },
  breaking: {
    name: 'breaking_red_v2',
    background: ['#180505', '#240808', '#300A0A'],
    primary: '#EF4444',
    secondary: '#F87171',
    glow: '#FCA5A5',
    accent: '#FECACA',
    line: '#EF4444',
    gradient: 'dark crimson → red → black',
    mood: 'breaking news alert',
  },
  default: {
    name: 'default_blue_v1',
    background: ['#07111F', '#0B172A', '#111827'],
    primary: '#3B82F6',
    secondary: '#22D3EE',
    glow: '#60A5FA',
    accent: '#93C5FD',
    line: '#3B82F6',
    gradient: 'dark navy → blue → cyan',
    mood: 'professional news',
  },
}

export const BREAKING_KEYWORDS = ['breaking', 'urgent', 'alert', 'just in', 'developing', 'exclusive']

export function detectTheme(headline, category = 'technology') {
  const lower = (headline || '').toLowerCase()

  // Check for breaking keywords
  if (BREAKING_KEYWORDS.some(k => lower.includes(k))) {
    return { ...THEMES.breaking, isBreaking: true }
  }

  // Check headline for brand/theme hints
  if (lower.includes('apple') || lower.includes('iphone') || lower.includes('siri') || lower.includes('ios') || lower.includes('macbook')) {
    return { ...THEMES.apple, isBreaking: false }
  }
  if (lower.includes('samsung') || lower.includes('galaxy') || lower.includes('fold')) {
    return { ...THEMES.samsung, isBreaking: false }
  }
  if (lower.includes('ai') || lower.includes('chatgpt') || lower.includes('openai') || lower.includes('machine learning') || lower.includes('neural')) {
    return { ...THEMES.ai, isBreaking: false }
  }
  if (lower.includes('cyber') || lower.includes('hack') || lower.includes('security') || lower.includes('breach') || lower.includes('malware')) {
    return { ...THEMES.cybersecurity, isBreaking: false }
  }
  if (lower.includes('space') || lower.includes('nasa') || lower.includes('rocket') || lower.includes('mars') || lower.includes('galaxy')) {
    return { ...THEMES.science, isBreaking: false }
  }

  // Category-based fallback
  const cat = category?.toLowerCase() || 'technology'
  return THEMES[cat] || THEMES.technology
}

export function renderBG(color) {
  return color.replace('0x', '#')
}

export function ffmpegColor(color) {
  return color.replace('#', '0x')
}
