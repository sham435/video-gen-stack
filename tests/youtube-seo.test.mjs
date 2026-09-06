// YouTubeSEO — unit tests for the SEO metadata builder.
// Covers: category → categoryId mapping (incl. Sports/Music/Politics),
// tag derivation (dedup, no '#', caps), and backward-compatible defaults.
//
// Run: node --test tests/youtube-seo.test.mjs

import test from 'node:test'
import assert from 'node:assert/strict'
import {
  buildYouTubeSEO,
  resolveYouTubeCategoryId,
  deriveYouTubeTags,
  YOUTUBE_CATEGORY_IDS,
  DEFAULT_YOUTUBE_CATEGORY_ID,
} from '../src/publishing/YouTubeSEO.mjs'

test('resolveYouTubeCategoryId — maps Sports/Music/Politics + majors', () => {
  assert.equal(resolveYouTubeCategoryId('SPORTS'), '17')
  assert.equal(resolveYouTubeCategoryId('sports'), '17')
  assert.equal(resolveYouTubeCategoryId('MUSIC'), '10')
  assert.equal(resolveYouTubeCategoryId('music'), '10')
  assert.equal(resolveYouTubeCategoryId('POLITICS'), '25')
  assert.equal(resolveYouTubeCategoryId('politics'), '25')
  assert.equal(resolveYouTubeCategoryId('GAMING'), '20')
  assert.equal(resolveYouTubeCategoryId('TECH'), '28')
  assert.equal(resolveYouTubeCategoryId('MOVIES'), '24')
  assert.equal(resolveYouTubeCategoryId('HEALTH'), '27')
})

test('resolveYouTubeCategoryId — defaults to Science & Technology for unknown', () => {
  assert.equal(DEFAULT_YOUTUBE_CATEGORY_ID, '28')
  assert.equal(resolveYouTubeCategoryId('unknown-niche-xyz'), '28')
  assert.equal(resolveYouTubeCategoryId(null), '28')
  assert.equal(resolveYouTubeCategoryId(undefined), '28')
  assert.equal(resolveYouTubeCategoryId(''), '28')
})

test('buildYouTubeSEO — Sports yields category 17 + sports tags', () => {
  const seo = buildYouTubeSEO({ category: 'SPORTS' })
  assert.equal(seo.categoryId, '17')
  assert.ok(seo.tags.includes('sports'))
  assert.ok(seo.tags.includes('news-monster'))
})

test('buildYouTubeSEO — Music yields category 10 + music tags', () => {
  const seo = buildYouTubeSEO({ category: 'MUSIC' })
  assert.equal(seo.categoryId, '10')
  assert.ok(seo.tags.includes('music'))
  assert.ok(seo.tags.includes('album'))
})

test('buildYouTubeSEO — Politics yields category 25 + politics tags', () => {
  const seo = buildYouTubeSEO({ category: 'POLITICS' })
  assert.equal(seo.categoryId, '25')
  assert.ok(seo.tags.includes('politics'))
  assert.ok(seo.tags.includes('election'))
})

test('deriveYouTubeTags — dedups, strips #, lowercases, caps at 15', () => {
  const tags = deriveYouTubeTags({ category: 'tech', articleTags: ['#Tesla', 'tesla', ' AI '] })
  const set = new Set(tags)
  assert.equal(set.size, tags.length, 'no duplicates')
  assert.ok(tags.every((t) => !t.includes('#')), 'no leading #')
  assert.ok(tags.every((t) => t === t.toLowerCase()), 'lowercased')
  assert.ok(tags.length <= 15, `capped: got ${tags.length}`)
  assert.ok(tags.includes('tesla'), 'article tag preserved')
})

test('buildYouTubeSEO — unknown category still returns a valid bundle', () => {
  const seo = buildYouTubeSEO({ category: 'qwerty', articleTags: ['#Tag'] })
  assert.equal(seo.categoryId, DEFAULT_YOUTUBE_CATEGORY_ID)
  assert.ok(Array.isArray(seo.tags))
  assert.ok(seo.tags.includes('tag'), 'article tag still derived')
})

test('YOUTUBE_CATEGORY_IDS — covers the pipeline niche set', () => {
  for (const niche of ['SPORTS', 'MUSIC', 'POLITICS', 'GAMING', 'TECH', 'AI', 'CLIMATE', 'CRYPTO', 'STOCKS', 'MOVIES', 'HEALTH']) {
    assert.ok(YOUTUBE_CATEGORY_IDS[niche], `missing mapping for ${niche}`)
  }
})
