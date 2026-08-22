// CategoryProductionProfiles — the production policy registry.
//
// This answers: "How should we PRODUCE content for this niche?"
// It is SEPARATE from NicheResolver (which answers: "What is this article about?").
//
// Every downstream stage (CoverComposer, SceneEngine, Text/HookBuilder,
// MetadataBuilder) consumes the same profile. Adding a new niche
// (NVIDIA, OPENAI, ROBOTICS, ...) is ONE object entry — no rendering
// logic changes anywhere.
//
// Fields:
//   label            — display text for the red pill (e.g. "TESLA")
//   accent           — hex color for the pill, top bar, glow
//   coverStyle       — CoverComposer layout family
//   hookStyle        — editorial hook archetype
//   visualDensity    — scene density hint (low / medium / high)
//   motion           — camera motion hint
//   preferredVisuals — image search keywords for hero image
//   tone             — narration tone

export const CategoryProductionProfiles = Object.freeze({

  TESLA: Object.freeze({
    label: 'TESLA',
    accent: '#E82127',
    coverStyle: 'automotive-tech',
    hookStyle: 'breaking',
    visualDensity: 'high',
    motion: 'dynamic',
    preferredVisuals: Object.freeze(['tesla', 'electric vehicle', 'factory', 'elon musk']),
    tone: 'excited',
  }),

  APPLE: Object.freeze({
    label: 'APPLE',
    accent: '#111111',
    coverStyle: 'premium-tech',
    hookStyle: 'reveal',
    visualDensity: 'medium',
    motion: 'smooth',
    preferredVisuals: Object.freeze(['iphone', 'macbook', 'apple product', 'apple store']),
    tone: 'analytical',
  }),

  AI: Object.freeze({
    label: 'AI',
    accent: '#7C3AED',
    coverStyle: 'futuristic-tech',
    hookStyle: 'curiosity',
    visualDensity: 'high',
    motion: 'fast',
    preferredVisuals: Object.freeze(['robot', 'neural network', 'server room', 'ai chip']),
    tone: 'excited',
  }),

  SAMSUNG: Object.freeze({
    label: 'SAMSUNG',
    accent: '#1428A0',
    coverStyle: 'premium-tech',
    hookStyle: 'reveal',
    visualDensity: 'medium',
    motion: 'smooth',
    preferredVisuals: Object.freeze(['samsung galaxy', 'smartphone', 'foldable phone']),
    tone: 'analytical',
  }),

  GOOGLE: Object.freeze({
    label: 'GOOGLE',
    accent: '#4285F4',
    coverStyle: 'futuristic-tech',
    hookStyle: 'curiosity',
    visualDensity: 'high',
    motion: 'dynamic',
    preferredVisuals: Object.freeze(['google', 'data center', 'waymo', 'android']),
    tone: 'authoritative',
  }),

  MICROSOFT: Object.freeze({
    label: 'MICROSOFT',
    accent: '#00A4EF',
    coverStyle: 'premium-tech',
    hookStyle: 'breaking',
    visualDensity: 'medium',
    motion: 'smooth',
    preferredVisuals: Object.freeze(['microsoft', 'windows', 'surface', 'xbox']),
    tone: 'authoritative',
  }),

  SPACE: Object.freeze({
    label: 'SPACE',
    accent: '#0B3D91',
    coverStyle: 'cinematic',
    hookStyle: 'curiosity',
    visualDensity: 'high',
    motion: 'dynamic',
    preferredVisuals: Object.freeze(['rocket', 'spacex', 'mars', 'space station']),
    tone: 'excited',
  }),

  GAMING: Object.freeze({
    label: 'GAMING',
    accent: '#FF6B35',
    coverStyle: 'bold',
    hookStyle: 'shock',
    visualDensity: 'high',
    motion: 'fast',
    preferredVisuals: Object.freeze(['playstation', 'xbox', 'gaming setup', 'esports']),
    tone: 'excited',
  }),

  CRYPTO: Object.freeze({
    label: 'CRYPTO',
    accent: '#F7931A',
    coverStyle: 'data',
    hookStyle: 'data',
    visualDensity: 'medium',
    motion: 'dynamic',
    preferredVisuals: Object.freeze(['bitcoin', 'crypto trading', 'blockchain', 'ethereum']),
    tone: 'analytical',
  }),

  GENERAL: Object.freeze({
    label: 'NEWS',
    accent: '#E10600',
    coverStyle: 'breaking',
    hookStyle: 'breaking',
    visualDensity: 'medium',
    motion: 'smooth',
    preferredVisuals: Object.freeze(['newsroom', 'technology', 'breaking news']),
    tone: 'authoritative',
  }),

})

// ─── getProfile ──────────────────────────────────────────────────────────────
// Look up the production profile for a niche key. Falls back to GENERAL.
export function getProfile(nicheKey) {
  const key = String(nicheKey || '').toUpperCase().replace(/[^A-Z]/g, '')
  return CategoryProductionProfiles[key] || CategoryProductionProfiles.GENERAL
}

// ─── getAccentColor ──────────────────────────────────────────────────────────
export function getAccentColor(nicheKey) {
  return getProfile(nicheKey).accent
}

// ─── listProfiles ────────────────────────────────────────────────────────────
export function listProfiles() {
  return Object.entries(CategoryProductionProfiles).map(([niche, profile]) => ({ niche, ...profile }))
}
