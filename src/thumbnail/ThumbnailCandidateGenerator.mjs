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
}
