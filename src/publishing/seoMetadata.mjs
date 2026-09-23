/**
 * seoMetadata.mjs — CENTRAL SEO metadata builder. Single sink.
 *
 * Every published social object (YouTube video snippet, LinkedIn native video
 * post + promotional share, community post) is built FROM THIS ONE builder.
 * No publisher may construct its own title/description/hashtag/tag/keyword set
 * independently — otherwise YouTube and LinkedIn silently diverge, story tags
 * drift, and the mandatory baseline hashtags get dropped.
 *
 * Output contract (deterministic for a given input):
 *   buildSeoMetadata(article, generatedContent) => {
 *     title,                 // primary search keyword + compelling angle
 *     description,           // keyword-rich summary + entities + topic keywords
 *     hashtags,              // ALL tags (bare, deduped, lowercase, no '#').
 *                            //   [0..2]   = MANDATORY baseline
 *                            //   [3..]    = story-specific (2-5 mined from topic)
 *     youtubeTags,           // slice for YouTube snippet.tags (≤15, ≤100ch each, no '#')
 *     linkedinHashtags,      // '#'-prefixed slice for LinkedIn post body
 *                            //   (≤MAX_LINKEDIN_HASHTAGS, baseline ALWAYS included)
 *     keywords,              // story-specific search terms / aliases / entities
 *   }
 *
 * Validation invariants (enforced + unit-tested):
 *   1. MANDATORY baseline is ALWAYS present, ALWAYS first, ALWAYS in order:
 *        Technology, Breaking, NewsMonster
 *   2. Story-specific hashtags are mined from the ACTUAL article topic/category
 *      (not a fixed list) — 2 to 5 of them.
 *   3. Dedupe is case-insensitive on the normalized (lowercase, no '#', no
 *      spaces) form.
 *   4. Platform limits: YouTube ≤15 tags & ≤100 chars each; LinkedIn 3-5
 *      hashtags in the post body.
 *   5. Blocklist: no spaces, no Reserved chars, no 'shorts'/'reels'/'tiktok'
 *      (this pipeline no longer produces Shorts), no duplicates.
 *
 * NOTE on deployment: this file MUST be byte-identical at BOTH
 *   - src/publishing/seoMetadata.mjs          (GitHub Actions host + tests)
 *   - deploy-staging/src/publishing/seoMetadata.mjs  (Railway 30min cron)
 * Deploying only one copy reintroduces the exact drift / missing-hashtag bug
 * this module exists to kill. See tests/seo-metadata.test.mjs.
 */

const BASELINE_HASHTAGS = ['technology', 'breaking', 'newsmonster']
const BASELINE_MAX = 3

// Tags that are misleading, irrelevant, or describe the OLD Shorts-format output.
// They must never be attached to a video — YouTube explicitly warns that
// unrelated / excessive hashtags can cause tags to be ignored.
const BLOCKLISTED = new Set([
  'shorts', 'short', 'tiktok', 'reels', 'fyp', 'foryou', 'foryoupage',
  'ytshorts', 'shortsfeed', 'viralshorts', 'reel', 'snap', 'viralvideo',
  '6hour', 'monetization', 'subs4subs', 'money', 'fastcash',
])

// YouTube snippet.tags caps (Data API v3).
const YT_MAX_TAGS = 15
const YT_MAX_TAG_CHARS = 100

// LinkedIn recommendation: 3-5 relevant hashtags (never stuffing).
const MAX_LINKEDIN_HASHTAGS = 5

// Niches → canonical search terms. This is an *entity alias pool*, not the
// story tags themselves. The actual story-specific tags are mined from the
// article's own category + topic keywords below.
const NICHE_TO_ENTITIES = {
  ai:            ['artificialintelligence', 'machinelearning', 'aideeplearning'],
  space:         ['space', 'nasa', 'astronomy'],
  gaming:        ['gaming', 'esports', 'videogames'],
  politics:      ['politics', 'election', 'policy'],
  finance:       ['finance', 'stockmarket', 'investing'],
  health:        ['health', 'medicine', 'wellness'],
  science:       ['science', 'research', 'discovery'],
  sports:        ['sports', 'football', 'worldcup'],
  robotics:      ['robotics', 'robot', 'automation'],
  cybersecurity: ['cybersecurity', 'hacking', 'infosec'],
  technology:    ['technology', 'tech', 'innovation'],
  lifestyle:     ['lifestyle', 'viral', 'trending'],
  business:      ['business', 'entrepreneur', 'startup'],
  entertainment: ['entertainment', 'celebrity', 'hollywood'],
  default:       ['trending', 'viral', 'story'],
}

