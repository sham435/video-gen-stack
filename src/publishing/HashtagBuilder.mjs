// M9 HashtagBuilder — 48 niche hashtag sets (15 tags per algo)
// Each algorithm gets a unique combination of base + category + visual + tone + arc + hook + niche tags.
// Maintains backward-compatible `build()`, `buildList()`, `topicFromHeadline()` API.

const BASE_TAGS = ['news-monster', 'breaking', 'news']

const CATEGORY_TAGS = {
  ai:           ['ai', 'artificialintelligence', 'machinelearning', 'tech', 'deeplearning'],
  space:        ['space', 'nasa', 'spacex', 'rocket', 'cosmos'],
  gaming:       ['gaming', 'esports', 'gamer', 'playstation', 'xbox'],
  politics:     ['politics', 'election', 'government', 'policy', 'democracy'],
  finance:      ['finance', 'stockmarket', 'investing', 'crypto', 'economics'],
  health:       ['health', 'medicine', 'wellness', 'medical', 'healthcare'],
  science:      ['science', 'research', 'discovery', 'laboratory', 'innovation'],
  sports:       ['sports', 'football', 'basketball', 'nba', 'worldcup'],
  robotics:     ['robotics', 'robot', 'automation', 'engineering', 'futuretech'],
  cybersecurity:['cybersecurity', 'hacking', 'privacy', 'infosec', 'datasecurity'],
  technology:   ['technology', 'tech', 'innovation', 'startup', 'digital'],
  lifestyle:    ['lifestyle', 'viral', 'trending', 'story', 'emotional'],
  business:     ['business', 'entrepreneur', 'startup', 'corporate', 'leadership'],
  entertainment:['entertainment', 'celebrity', 'hollywood', 'movie', 'viral'],
  default:      ['trending', 'viral', 'story', 'emotional', 'mustwatch'],
}

const VISUAL_TAGS = {
  STUDIO_NOIR:    ['documentary', 'noir', 'newsroom', 'investigation'],
  RAIN_CINEMA:    ['cinematic', 'rain', 'atmospheric', 'moody'],
  GOLDEN_HERO:    ['hero', 'inspirational', 'golden', 'motivational'],
  HANDHELD_DOC:   ['documentary', 'handheld', 'real', 'urgent'],
  MINIMAL_WHITE:  ['minimal', 'clean', 'premium', 'sleek'],
  NEON_CYBER:     ['cyberpunk', 'neon', 'future', 'holographic'],
  NATURE_MACRO:   ['nature', 'macro', 'organic', 'detail'],
  VILLAGE_WARM:   ['community', 'family', 'heartwarming', 'together'],
}

const TONE_TAGS = {
  ANCHOR_BREAKING: ['breakingnews', 'urgent', 'alert', 'justin'],
  ANCHOR_EMPATHY:  ['emotional', 'story', 'heart', 'feels'],
  ANCHOR_ROAST:    ['roast', 'funny', 'savage', 'commentary'],
  ANCHOR_INSPIRE:  ['inspiration', 'motivation', 'success', 'overcome'],
  ANCHOR_DETECTIVE: ['mystery', 'investigation', 'truth', 'exposed'],
  ANCHOR_KID:      ['family', 'kids', 'wholesome', 'love'],
}

const ARC_TAGS = {
  RAIN_SHELTER_LOVE:   ['shelter', 'love', 'hope', 'survival'],
  HUNGER_SHARE_HERO:   ['kindness', 'sharing', 'hero', 'community'],
  BULLY_STUDY_SUCCESS: ['comeback', 'success', 'study', 'winner'],
  RIVER_SAVE_FISH:     ['rescue', 'bravery', 'courage', 'savior'],
  BROKEN_FIX_INSPIRE:  ['creativity', 'fix', 'repair', 'innovation'],
  LEFT_RUN_REUNION:    ['reunion', 'family', 'determination', 'home'],
}

const HOOK_TAGS = {
  NOBODY_EXPECTED: ['nobodyexpected', 'shocking', 'unbelievable', 'mindblown'],
  LOST_IN_RAIN:    ['lost', 'rain', 'alone', 'struggle'],
  BULLIED:         ['bullying', 'overcome', 'strength', 'courage'],
  FELL_IN_RIVER:   ['river', 'danger', 'survival', 'closecall'],
  BROKEN_TOY:      ['broken', 'repair', 'hope', 'comeback'],
  LEFT_BEHIND:     ['leftbehind', 'forgotten', 'abandoned', 'alone'],
  HUNGRY_STOLE:    ['hungry', 'desperate', 'survival', 'need'],
  SHOCKING_NUMBER: ['shocking', 'record', 'massive', 'numbers'],
}

const NICHE_VARIANT = ['viral', 'shorts', 'tiktok', 'reels', 'trending', 'fyp', 'explore', 'feed']

// Build 15 unique tags for an algorithm
function buildAlgoTags(algo) {
  const tags = new Set()
  // 1-3: base
  BASE_TAGS.forEach(t => tags.add(t))
  // 4-6: category (pick first 3)
  const catTags = CATEGORY_TAGS[algo.category] || CATEGORY_TAGS.default
  catTags.slice(0, 3).forEach(t => tags.add(t))
  // 7-8: visual
  const visTags = VISUAL_TAGS[algo.visual] || VISUAL_TAGS.STUDIO_NOIR
  visTags.slice(0, 2).forEach(t => tags.add(t))
  // 9-10: tone
  const toneTags = TONE_TAGS[algo.tone] || TONE_TAGS.ANCHOR_BREAKING
  toneTags.slice(0, 2).forEach(t => tags.add(t))
  // 11-12: arc
  const arcTags = ARC_TAGS[algo.arc] || ARC_TAGS.RAIN_SHELTER_LOVE
  arcTags.slice(0, 2).forEach(t => tags.add(t))
  // 13: hook
  const hookTags = HOOK_TAGS[algo.hook] || HOOK_TAGS.NOBODY_EXPECTED
  tags.add(hookTags[0])
  // 14-15: niche variants
  const nicheHash = (algo.number * 7 + algo.hook.length * 3) % NICHE_VARIANT.length
  tags.add(NICHE_VARIANT[nicheHash])
  tags.add(NICHE_VARIANT[(nicheHash + 3) % NICHE_VARIANT.length])
  // Trim to exactly 15
  return [...tags].slice(0, 15)
}

export class HashtagBuilder {
  static build({ topic, category, pipelineProfile, channel = 'NEWS-MONSTER', algorithm = null }) {
    if (algorithm) {
      const tags = buildAlgoTags(algorithm)
      return tags.map(t => `#${t}`).join(' ')
    }
    const hashtags = [topic, category, pipelineProfile, channel].filter(Boolean)
    return hashtags.map(tag => `#${tag.toLowerCase().replace(/\s+/g, '-')}`).join(' ')
  }

  static buildList({ topic, category, pipelineProfile, channel = 'NEWS-MONSTER', algorithm = null }) {
    return this.build({ topic, category, pipelineProfile, channel, algorithm }).split(' ').filter(Boolean)
  }

  static topicFromHeadline(headline) {
    if (!headline) return 'news'
    const stop = new Set(['the', 'a', 'an', 'is', 'are', 'to', 'of', 'in', 'for', 'on', 'and', 'or', 'with', 'from', 'this', 'that', 'new', 'just', 'after', 'before', 'over', 'into'])
    const words = headline.toLowerCase().replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).filter(w => w.length > 2 && !stop.has(w))
    return words[0] || 'news'
  }

  static buildAlgoTags(algo) { return buildAlgoTags(algo) }
}
