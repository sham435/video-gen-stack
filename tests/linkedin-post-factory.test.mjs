import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { LinkedInPostFactory, VideoPostFormatter, ArticlePostFormatter } from '../src/publishing/LinkedInPostFactory.mjs'

const VIDEO = {
  title: 'Scientists Just Set Up What Comes Next | NEWS-MONSTER',
  summary: 'A breakthrough in quantum computing reshapes the industry.',
  category: 'science',
  videoUrl: 'https://youtu.be/abc123',
  youtubeShortsUrl: 'https://www.youtube.com/shorts/abc123',
  hashtags: ['#science', '#quantum', '#breaking', '#news-monster'],
  thumbnailPath: 'output/cover.png',
}

const ARTICLE = {
  title: 'Tesla Expands into New Markets',
  description: 'Tesla announces a major expansion into Southeast Asian markets.',
  url: 'https://example.com/article',
  source: 'Reuters',
  category: 'technology',
  hashtags: ['#tesla', '#technology', '#markets', '#news-monster'],
  thumbnailPath: 'output/cover_tesla.png',
}

describe('LinkedInPostFactory', () => {
  it('builds video post when videoId present', () => {
    const factory = new LinkedInPostFactory()
    const post = factory.build(VIDEO)
    assert.equal(post.type, 'video')
    assert.ok(post.commentary.includes('Scientists Just Set Up What Comes Next'))
    assert.ok(post.commentary.includes('https://www.youtube.com/shorts/abc123'))
    assert.ok(post.commentary.includes('sham435.github.io/video-gen-stack'))
    assert.ok(post.commentary.includes('youtube.com/@sham435'))
    assert.ok(post.commentary.includes('#science'))
    assert.equal(post.thumbnailPath, 'output/cover.png')
  })

  it('builds article post when no videoId', () => {
    const factory = new LinkedInPostFactory()
    const post = factory.build(ARTICLE)
    assert.equal(post.type, 'article')
    assert.ok(post.commentary.includes('Tesla Expands into New Markets'))
    assert.ok(post.commentary.includes('https://example.com/article'))
    assert.ok(post.commentary.includes('sham435.github.io/video-gen-stack'))
    assert.ok(post.commentary.includes('#tesla'))
  })

  it('strips NEWS-MONSTER suffix from title', () => {
    const factory = new LinkedInPostFactory()
    const post = factory.videoPost(VIDEO)
    assert.ok(!post.commentary.includes('| NEWS-MONSTER'))
    assert.ok(post.commentary.includes('Scientists Just Set Up What Comes Next'))
  })

  it('includes divider line', () => {
    const factory = new LinkedInPostFactory()
    const post = factory.videoPost(VIDEO)
    assert.ok(post.commentary.includes('━'.repeat(16)))
  })

  it('video post has media URL', () => {
    const factory = new LinkedInPostFactory()
    const post = factory.videoPost(VIDEO)
    assert.equal(post.media.url, 'https://www.youtube.com/shorts/abc123')
  })

  it('limits commentary to 1500 chars', () => {
    const factory = new LinkedInPostFactory()
    const longVideo = { ...VIDEO, summary: 'x'.repeat(2000) }
    const post = factory.videoPost(longVideo)
    assert.ok(post.commentary.length <= 1500)
  })

  it('limits hashtags to 5', () => {
    const factory = new LinkedInPostFactory()
    const manyTags = { ...VIDEO, hashtags: ['#a','#b','#c','#d','#e','#f','#g'] }
    const post = factory.videoPost(manyTags)
    assert.ok(post.hashtags.length <= 5)
  })

  it('defaults to placeholder when no thumbnail', () => {
    const factory = new LinkedInPostFactory()
    const noThumb = { ...VIDEO, thumbnailPath: undefined }
    const post = factory.videoPost(noThumb)
    assert.equal(post.thumbnailPath, null)
  })
})
