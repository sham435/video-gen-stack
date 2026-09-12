// HashtagBuilder — unit tests for tag generation + dedupe.
// Covers: topic/category collision (the #technology #technology bug),
// normalization, channel/brand inclusion, and algorithm variant.
//
// Run: node --test tests/hashtag-builder.test.mjs

import test from 'node:test'
import assert from 'node:assert/strict'
import { HashtagBuilder } from '../src/publishing/HashtagBuilder.mjs'

test('build — dedupes when topic === category (the #technology #technology bug)', () => {
  const out = HashtagBuilder.build({
    topic: 'technology',
    category: 'technology',
    pipelineProfile: 'breaking',
    channel: 'NEWS-MONSTER',
  })
  const tags = out.split(' ')
  assert.ok(!tags.includes('#technology #technology'), `duplicate found: ${out}`)
  assert.equal(new Set(tags).size, tags.length, `duplicates in: ${out}`)
  assert.ok(tags.includes('#technology'))
  assert.ok(tags.includes('#breaking'))
  assert.ok(tags.includes('#news-monster'))
})

test('build — case-insensitive dedupe (Technology vs technology)', () => {
  const out = HashtagBuilder.build({
    topic: 'Technology',
    category: 'technology',
    pipelineProfile: 'tech',
    channel: 'news-monster',
  })
  const tags = out.split(' ')
  assert.equal(new Set(tags.map(t => t.toLowerCase())).size, tags.length, `case dupes in: ${out}`)
})

test('build — normalizes whitespace + caps to lowercase hyphen (#NEWS MONSTER → #news-monster)', () => {
  const out = HashtagBuilder.build({
    topic: 'Mario Kart',
    category: 'Gaming',
    pipelineProfile: 'Breaking News',
    channel: 'NEWS-MONSTER',
  })
  const tags = out.split(' ')
  assert.ok(tags.includes('#mario-kart'))
  assert.ok(tags.includes('#gaming'))
  assert.ok(tags.includes('#breaking-news'))
  assert.ok(tags.includes('#news-monster'))
})

test('build — filters undefined/null tags', () => {
  const out = HashtagBuilder.build({
    topic: 'science',
    category: null,
    pipelineProfile: undefined,
    channel: 'NEWS-MONSTER',
  })
  assert.equal(out, '#science #news-monster')
})

test('buildList — returns split build() output, deduped (keeps # prefix)', () => {
  const list = HashtagBuilder.buildList({
    topic: 'ai',
    category: 'ai',
    pipelineProfile: 'breaking',
    channel: 'NEWS-MONSTER',
  })
  assert.deepEqual(list, ['#ai', '#breaking', '#news-monster'])
  assert.equal(new Set(list).size, list.length, `dupes in: ${list}`)
})

test('build — algorithm variant keeps 15 unique tags', () => {
  const algo = { category: 'technology', visual: 'NEON_CYBER', tone: 'ANCHOR_BREAKING', arc: 'RAIN_SHELTER_LOVE', hook: 'SHOCKING_NUMBER', number: 7, hookLen: 16 }
  const out = HashtagBuilder.build({ algorithm: algo })
  const tags = out.split(' ')
  assert.equal(tags.length, 15, `expected 15 tags, got ${tags.length}: ${out}`)
  assert.equal(new Set(tags).size, tags.length, `algorithm dupes: ${out}`)
})

test('topicFromHeadline — picks first content word, skips stopwords', () => {
  assert.equal(HashtagBuilder.topicFromHeadline('Mario Kart 8 Deluxe update'), 'mario')
  assert.equal(HashtagBuilder.topicFromHeadline('The new technology just launched'), 'technology')
  assert.equal(HashtagBuilder.topicFromHeadline(''), 'news')
})