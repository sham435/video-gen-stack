// seo-metadata.test.mjs — CENTRAL SEO builder contract.
//
// THE single sink: buildSeoMetadata(article) must produce the mandatory
// baseline hashtags + story-specific tags, deduplicated and projected per
// platform (LinkedIn 3-5 '#tag', YouTube ≤15 bare), and EVERY publisher must
// consume these projections (no re-derivation, no local slicing).
//
// Run: node --test tests/seo-metadata.test.mjs

import test from 'node:test'
import assert from 'node:assert/strict'

import { buildSeoMetadata } from '../src/publishing/seoMetadata.mjs'
import { LinkedInPostFactory } from '../src/publishing/LinkedInPostFactory.mjs'
import { buildYouTubeSEO } from '../src/publishing/YouTubeSEO.mjs'
import { SocialPostGenerator } from '../src/publishing/SocialPostGenerator.mjs'

const BASELINE_HASHTAGS = ['technology', 'breaking', 'newsmonster']

const ARTICLE = {
  title: 'Mall rink closes after 60 years of skate dates',
  headline: 'Mall rink closes after 60 years of skate dates',
  description: 'A beloved mall skating rink shuts down after nearly 60 years.',
  summary: 'A beloved mall skating rink shuts down after nearly 60 years.',
  category: 'business',
  url: 'https://example.com/mall-rink-closes-60-years',
  source: 'NewsAPI',
  tags: ['#mall', '#business', '#breaking', '#news-monster'],
  keywords: ['mall', 'rink', 'closing'],
}

// ── structure ─────────────────────────────────────────────────────────────
test('seo metadata — returns all projections', () => {
  const seo = buildSeoMetadata(ARTICLE)
  for (const key of ['title', 'description', 'hashtags', 'youtubeTags', 'linkedinHashtags', 'keywords']) {
    assert.ok(key in seo, `missing projection ${key}`)
  }
  assert.equal(typeof seo.title, 'string')
  assert.ok(seo.title.length > 0)
})

// ── linkedinHashtags: 3-5, baseline always present, deduped ──────────────
test('seo metadata — linkedinHashtags exists, 3-5 length, baseline first', () => {
  const seo = buildSeoMetadata(ARTICLE)
  const tags = seo.linkedinHashtags
  assert.ok(Array.isArray(tags))
  assert.ok(tags.length >= 3, `linkedinHashtags must have ≥3 (baseline guarantees it), got ${tags.length}`)
  assert.ok(tags.length <= 5, `linkedinHashtags must have ≤5, got ${tags.length}`)
  for (const tag of BASELINE_HASHTAGS) {
    assert.ok(tags.includes(`#${tag}`), `linkedinHashtags must include #${tag}`)
  }
  // Baseline first, in canonical order
  assert.equal(tags[0], '#technology')
  assert.equal(tags[1], '#breaking')
  assert.equal(tags[2], '#newsmonster')
})

