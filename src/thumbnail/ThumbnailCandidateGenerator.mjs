// ThumbnailCandidateGenerator — produces 3–5 layout candidates for
// autonomous thumbnail selection. Each candidate is a brief object
// that CoverComposer can render.
//
// Strategies:
//   hero-hook       — hero image + 3-word hook overlay
//   breaking-news   — breaking-news visual + emotional phrase
//   data-hook       — numerical/stat hook + product close-up
//   split           — split composition + comparison hook
//   minimal         — clean product shot + subtle text

const STRATEGIES = [
  {
    id: 'hero-hook',
    hookStyle: 'curiosity',
    textPosition: 'center',
    overlayWeight: 0.7,
    description: 'Hero image with bold 3-word hook',
  },
  {
    id: 'breaking-news',
    hookStyle: 'urgency',
    textPosition: 'top',
    overlayWeight: 0.85,
    description: 'Breaking-news visual with emotional phrase',
  },
  {
    id: 'data-hook',
    hookStyle: 'shock',
    textPosition: 'center',
    overlayWeight: 0.65,
    description: 'Numerical hook with product close-up',
  },
  {
    id: 'split',
    hookStyle: 'comparison',
    textPosition: 'bottom',
    overlayWeight: 0.75,
    description: 'Split composition with comparison hook',
  },
  {
    id: 'minimal',
    hookStyle: 'curiosity',
    textPosition: 'bottom',
    overlayWeight: 0.5,
    description: 'Clean product shot with subtle text',
  },
]

function extractHookWords(title) {
  const words = (title || '').split(/\s+/).filter(Boolean)
  const hooks = []
  // Grab first 3 meaningful words
  const meaningful = words.filter(w => w.length > 2 && !/^(the|and|for|are|but|not|you|all|can|had|her|was|one|our|out|has|his|how|its|may|new|now|old|see|way|who|did|get|let|say|she|too|use)$/i.test(w))
  if (meaningful.length >= 3) {
    hooks.push(meaningful.slice(0, 3).join(' ').toUpperCase())
  }
  // Grab last 3 as alternative
  if (meaningful.length >= 3) {
    hooks.push(meaningful.slice(-3).join(' ').toUpperCase())
  }
  // Number extraction
  const nums = title.match(/\d+/g)
  if (nums && nums.length > 0) {
    hooks.push(nums[0])
  }
  return hooks.length > 0 ? hooks : ['BREAKING']
}

// ── 16:9 landscape copy helpers ──────────────────────────────────────────
//
// Per the design brief, the thumbnail headline must NOT reuse the article
// title. We derive a strong 2–6 word visual message: a Level-3 KEYWORD
// (attention hook) + a Level-4 short HEADLINE.

const LANDSCAPE_LAYOUTS = [
  { id: '16-9-subject-right', layout: 'A', status: 'BREAKING', description: 'Subject right, keyword + headline left' },
  { id: '16-9-subject-left', layout: 'B', status: 'BREAKING', description: 'Subject left, keyword + headline right' },
  { id: '16-9-center-top', layout: 'C', status: 'LIVE', description: 'Centered subject, headline above' },
  { id: '16-9-center-bottom', layout: 'D', status: 'LIVE', description: 'Centered subject, headline below' },
  { id: '16-9-full-bleed', layout: 'E', status: 'BREAKING', description: 'Full-bleed visual, minimal typography' },
]

const STOP = new Set('the|a|an|and|or|but|for|with|from|into|that|this|these|its|are|was|were|than|then|when|over|under|about|after|after|during|against|new|has|have|had|can|could|will|would|should|may|might|just|not|no|yes|more|most|their|they|his|her|its|who|what|how|out|all|one|two|your|our|us|on|in|at|by|of|to'.split('|'))

function cleanWords(title = '') {
  return title.replace(/[^\w\s$%KMB.]/g, ' ').split(/\s+/).filter(Boolean)
}

function meaningfulWords(title = '') {
  return cleanWords(title).filter(w => w.length > 2 && !STOP.has(w.toLowerCase()))
}

/**
 * Derive a Level-3 keyword (the strongest entity / attention hook) from title
 * + category. Prefers a short brand/entity token (title case kept short, max
 * 3 words, numerals preferred as head-turners).
 */
