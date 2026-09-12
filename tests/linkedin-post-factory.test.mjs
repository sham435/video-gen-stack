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
    assert.ok(post.commentary.includes('youtube.com/@news-monster'))
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

  it('resolveTargetUrns — default (org disabled) returns profile only', async () => {
    const factory = new LinkedInPostFactory()
    process.env.LINKEDIN_POST_TARGETS = ''
    process.env.LINKEDIN_ORG_SOCIAL = '0'
    process.env.LINKEDIN_ORG_ID = '424242'
    const targets = await factory.resolveTargetUrns('urn:li:person:abc')
    assert.equal(targets.length, 1)
    assert.equal(targets[0].target, 'profile')
  })

  it('resolveTargetUrns — both mode with org scope returns profile + company', async () => {
    const factory = new LinkedInPostFactory()
    process.env.LINKEDIN_POST_TARGETS = 'both'
    process.env.LINKEDIN_ORG_SOCIAL = '1'
    process.env.LINKEDIN_ORG_ID = '424242'
    const targets = await factory.resolveTargetUrns('urn:li:person:abc', {
      resolveScope: async () => true,
    })
    assert.equal(targets.length, 2)
    assert.equal(targets[0].target, 'profile')
    assert.equal(targets[1].target, 'company')
    assert.equal(targets[1].urn, 'urn:li:organization:424242')
  })

  it('resolveTargetUrns — both mode but no org scope skips company', async () => {
    const factory = new LinkedInPostFactory()
    process.env.LINKEDIN_POST_TARGETS = 'both'
    process.env.LINKEDIN_ORG_SOCIAL = '1'
    process.env.LINKEDIN_ORG_ID = '424242'
    const targets = await factory.resolveTargetUrns('urn:li:person:abc', {
      resolveScope: async () => false,
    })
    assert.equal(targets.length, 1)
    assert.equal(targets[0].target, 'profile')
  })

  it('resolveTargetUrns — company mode uses org URN when LINKEDIN_ORGANIZATION_URN set', async () => {
    const factory = new LinkedInPostFactory()
    process.env.LINKEDIN_POST_TARGETS = 'company'
    process.env.LINKEDIN_ORG_SOCIAL = '1'
    process.env.LINKEDIN_ORGANIZATION_URN = 'urn:li:organization:777777'
    const targets = await factory.resolveTargetUrns('urn:li:person:abc', {
      resolveScope: async () => true,
    })
    assert.equal(targets.length, 1)
    assert.equal(targets[0].target, 'company')
    assert.equal(targets[0].urn, 'urn:li:organization:777777')
  })

  it('publishVideo — org enabled with w_organization_social token posts to profile + company', async () => {
    process.env.LINKEDIN_POST_TARGETS = ''
    process.env.LINKEDIN_ORG_SOCIAL = '1'
    process.env.LINKEDIN_ORG_ID = '424242'
    delete process.env.LINKEDIN_ORGANIZATION_URN

    const posted = []
    const factory = new LinkedInPostFactory({
      linkedin: {
        introspectToken: async () => ({ active: true, scope: ['r_liteprofile', 'w_member_social', 'w_organization_social'] }),
        resolveAllAuthorUrns: async () => [{ urn: 'urn:li:person:abc', target: 'profile' }],
        shareVideoBuffer: async (token, owner, buffer, commentary) => {
          posted.push({ owner, commentary })
          return { id: 'urn:li:share:123', urn: owner }
        },
      },
    })

    const results = await factory.publishVideo('fake-token', 'urn:li:person:abc', Buffer.from('mp4'), {
      title: 'Test Video', summary: 'Summary', category: 'sports',
      videoUrl: 'https://youtu.be/abc', youtubeShortsUrl: 'https://www.youtube.com/watch?v=abc',
      hashtags: ['#news'], thumbnailPath: '/tmp/t.png',
    })

    const targets = results.map(r => r.target).sort()
    assert.deepEqual(targets, ['company', 'profile'])
    assert.equal(posted.length, 2)
    assert.ok(posted.some(p => p.owner === 'urn:li:organization:424242'))
    assert.ok(posted.some(p => p.owner === 'urn:li:person:abc'))
  })

  it('publishVideo — org enabled but token lacks w_organization_social posts to profile only', async () => {
    process.env.LINKEDIN_POST_TARGETS = ''
    process.env.LINKEDIN_ORG_SOCIAL = '1'
    process.env.LINKEDIN_ORG_ID = '424242'
    delete process.env.LINKEDIN_ORGANIZATION_URN

    const posted = []
    const factory = new LinkedInPostFactory({
      linkedin: {
        introspectToken: async () => ({ active: true, scope: ['r_liteprofile', 'w_member_social'] }),
        resolveAllAuthorUrns: async () => [{ urn: 'urn:li:person:abc', target: 'profile' }],
        shareVideoBuffer: async (token, owner, buffer, commentary) => {
          posted.push({ owner, commentary })
          return { id: 'urn:li:share:123', urn: owner }
        },
      },
    })

    const results = await factory.publishVideo('fake-token', 'urn:li:person:abc', Buffer.from('mp4'), {
      title: 'Test Video', summary: 'Summary', category: 'sports',
      videoUrl: 'https://youtu.be/abc', youtubeShortsUrl: 'https://www.youtube.com/watch?v=abc',
      hashtags: ['#news'], thumbnailPath: '/tmp/t.png',
    })

    const targets = results.map(r => r.target).sort()
    assert.deepEqual(targets, ['profile'])
    assert.equal(posted.length, 1)
    assert.equal(posted[0].owner, 'urn:li:person:abc')
  })
})
