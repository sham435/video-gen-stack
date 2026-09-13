import { test } from 'node:test'
import assert from 'node:assert/strict'
import { LinkedInPostFactory } from '../src/publishing/LinkedInPostFactory.mjs'

// Fix E regression: publishVideo performed NO token-freshness check before
// fan-out. With a dead access token the upload fails deep inside the LinkedIn
// API (or refreshes on its own — badly). Now: introspect first, refresh via
// LINKEDIN_REFRESH_TOKEN when the token is inactive, and FAIL CLOSED with a
// descriptive error when no refresh path exists.

const META = {
  title: 'OpenAI launches new flagship AI video model',
  summary: 'A new model generates studio-quality video from text prompts.',
  category: 'technology',
  videoUrl: 'https://example.com/v',
  youtubeShortsUrl: 'https://youtube.com/shorts/x',
  hashtags: ['#AI'],
}

// Mock impl passed through the { linkedin } DI seam. introspectToken is
// token-aware so tests can verify the swap to the refreshed token.
function mockImpl({ active, refreshImpl } = {}) {
  const calls = { introspect: [], refresh: 0, share: [] }
  const impl = {
    calls,
    async introspectToken(token) {
      calls.introspect.push(token)
      if (token === 'fresh-token') return { active: true, scope: ['w_member_social'] }
      return { active: active === true, scope: ['w_member_social'] }
    },
    async refreshAccessToken(refreshToken) {
      calls.refresh++
      if (refreshImpl) return refreshImpl(refreshToken)
      return { access_token: 'fresh-token' }
    },
    async resolveAllAuthorUrns() {
      return [{ urn: 'urn:li:person:111', target: 'profile' }]
    },
    async shareVideoBuffer(token, owner, buffer, commentary) {
      calls.share.push({ token, owner })
      return { id: 'post-123', urn: owner }
    },
  }
  return impl
}

async function withRefreshToken(value, fn) {
  const saved = process.env.LINKEDIN_REFRESH_TOKEN
  const savedTargets = process.env.LINKEDIN_POST_TARGETS
  if (value === undefined) delete process.env.LINKEDIN_REFRESH_TOKEN
  else process.env.LINKEDIN_REFRESH_TOKEN = value
  process.env.LINKEDIN_POST_TARGETS = '' // profile-only → no scope introspection needed
  try { return await fn() } finally {
    if (saved === undefined) delete process.env.LINKEDIN_REFRESH_TOKEN
    else process.env.LINKEDIN_REFRESH_TOKEN = saved
    if (savedTargets === undefined) delete process.env.LINKEDIN_POST_TARGETS
    else process.env.LINKEDIN_POST_TARGETS = savedTargets
  }
}

test('linkedin: active token publishes without touching refresh', async () => {
  const impl = mockImpl({ active: true })
  const factory = new LinkedInPostFactory({ linkedin: impl })
  const results = await factory.publishVideo('good-token', 'urn:li:person:111', Buffer.from('mp4'), META)
  assert.equal(impl.calls.refresh, 0)
  assert.equal(results.length, 1)
  assert.equal(results[0].success, true)
  assert.equal(impl.calls.share[0].token, 'good-token')
})

test('linkedin: inactive token + refresh token → refreshes then publishes with the new token', async () => {
  const impl = mockImpl({ active: false })
  const factory = new LinkedInPostFactory({ linkedin: impl })
  const results = await withRefreshToken('refresh-abc', () =>
    factory.publishVideo('stale-token', 'urn:li:person:111', Buffer.from('mp4'), META))
  assert.equal(impl.calls.refresh, 1)
  assert.equal(results[0].success, true)
  // The share must use the FRESH token, not the stale one.
  assert.equal(impl.calls.share[0].token, 'fresh-token')
})

test('linkedin: inactive token + NO refresh token → fails closed with LINKEDIN_TOKEN_EXPIRED', async () => {
  const impl = mockImpl({ active: false })
  const factory = new LinkedInPostFactory({ linkedin: impl })
  await assert.rejects(
    () => withRefreshToken(undefined, () =>
      factory.publishVideo('stale-token', 'urn:li:person:111', Buffer.from('mp4'), META)),
    /LINKEDIN_TOKEN_EXPIRED.*re-auth/
  )
  assert.equal(impl.calls.share.length, 0)
})

test('linkedin: inactive token + failing refresh → fails closed with refresh error', async () => {
  const impl = mockImpl({ active: false, refreshImpl: async () => { throw new Error('invalid_grant') } })
  const factory = new LinkedInPostFactory({ linkedin: impl })
  await assert.rejects(
    () => withRefreshToken('refresh-abc', () =>
      factory.publishVideo('stale-token', 'urn:li:person:111', Buffer.from('mp4'), META)),
    /LINKEDIN_TOKEN_EXPIRED.*refresh failed/
  )
  assert.equal(impl.calls.share.length, 0)
})

test('linkedin: refresh returning no access_token also fails closed', async () => {
  const impl = mockImpl({ active: false, refreshImpl: async () => ({ error: 'nope' }) })
  const factory = new LinkedInPostFactory({ linkedin: impl })
  await assert.rejects(
    () => withRefreshToken('refresh-abc', () =>
      factory.publishVideo('stale-token', 'urn:li:person:111', Buffer.from('mp4'), META)),
    /LINKEDIN_TOKEN_EXPIRED/
  )
})