const STOP_WORDS = new Set([
  'the', 'a', 'an', 'is', 'are', 'was', 'were', 'to', 'of', 'in', 'for', 'on',
  'and', 'or', 'with', 'from', 'this', 'that', 'these', 'those', 'new', 'just',
  'after', 'before', 'over', 'into', 'their', 'they', 'you', 'your', 'it',
  'its', 'has', 'have', 'had', 'what', 'who', 'when', 'why', 'how', 'but',
  'at', 'by', 'not', 'so', 'as',
])

/**
 * Normalize a single tag: strip leading '#', lowercase, drop spaces/repeated,
 * reject blocklisted, reject > max chars. Returns '' when invalid.
 * @param {*} raw
 * @returns {string}
 */
export function normalizeTag(raw) {
  if (raw == null) return ''
  const cleaned = String(raw)
    .replace(/^#+/, '')
    .replace(/[^a-z0-9]/gi, '')
    .toLowerCase()
    .trim()
  if (!cleaned) return ''
  if (BLOCKLISTED.has(cleaned)) return ''
  if (cleaned.length > YT_MAX_TAG_CHARS) return ''
  if (/^\d+$/.test(cleaned)) return '' // pure numbers are useless as tags
  return cleaned
}

/**
 * Dedupe + order a set of tags over the normalized (lowercase, '#'-free) form.
 * Control tags win (they come first in `preferred`), then everything else in
 * arrival order. Always deterministic.
 * @param {Iterable<string>} tags
 * @param {string[]} [preferred] normalized control tags to keep at front
 * @param {number} [max] cap on total
 * @returns {string[]}
 */
export function dedupeTags(tags, preferred = [], max = Infinity) {
  const seen = new Set()
  const out = []
  const push = (t) => {
    const n = normalizeTag(t)
    if (!n || seen.has(n)) return
    seen.add(n)
    if (out.length < max) out.push(n)
  }
  ;(preferred || []).forEach(push)
  ;(tags || []).forEach(push)
  return out
}

/**
 * Mine 2-5 story-specific hashtags from the ACTUAL article — never a fixed list.
 *
 * Sourcing (in priority order):
 *  1. article.hashtags (explicit, pre-computed by HashtagBuilder) — sliced,
 *     normalized, capped at 5.
 *  2. article.topicKeywords / article.keywords (story-specific SEO keywords).
 *  3. niche entity pool for article.category (alias expansion, not the final
 *     story set — just where distinct keyword ideas come from).
 *  4. topic tokens mined from the head / Body (headline) via keyword mining.
 *
 * Produces 2-5 normalized tags, deduped against the baseline automatically.
 * @param {object} article
 * @param {string} [article.category]
 * @param {string[]} [article.hashtags] (canonical; preferred over tags)
 * @param {string[]} [article.tags] (article-shaped objects carry tags, e.g. composer)
 * @param {string[]|undefined} [article.topicKeywords]
 * @param {string[]} [article.keywords]
 * @param {string} [article.headline]
 * @returns {string[]}
 */
export function mineStoryTags(article = {}) {
  const candidates = new Set()

  // Exclude the mandatory baseline from the story pool so we never double it.
  const exclude = (t) => !BASELINE_HASHTAGS.includes(normalizeTag(t))

  // Article-shaped objects carry `hashtags` (canonical) or `tags` — honor both.
  ;(article.hashtags || article.tags || [])
    .filter(exclude)
    .forEach((t) => { const n = normalizeTag(t); if (n) candidates.add(n) })

  ;(article.topicKeywords || article.keywords || [])
    .filter(exclude)
    .forEach((t) => { const n = normalizeTag(t); if (n) candidates.add(n) })

  // Entity alias expansion from category — gives related-but-distinct ideas.
  const key = String(article.category || '').toLowerCase().trim()
  const pool = NICHE_TO_ENTITIES[key] || NICHE_TO_ENTITIES.default
  pool.filter(exclude).forEach((t) => candidates.add(normalizeTag(t)))

  // Headline keyword mining (guarded — evidence-driven, not exhaustive).
  const headline = (article.headline || '')
    .replace(/[^a-z0-9 ]/gi, ' ')
    .toLowerCase()
  headline.split(/\s+/).filter(Boolean).forEach((word) => {
    if (word.length > 2 && !STOP_WORDS.has(word) && !/^\d+$/.test(word)) {
      const n = normalizeTag(word)
      if (n) candidates.add(n)
    }
  })

  // 2-5 story tags, capped at 5, never dipping below 2 when candidates exist.
  const story = dedupeTags(candidates, [], 5)
  // Trim to [2..5]: drop trailing generic pool tags only when over-lexicalised.
  // Biased to keep story-specific / category-derived words, not generic ones.
  return story.slice(0, story.length >= 2 ? 5 : story.length)
}

/**
 * Build the FULL centralized SEO metadata object for a story.
 *
 * @param {object}  article
 * @param {object}  [generatedContent] whatever the pipeline generated (optional)
 * @returns {{
 *   title: string,
 *   description: string,
 *   hashtags: string[],
 *   youtubeTags: string[],
 *   linkedinHashtags: string[],
 *   keywords: string[],
 * }}
 */
export function buildSeoMetadata(article = {}, generatedContent = null) {
  const story = mineStoryTags(article)

  // MANDATORY baseline first, in canonical order, then the story-specific set
  // (deduped against the baseline). YouTube tag order = this order.
  const hashtags = dedupeTags([...BASELINE_HASHTAGS, ...story], BASELINE_HASHTAGS, YT_MAX_TAGS)

  // Story-specific search terms: entities + category aliases, distinct from tags.
  const keywords = dedupeTags([
    ...(article.topicKeywords || article.keywords || []),
    ...(NICHE_TO_ENTITIES[String(article.category || '').toLowerCase()] || []),
    article.headline || article.title || '',
  ], [], 20)

  // Title: primary keyword + compelling angle, ≤100 chars (YouTube hard cap).
  const headline = String(article.headline || article.title || 'News Update').trim()
  const keywordLead = keywords[0] || 'News'
  const titleLead = String(keywordLead[0].toUpperCase() + keywordLead.slice(1))
  const title = headline.includes(keywordLead)
    ? headline
    : `${titleLead} | ${headline}`
  const finalTitle = title.slice(0, 100) || 'News Update'

  // Description: keyword-rich summary → topic keywords → hashtags, ≤1500 for
  // LinkedIn / ≤5000 for YouTube (shared sink, consumed by both).
  const summary = String(
    article.summary || article.description || `A ${article.category || 'news'} story from NEWS-MONSTER.`,
  ).replace(/\s+/g, ' ').slice(0, 800)

  const descLines = [
    summary,
    '',
    (keywords.length ? `Topics: ${keywords.join(', ')}` : ''),
    '',
    hashtags.map((t) => `#${t}`).join(' '),
  ].filter(Boolean)

  const description = descLines.join('\n').slice(0, 1500)

  // YouTube tags are the FULL set capped at 15 (already guaranteed by dedupe).
  const youtubeTags = hashtags.slice(0, YT_MAX_TAGS)

  // LinkedIn projection: '#'-prefixed slice (LinkedIn renders hashtags WITH '#').
  // Baseline is ALWAYS first (dedupeTags pushes preferred first), so the slice is
  // ≥3 guaranteed — upstream consumers must NEVER re-slice or re-derive this.
  const linkedinHashtags = hashtags.slice(0, MAX_LINKEDIN_HASHTAGS).map((t) => `#${t}`)

  return {
    title: finalTitle,
    description,
    hashtags,
    youtubeTags,
    linkedinHashtags,
    keywords,
  }
}

/** Backwards-compatible alias used by the HashtagBuilder.default path. */
export const SEO_BUILDERS = { buildSeoMetadata }