test('seo metadata — linkedinHashtags are deduped', () => {
  const seo = buildSeoMetadata(ARTICLE)
  assert.equal(new Set(seo.linkedinHashtags).size, seo.linkedinHashtags.length)
  for (const tag of seo.linkedinHashtags) {
    assert.match(tag, /^#[a-z0-9]+$/, 'LinkedIn tags must be #-prefixed, bare lowercase')
  }
})

// ── youtubeTags: ≤15, bare, deduped ──────────────────────────────────────
test('seo metadata — youtubeTags ≤15 and bare lowercase', () => {
  const seo = buildSeoMetadata(ARTICLE)
  assert.ok(seo.youtubeTags.length <= 15, `youtubeTags must be ≤15, got ${seo.youtubeTags.length}`)
  assert.ok(seo.youtubeTags.length >= 3)
  for (const tag of seo.youtubeTags) {
    assert.match(tag, /^[a-z0-9]+$/, 'youtubeTags must be bare (no #), lowercase')
  }
  assert.equal(new Set(seo.youtubeTags).size, seo.youtubeTags.length)
})

// ── baseline survives every input (even empty/garbage) ───────────────────
test('seo metadata — mandatory baseline present even for empty article', () => {
  const seo = buildSeoMetadata({})
  for (const tag of BASELINE_HASHTAGS) {
    assert.ok(seo.linkedinHashtags.includes(`#${tag}`), `bare article still gets #${tag}`)
    assert.ok(seo.hashtags.includes(tag), `bare article still gets ${tag}`)
  }
})

test('seo metadata — baseline is not duplicated when input already carries it', () => {
  const seo = buildSeoMetadata({
    ...ARTICLE,
    tags: ['#technology', '#breaking', '#newsmonster', '#tech', '#mall'],
  })
  assert.equal(
    seo.hashtags.filter((t) => BASELINE_HASHTAGS.includes(t)).length,
    BASELINE_HASHTAGS.length,
    'baseline appears exactly once each',
  )
})

// ── architectural: publishers consume the projections, no re-derivation ──
test('architecture — LinkedInPostFactory uses the central linkedinHashtags projection', () => {
  const seo = buildSeoMetadata(ARTICLE)
  const factory = new LinkedInPostFactory()
  const post = factory.videoPost({
    title: ARTICLE.title,
    summary: ARTICLE.description,
    category: ARTICLE.category,
    videoUrl: 'https://youtu.be/abc123xyz',
    youtubeShortsUrl: 'https://www.youtube.com/watch?v=abc123xyz',
    linkedinHashtags: seo.linkedinHashtags,
    thumbnailPath: null,
  })
  // The factory MUST render the central projection as-is — no slicing, no re-derive.
  assert.deepEqual(post.hashtags, seo.linkedinHashtags)
  for (const tag of seo.linkedinHashtags) {
    assert.ok(post.commentary.includes(tag), `commentary contains ${tag}`)
  }
})

test('architecture — YouTubeSEO consumes the central youtubeTags projection', () => {
  const seo = buildSeoMetadata(ARTICLE)
  const youtube = buildYouTubeSEO({ category: ARTICLE.category, articleTags: ARTICLE.tags, seo })
  assert.deepEqual(youtube.tags, seo.youtubeTags)
})

// The publish contract feeds `hashtags` explicitly (composer maps article.tags).
const VIDEO_INPUT = {
  ...ARTICLE,
  videoId: 'abc123xyz',
  videoUrl: 'https://youtu.be/abc123xyz',
  hashtags: ARTICLE.tags,
}

test('architecture — SocialPostGenerator attaches projections from buildSeoMetadata', () => {
  const g = new SocialPostGenerator()
  const post = g.build(VIDEO_INPUT)
  // Rebuild with the EXACT args the generator fed the central builder, then
  // the projections must be identical (no re-derivation downstream).
  const seo = buildSeoMetadata({
    headline: post.title,
    title: post.title,
    summary: post.summary,
    category: post.category,
    hashtags: VIDEO_INPUT.hashtags,
    keywords: VIDEO_INPUT.keywords || [],
  })
  assert.deepEqual(post.linkedinHashtags, seo.linkedinHashtags)
  assert.deepEqual(post.youtubeTags, seo.youtubeTags)
  // Promo text renders the #-prefixed LinkedIn projection
  for (const tag of seo.linkedinHashtags) {
    assert.ok(post.platforms.linkedin.commentary.includes(tag), `linkedin commentary contains ${tag}`)
    assert.ok(post.platforms.youtubeCommunity.text.includes(tag), `community text contains ${tag}`)
  }
})

// ── niche mining: story tags actually reflect the topic ──────────────────
test('seo metadata — story tags are mined from the article, not a fixed list', () => {
  const seo = buildSeoMetadata({
    ...ARTICLE,
    headline: 'Tesla unveils robotaxi in Austin',
    title: 'Tesla unveils robotaxi in Austin',
    tags: ['#tesla', '#robotaxi', '#autonomous'],
  })
  for (const t of ['tesla', 'robotaxi', 'autonomous']) {
    assert.ok(seo.hashtags.includes(t), `mined story tag ${t} present`)
  }
  assert.ok(seo.hashtags.length <= 15)
})