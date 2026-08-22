// CategoryProductionProfiles — niche-specific visual and editorial profiles.
//
// Every downstream stage (CoverComposer, SceneEngine, MetadataBuilder) consumes
// the same profile for a given niche. Adding a new niche (NVIDIA, OPENAI,
// ROBOTICS, ...) is one object entry — no rendering logic changes.
//
// Profile fields:
//   label          — display text for the red pill (e.g. "TESLA")
//   accent         — hex color for the pill, top bar, glow (e.g. "#E82127")
//   style          — CoverComposer layout style override
//   hookStyle      — editorial hook archetype (breaking / curiosity / reveal / data)
//   visualDensity  — scene density hint (low / medium / high)
//   motion         — camera motion hint (static / smooth / dynamic / fast)
//   preferredVisuals — image search keywords for hero image selection
//   tone           — narration tone (authoritative / excited / analytical)

import { NICHES } from './nicheResolver.mjs'

export const CategoryProductionProfiles = {
  TESLA: {
    label: 'TESLA',
    accent: '#E82127',
    style: 'automotive-tech',
    hookStyle: 'breaking',
    visualDensity: 'high',
    motion: 'dynamic',
    preferredVisuals: ['tesla', 'electric vehicle', 'factory', 'elon musk'],
    tone: 'excited',
  },

  APPLE: {
    label: 'APPLE',
    accent: '#111111',
    style: 'premium-tech',
    hookStyle: 'reveal',
    visualDensity: 'medium',
    motion: 'smooth',
    preferredVisuals: ['iphone', 'macbook', 'apple product', 'apple store'],
    tone: 'analytical',
  },

  AI: {
    label: 'AI',
    accent: '#7C3AED',
    style: 'futuristic-tech',
    hookStyle: 'curiosity',
    visualDensity: 'high',
    motion: 'fast',
    preferredVisuals: ['robot', 'neural network', 'server room', 'ai chip'],
    tone: 'excited',
  },

  SAMSUNG: {
    label: 'SAMSUNG',
    accent: '#1428A0',
    style: 'premium-tech',
    hookStyle: 'reveal',
    visualDensity: 'medium',
    motion: 'smooth',
    preferredVisuals: ['samsung galaxy', 'smartphone', 'foldable phone'],
    tone: 'analytical',
  },

  GOOGLE: {
    label: 'GOOGLE',
    accent: '#4285F4',
    style: 'futuristic-tech',
    hookStyle: 'curiosity',
    visualDensity: 'high',
    motion: 'dynamic',
    preferredVisuals: ['google', 'data center', 'waymo', 'android'],
    tone: 'authoritative',
  },

  MICROSOFT: {
    label: 'MICROSOFT',
    accent: '#00A4EF',
    style: 'premium-tech',
    hookStyle: 'breaking',
    visualDensity: 'medium',
    motion: 'smooth',
    preferredVisuals: ['microsoft', 'windows', 'surface', 'xbox'],
    tone: 'authoritative',
  },

  SPACE: {
    label: 'SPACE',
    accent: '#0B3D91',
    style: 'cinematic',
    hookStyle: 'curiosity',
    visualDensity: 'high',
    motion: 'dynamic',
    preferredVisuals: ['rocket', 'spacex', 'mars', 'space station'],
    tone: 'excited',
  },

  GAMING: {
    label: 'GAMING',
    accent: '#FF6B35',
    style: 'bold',
    hookStyle: 'shock',
    visualDensity: 'high',
    motion: 'fast',
    preferredVisuals: ['playstation', 'xbox', 'gaming setup', 'esports'],
    tone: 'excited',
  },

  CRYPTO: {
    label: 'CRYPTO',
    accent: '#F7931A',
    style: 'data',
    hookStyle: 'data',
    visualDensity: 'medium',
    motion: 'dynamic',
    preferredVisuals: ['bitcoin', 'crypto trading', 'blockchain', 'ethereum'],
    tone: 'analytical',
  },

  GENERAL: {
    label: 'NEWS',
    accent: '#E10600',
    style: 'breaking',
    hookStyle: 'breaking',
    visualDensity: 'medium',
    motion: 'smooth',
    preferredVisuals: ['newsroom', 'technology', 'breaking news'],
    tone: 'authoritative',
  },
}

// ─── getProfile ──────────────────────────────────────────────────────────────
// Look up the production profile for a niche. Falls back to GENERAL if unknown.
export function getProfile(niche) {
  const key = String(niche || '').toUpperCase().replace(/[^A-Z]/g, '')
  return CategoryProductionProfiles[key] || CategoryProductionProfiles.GENERAL
}

// ─── getAccentColor ──────────────────────────────────────────────────────────
// Quick access to the accent color for a niche (used by CoverComposer, etc.)
export function getAccentColor(niche) {
  return getProfile(niche).accent
}

// ─── listNiches ──────────────────────────────────────────────────────────────
// Return all niche keys with their profiles (for UI / debugging)
export function listNiches() {
  return NICHES.map(n => ({ niche: n, ...getProfile(n) }))
}
