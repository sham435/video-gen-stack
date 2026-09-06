// YouTubeSEO — SEO metadata for YouTube video uploads.
//
// Fills the two gaps that kept published videos from being search-discoverable:
//   1. The upload snippet carried ONLY title + description — no `tags[]` array
//      and no `categoryId`. This module derives both.
//   2. Category coverage was ad-hoc; Sports / Music / Politics now have explicit
//      YouTube taxonomy mappings plus keyword tags.
//
// Rules (YouTube Data API v3):
//   - snippet.tags: max 500 chars total, each tag <= 100 chars, no leading '#'.
//   - snippet.categoryId: numeric, one of the documented category IDs.

import { HashtagBuilder } from './HashtagBuilder.mjs'

// YouTube categoryId map (Data API v3 `videoCategories.list`).
// Common values used here:
//   10 = Music        17 = Sports     20 = Gaming      24 = Entertainment
//   25 = News & Politics              27 = Education   28 = Science & Technology
export const YOUTUBE_CATEGORY_IDS = {
  // name keys use the pipeline's UPPERCASE niche convention
  SPORTS: '17',
  MUSIC: '10',
  POLITICS: '25',
  GAMING: '20',
  TECH: '28',
  TECHNOLOGY: '28',
  AI: '28',
  SCIENCE: '28',
  HEALTH: '27',
  CLIMATE: '28',
  CRYPTO: '28',
  STOCKS: '28',
  FINANCE: '28',
  BUSINESS: '28',
  MOVIES: '24',
  ENTERTAINMENT: '24',
  LIFESTYLE: '22',
  SPACE: '28',
  ROBOTICS: '28',
  CYBERSECURITY: '28',
  // lowercase aliases (HashtagBuilder category keys)
  sports: '17',
  music: '10',
  politics: '25',
  gaming: '20',
  tech: '28',
  technology: '28',
  health: '27',
  finance: '28',
  business: '28',
  entertainment: '24',
  lifestyle: '22',
  science: '28',
  default: '28',
}

// News / tech / general are the News & Politics (25) or Science & Tech (28)
// buckets; everything unknown falls back to Science & Technology.
export const DEFAULT_YOUTUBE_CATEGORY_ID = '28'

/**
 * Resolve a YouTube categoryId from a pipeline category/niche key.
 *
 * @param {string|null|undefined} key e.g. 'SPORTS', 'MUSIC', 'POLITICS', 'tech'
 * @returns {string} a valid YouTube categoryId
 */
export function resolveYouTubeCategoryId(key) {
  if (!key) return DEFAULT_YOUTUBE_CATEGORY_ID
  const k = String(key).trim()
  return YOUTUBE_CATEGORY_IDS[k] || DEFAULT_YOUTUBE_CATEGORY_ID
}

// Per-category keyword tags, used to build the video `tags[]` array when the
// article carries no explicit tags. Sports / Music / Politics are explicitly
// covered per the channel's new category expansion.
const CATEGORY_TAGS = {
  SPORTS: ['sports', 'news', 'match', 'championship', 'football', 'cricket', 'nba', 'nfl', 'goal', 'highlights'],
  MUSIC: ['music', 'news', 'album', 'artist', 'concert', 'tour', 'billboard', 'song', 'new music', 'release'],
  POLITICS: ['politics', 'news', 'election', 'government', 'policy', 'president', 'parliament', 'vote', 'breaking'],
  TECH: ['technology', 'tech', 'news', 'innovation', 'gadget', 'startup', 'ai', 'software'],
  AI: ['ai', 'artificial intelligence', 'tech', 'news', 'machine learning', 'openai', 'chatgpt'],
  CLIMATE: ['climate', 'news', 'environment', 'global warming', 'weather', 'emissions'],
  HEALTH: ['health', 'news', 'medicine', 'medical', 'wellness', 'science'],
  CRYPTO: ['crypto', 'bitcoin', 'news', 'blockchain', 'finance', 'ethereum'],
  STOCKS: ['stocks', 'stock market', 'news', 'finance', 'investing', 'nasdaq'],
  GAMING: ['gaming', 'news', 'game', 'esports', 'gamer'],
  MOVIES: ['movies', 'news', 'film', 'box office', 'entertainment', 'hollywood'],
  FINANCE: ['finance', 'news', 'economy', 'business', 'stocks'],
  BUSINESS: ['business', 'news', 'economy', 'startup', 'corporate'],
  SPACE: ['space', 'news', 'nasa', 'spacex', 'rocket', 'science'],
  ENTERTAINMENT: ['entertainment', 'celebrity', 'news', 'hollywood', 'viral'],
  LIFESTYLE: ['lifestyle', 'news', 'viral', 'trending', 'story'],
  SCIENCE: ['science', 'news', 'research', 'discovery', 'innovation'],
}

const BRAND_TAGS = ['news-monster', 'news', 'breaking', 'daily-news', 'news-update']

/**
 * Derive a clean, distinct YouTube `tags[]` array (no '#', distinct, capped at
 * 15 tags / 500 chars total). Merges brand + category + article-sourced tags.
 *
 * @param {object} opts
 * @param {string|null} [opts.category] pipeline category/niche key (any case)
 * @param {string[]} [opts.articleTags] explicit tags from the article, if any
 * @param {string} [opts.brand] brand label ("NEWS-MONSTER")
 * @returns {string[]}
 */
export function deriveYouTubeTags({ category, articleTags = [], brand = 'NEWS-MONSTER' } = {}) {
  const out = []
  const seen = new Set()
  const add = (tag) => {
    const clean = String(tag || '').trim().replace(/^#/, '').toLowerCase()
    if (clean.length < 2 || clean.length > 100) return
    if (seen.has(clean)) return
    seen.add(clean)
    out.push(clean)
  }

  // Brand tags first
  BRAND_TAGS.forEach(add)

  // Explicit article tags
  ;(Array.isArray(articleTags) ? articleTags : []).forEach(add)

  // Category keyword tags
  const key = String(category || '').trim().toUpperCase()
  const catTags = CATEGORY_TAGS[key] || []
  catTags.forEach(add)

  // Ensure a category tag resembling the category is present (helps YouTube
  // classify) even if the category keyword list didn't include the bare name.
  if (key && BRAND_TAGS.length && !seen.has(key.toLowerCase()) && key.length <= 40) {
    add(key)
  }

  // Hard cap at 15 tags (YouTube limit)
  return out.slice(0, 15)
}

/**
 * Build the SEO metadata bundle for a publish call.
 *
 * @param {object} args
 * @param {string|null} args.category pipeline category/niche key
 * @param {string[]} [args.articleTags]
 * @param {string} [args.brand]
 * @returns {{tags:string[], categoryId:string}}
 */
export function buildYouTubeSEO(args = {}) {
  return {
    tags: deriveYouTubeTags(args),
    categoryId: resolveYouTubeCategoryId(args.category),
  }
}

export { HashtagBuilder }