export function landscapeKeyword(title = '', category = '') {
  const words = meaningfulWords(title)
  const upper = title.toUpperCase()
  // Prefer a leading noun / proper entity (single strong token).
  const single = words[0] || category || 'BREAK'
  // Give numerals priority (numbers stop the scroll) — pull the number + one word.
  const num = cleanWords(title).find(w => /\d/.test(w))
  if (num) {
    const numIdx = meaningfulWords(title).findIndex(w => /\d/.test(w))
    const base = numIdx > 0 ? meaningfulWords(title)[numIdx - 1] : null
    return (base ? `${base} ${num}` : num).toUpperCase()
  }
  const clustered = single.length <= 9 ? single : single.slice(0, 9)
  return clustered.toUpperCase()
}

/**
 * Derive a Level-4 headline — a 2–6 word visual message, wrapping aggressively
 * to read at 320x180. Never the full article title.
 */
export function landscapeHeadline(title = '', category = '') {
  const words = meaningfulWords(title)
  const cat = (category || 'NEWS').toUpperCase()
  if (words.length === 0) return cat
  // Strongest 1–3 words, avoiding generic news verbs.
  const strong = words.filter(w => !/^(unveils|unveiled|reports|report|says|say|reveals|revealed|launches|launched|announces|announced|introduces|introduced|shows|show|releases|release|launch|could|will|may)$/i.test(w))
  const pool = strong.length >= 2 ? strong : words
  const headline = pool.slice(0, Math.min(4, pool.length)).join(' ').toUpperCase()
  if (headline.length <= 3) return `${cat} ${headline}`
  return headline
}

export class ThumbnailCandidateGenerator {
  constructor(options = {}) {
    this.strategies = options.strategies || STRATEGIES
  }

  generate(article, brief = {}) {
    const title = article.title || 'NEWS UPDATE'
    const hookWords = extractHookWords(title)
    const category = article.category || brief.category || 'technology'
    const heroImage = brief.heroImage || article.imageUrl || null

    return this.strategies.map((strategy, index) => {
      const hook = hookWords[index % hookWords.length]
      const bottomBadge = strategy.id === 'breaking-news'
        ? 'BREAKING NEWS'
        : strategy.id === 'data-hook'
          ? hook
          : strategy.id === 'split'
            ? 'VS'
            : category.toUpperCase()

      return {
        id: `candidate-${index}`,
        strategy: strategy.id,
        description: strategy.description,
        headline: title.toUpperCase(),
        hook,
        bottomBadge,
        text_overlay: {
          top: hook,
          bottom: bottomBadge,
        },
        heroImage,
        accent_color: brief.accent_color || '#E10600',
        nicheProfile: brief.nicheProfile || null,
        category,
        mood: strategy.hookStyle === 'urgency' ? 'BREAKING' : 'NEWS',
        hideBranding: brief.hideBranding || false,
        _strategy: strategy,
      }
    })
  }

  /**
   * Generate 16:9 landscape candidates — one per composition strategy A–E.
   *
   * Each candidate carries a `keyword` (Level-3 hook) and a short `headline`
   * (Level-4 message, 2–6 words) derived from the article, plus `landscape:
   * true` and `layout` (A–E) so the renderer can dispatch to the first-class
   * LandscapeComposition mode. The portrait candidate path (`generate`) is
   * untouched.
   *
   * @param {object} article { title, category }
   * @param {object} brief { heroImage, accent_color, nicheProfile, hideBranding, status }
   * @returns {Array<object>} 5 landscape candidates
   */
  generateLandscape(article = {}, brief = {}) {
    const title = article.title || 'NEWS UPDATE'
    const category = article.category || brief.category || 'technology'
    const keyword = landscapeKeyword(title, category)
    const headline = landscapeHeadline(title, category)
    const heroImage = brief.heroImage || article.imageUrl || null

    return LANDSCAPE_LAYOUTS.map((l, index) => ({
      id: `candidate-16-9-${index}`,
      strategy: l.id,
      layout: l.layout,
      description: l.description,
      landscape: true,
      keyword,
      headline,
      status: brief.status || l.status,
      brand: brief.brand || 'NEWS-MONSTER',
      category,
      accent_color: brief.accent_color || '#E10600',
      accent: brief.accent_color || '#E10600',
      nicheProfile: brief.nicheProfile || null,
      hideBranding: brief.hideBranding || false,
      heroImage,
      _layout: l.layout,
      _strategy: l,
    }))
  }
}
