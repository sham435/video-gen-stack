import { test } from 'node:test'
import assert from 'node:assert/strict'
import { resolveTikTokAccessToken } from '../apps/api/publishers/tiktok.js'

// Fix F regression: the publish path used the raw stored TIKTOK_ACCESS_TOKEN.
// TikTok access tokens live ~24h while the refresh token lasts longer, so a
// stale-stored-token publish failed silently. resolveTikTokAccessToken is
// refresh-FIRST, falls back to the stored access token, and fails closed.

function withEnv(vars, fn) {
  const saved = {}
  for (const [k, v] of Object.entries(vars)) {
    saved[k] = process.env[k]
    if (v === undefined) delete process.env[k]
    else process.env[k] = v
  }
  try { return fn() } finally {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k]
      else process.env[k] = v
    }
  }
}

test('tiktok: no tokens at all → not_authenticated (fail closed)', async () => {
  const refreshImpl = async () => { throw new Error('should not be called') }
  const r = await withEnv({ TIKTOK_ACCESS_TOKEN: undefined, TIKTOK_REFRESH_TOKEN: undefined }, () =>
    resolveTikTokAccessToken(process.env, refreshImpl))
  assert.equal(r.token, null)
  assert.equal(r.reason, 'not_authenticated')
})

test('tiktok: refresh token + working refresh → fresh token wins', async () => {
  let called = 0
  const refreshImpl = async () => { called++; return { access_token: 'fresh-abc' } }
  const r = await withEnv({ TIKTOK_ACCESS_TOKEN: 'stale-xyz', TIKTOK_REFRESH_TOKEN: 'refresh-1' }, () =>
    resolveTikTokAccessToken(process.env, refreshImpl))
  assert.equal(r.token, 'fresh-abc')
  assert.equal(r.refreshed, true)
  assert.equal(called, 1)
})

test('tiktok: refresh fails but stored access token exists → falls back to stored', async () => {
  const refreshImpl = async () => { throw new Error('network down') }
  const r = await withEnv({ TIKTOK_ACCESS_TOKEN: 'stale-xyz', TIKTOK_REFRESH_TOKEN: 'refresh-1' }, () =>
    resolveTikTokAccessToken(process.env, refreshImpl))
  assert.equal(r.token, 'stale-xyz')
  assert.equal(r.refreshed, false)
})

test('tiktok: no refresh token, stored access token exists → stored token used', async () => {
  const refreshImpl = async () => { throw new Error('should not be called') }
  const r = await withEnv({ TIKTOK_ACCESS_TOKEN: 'stale-xyz', TIKTOK_REFRESH_TOKEN: undefined }, () =>
    resolveTikTokAccessToken(process.env, refreshImpl))
  assert.equal(r.token, 'stale-xyz')
  assert.equal(r.refreshed, false)
})

test('tiktok: refresh fails and NO stored access token → refresh_failed (fail closed)', async () => {
  const refreshImpl = async () => { throw new Error('network down') }
  const r = await withEnv({ TIKTOK_ACCESS_TOKEN: undefined, TIKTOK_REFRESH_TOKEN: 'refresh-1' }, () =>
    resolveTikTokAccessToken(process.env, refreshImpl))
  assert.equal(r.token, null)
  assert.equal(r.reason, 'refresh_failed')
})

test('tiktok: refresh returns no access_token → treats as fallback, not fresh', async () => {
  const refreshImpl = async () => ({ error: 'grant expired' })
  const r = await withEnv({ TIKTOK_ACCESS_TOKEN: 'stale-xyz', TIKTOK_REFRESH_TOKEN: 'refresh-1' }, () =>
    resolveTikTokAccessToken(process.env, refreshImpl))
  assert.equal(r.token, 'stale-xyz')
  assert.equal(r.refreshed, false)
})