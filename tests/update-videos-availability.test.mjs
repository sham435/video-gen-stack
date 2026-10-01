/**
 * Regression tests for FEED-002 — YouTube availability reconciliation
 * (scripts/availability.mjs) and its gate inside update-videos.mjs.
 *
 * Guards: SUCCESS at publication time is NOT the same as PUBLIC forever.
 * The client-facing feed must only contain videos currently PUBLIC.
 * PRIVATE/DELETED/UNKNOWN are retained (state + accumulated sources) but
 * never rendered on the landing page. Fail closed when availability
 * cannot be established. Never fabricates state.
 */

import { describe, it, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import {
  classifyPrivacyStatus,
  chunkIds,
  checkBatchAvailability,
  applyAvailabilityGate,
  Availability,
} from '../scripts/availability.mjs'

/** Deterministic fake navigator for a single videoId. */
function fakeVideo(url, { privacyStatus = 'public', present = true } = {}) {
  const items = present ? [{ id: /id=([^&]+)/.exec(url)?.[1], status: { privacyStatus } }] : []
  return new Response(JSON.stringify({ items }), { status: 200, headers: { 'Content-Type': 'application/json' } })
}
const okJson = (obj, status = 200) => new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json' } })
const idOf = (url) => /id=([^&]+)/.exec(url)?.[1]

const entry = (id, overrides = {}) => ({
  id,
  title: `Title ${id}`,
  description: '',
  category: 'technology',
  publishedAt: '2026-09-20T10:00:00.000Z',
  publishedLabel: 'Sep 20',
  thumbnail: `/thumbnails/${id}.png`,
  thumbnailSha256: null,
  thumbnailWidth: null,
  thumbnailHeight: null,
  thumbnailAspectRatio: null,
  youtubeUrl: `https://youtu.be/${id}`,
  verified: true,
  verificationState: 'VERIFIED',
  thumbnailState: 'UNKNOWN',
  distribution: {},
  ...overrides,
})

describe('classifyPrivacyStatus', () => {
  it('maps privacyStatus to availability', () => {
    assert.equal(classifyPrivacyStatus('public'), Availability.PUBLIC)
    assert.equal(classifyPrivacyStatus('private'), Availability.PRIVATE)
    assert.equal(classifyPrivacyStatus('unlisted'), Availability.UNLISTED)
    assert.equal(classifyPrivacyStatus(undefined), Availability.UNKNOWN)
    assert.equal(classifyPrivacyStatus(null), Availability.UNKNOWN)
    assert.equal(classifyPrivacyStatus('bogus'), Availability.UNKNOWN)
  })
})

describe('chunkIds', () => {
  it('chunks to the YouTube 50-id limit', () => {
    const ids = Array.from({ length: 120 }, (_, i) => `vid-${i}`)
    const chunks = chunkIds(ids)
    assert.equal(chunks.length, 3)
    assert.ok(chunks.every(c => c.length <= 50))
    assert.equal(chunks[0].length, 50)
    assert.equal(chunks[2].length, 20)
    assert.deepEqual(chunks.flat(), ids)
  })
  it('empty input → no chunks', () => {
    assert.deepEqual(chunkIds([]), [])
  })
})

describe('checkBatchAvailability — live YouTube reconciliation', () => {
  const checkedAt = '2026-09-27T00:00:00.000Z'

  it('public video → PUBLIC', async () => {
    const fetchImpl = async (url) => fakeVideo(url, { privacyStatus: 'public' })
    const res = await checkBatchAvailability(['PUB1'], { fetchImpl, checkedAt })
    assert.equal(res.get('PUB1').availability, Availability.PUBLIC)
    assert.equal(res.get('PUB1').checkedAt, checkedAt)
  })

  it('private video → PRIVATE', async () => {
    const fetchImpl = async (url) => fakeVideo(url, { privacyStatus: 'private' })
    const res = await checkBatchAvailability(['PRI1'], { fetchImpl, checkedAt })
    assert.equal(res.get('PRI1').availability, Availability.PRIVATE)
  })

  it('unlisted video → UNLISTED', async () => {
    const fetchImpl = async (url) => fakeVideo(url, { privacyStatus: 'unlisted' })
    const res = await checkBatchAvailability(['UNL1'], { fetchImpl, checkedAt })
    assert.equal(res.get('UNL1').availability, Availability.UNLISTED)
  })

  it('deleted video (absent from a 200 response) → DELETED', async () => {
    const fetchImpl = async (url) => okJson({ items: [] }) // API OK, id not returned
    const res = await checkBatchAvailability(['GONE1'], { fetchImpl, checkedAt })
    assert.equal(res.get('GONE1').availability, Availability.DELETED)
  })

  it('API 5xx / quota → UNKNOWN for the whole batch (fail closed)', async () => {
    // 403 = quotaExceeded style; the API gave no per-video verdict.
    const fetchImpl = async () => new Response(JSON.stringify({ error: { message: 'quotaExceeded' } }), { status: 403 })
    const res = await checkBatchAvailability(['A'], { fetchImpl, checkedAt })
    assert.equal(res.get('A').availability, Availability.UNKNOWN)
  })

  it('network failure → UNKNOWN (fail closed)', async () => {
    const fetchImpl = async () => { throw new Error('ECONNRESET') }
    const res = await checkBatchAvailability(['A', 'B'], { fetchImpl, checkedAt })
    assert.equal(res.get('A').availability, Availability.UNKNOWN)
    assert.equal(res.get('B').availability, Availability.UNKNOWN)
  })

  it('handles a mixed batch with per-id verdicts', async () => {
    const fetchImpl = async (url) =>
      okJson({ items: [
        { id: 'PUB1', status: { privacyStatus: 'public' } },
        { id: 'PRI1', status: { privacyStatus: 'private' } },
        { id: 'UNL1', status: { privacyStatus: 'unlisted' } },
      ] })
    const res = await checkBatchAvailability(['PUB1', 'PRI1', 'UNL1', 'GONE1'], { fetchImpl, checkedAt })
    assert.equal(res.get('PUB1').availability, Availability.PUBLIC)
    assert.equal(res.get('PRI1').availability, Availability.PRIVATE)
    assert.equal(res.get('UNL1').availability, Availability.UNLISTED)
    assert.equal(res.get('GONE1').availability, Availability.DELETED)
  })

  it('empty id list → empty result', async () => {
    const res = await checkBatchAvailability([], { fetchImpl: async () => { throw new Error('must not be called') }, checkedAt })
    assert.equal(res.size, 0)
  })
})

describe('applyAvailabilityGate — PUBLIC only to the feed', () => {
  const availability = (map) => new Map(Object.entries(map))
  const checkedAt = '2026-09-27T00:00:00.000Z'

  it('keeps public, excludes private/deleted/unlisted/unknown', () => {
    const entries = [
      entry('PUB1'),
      entry('PRI1'),
      entry('DEL1', { title: 'Deleted video' }),
      entry('UNL1'),
      entry('UNK1'),
    ]
    const { available, excluded } = applyAvailabilityGate(entries, availability({
      PUB1: { availability: Availability.PUBLIC, checkedAt },
      PRI1: { availability: Availability.PRIVATE, checkedAt },
      DEL1: { availability: Availability.DELETED, checkedAt },
      UNL1: { availability: Availability.UNLISTED, checkedAt },
      UNK1: { availability: Availability.UNKNOWN, checkedAt },
    }))
    assert.deepEqual(available.map(v => v.id), ['PUB1'])
    assert.equal(available[0].availability, Availability.PUBLIC)
    assert.equal(available[0].availabilityCheckedAt, checkedAt)
    assert.equal(excluded.length, 4)
    assert.ok(excluded.every(e => e.availability !== Availability.PUBLIC))
  })

  it('excludes a video missing from the availability map (fail closed)', () => {
    const { available, excluded } = applyAvailabilityGate([entry('NOPE')], new Map())
    assert.equal(available.length, 0)
    assert.equal(excluded[0].availability, Availability.UNKNOWN)
  })

  it('preserves entry schema and ordering of the PUBLIC subset (newest first)', () => {
    const entries = [entry('NEW1', { publishedAt: '2026-09-26T00:00:00Z' }), entry('OLD1', { publishedAt: '2026-09-01T00:00:00Z' })]
    const { available } = applyAvailabilityGate(entries, availability({
      NEW1: { availability: Availability.PUBLIC, checkedAt },
      OLD1: { availability: Availability.PUBLIC, checkedAt },
    }))
    assert.equal(available.length, 2)
    assert.equal(available[0].id, 'NEW1') // ordering preserved from validated input
    // schema keys all still present on gated entries
    for (const key of ['id', 'title', 'publishedAt', 'publishedLabel', 'thumbnail', 'youtubeUrl', 'verified', 'verificationState']) {
      assert.ok(key in available[0], `missing schema key ${key}`)
    }
  })

  it('does not mutate the input entries', () => {
    const entries = [entry('PUB1')]
    const { available } = applyAvailabilityGate(entries, availability({ PUB1: { availability: Availability.PUBLIC, checkedAt } }))
    assert.equal(entries[0].availability, undefined, 'input must not be mutated')
    assert.equal(available[0].availability, Availability.PUBLIC)
  })

  it('tags each surviving video with availability + checkedAt', () => {
    const { available } = applyAvailabilityGate([entry('PUB1')], availability({ PUB1: { availability: Availability.PUBLIC, checkedAt } }))
    assert.equal(available[0].availability, 'PUBLIC')
    assert.equal(available[0].availabilityCheckedAt, checkedAt)
  })
})

describe('historical video becoming unavailable (lifecycle)', () => {
  it('a video previously in the feed is removed once it is deleted/private while remaining in history', () => {
    const checkedAt = '2026-09-27T00:00:00.000Z'
    // Yesterday: verified + public.
    const yesterday = new Map([['VID1', { availability: Availability.PUBLIC, checkedAt: '2026-09-26T00:00:00Z' }]])
    const { available: before } = applyAvailabilityGate([entry('VID1')], yesterday)
    assert.deepEqual(before.map(v => v.id), ['VID1'])

    // Today the video was deleted → the same accumulated entry must NOT be fed.
    const today = new Map([['VID1', { availability: Availability.DELETED, checkedAt }]])
    const { available: after, excluded } = applyAvailabilityGate([entry('VID1')], today)
    assert.equal(after.length, 0)
    assert.equal(excluded[0].availability, Availability.DELETED)
  })

  it('all videos unavailable → empty PUBLIC feed (valid schema, no dead cards)', () => {
    const { available } = applyAvailabilityGate(
      [entry('DEL1'), entry('DEL2')],
      new Map([
        ['DEL1', { availability: Availability.DELETED }],
        ['DEL2', { availability: Availability.DELETED }],
      ])
    )
    assert.deepEqual(available, [])
  })
})

describe('duplicate ids across sources', () => {
  it('availability reconciliation operates on the deduped id set (merge dedupes upstream)', async () => {
    // In the real pipeline mergeVerifiedPublicationSources already dedupes by
    // videoId BEFORE the availability gate (FEED-001 contract). The gate +
    // availability check therefore see one unique id per video.
    const dupes = ['DUP1', 'DUP1']
    const ids = [...new Set(dupes)]
    assert.equal(ids.length, 1) // dedupe contract
    const calls = []
    const fetchImpl = async (url) => { calls.push(url); return fakeVideo(url, { privacyStatus: 'public' }) }
    const res = await checkBatchAvailability(ids, { fetchImpl })
    assert.equal(calls.length, 1) // exactly one API call for one unique id
    const { available } = applyAvailabilityGate([entry('DUP1')], res)
    assert.equal(available.length, 1)
    assert.equal(available[0].availability, Availability.PUBLIC)
  })
})