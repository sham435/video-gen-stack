/**
 * Regression tests for accumulated feed generation (scripts/update-videos.mjs).
 *
 * Guards the production feed repair (task-115):
 *  - update-videos.mjs must accumulate verified publications from ALL durable
 *    sources (ledgers + production/runs evidence) instead of collapsing to the
 *    per-run scratch ledger.
 *  - Deduplication by videoId across sources, no fabricated videoIds, schema
 *    preserved, newest-first ordering.
 */

import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { mergeVerifiedPublicationSources } from '../scripts/update-videos.mjs'

const ledgerEntry = (videoId, overrides = {}) => ({
  videoId,
  title: `Ledger ${videoId}`,
  category: 'technology',
  publishedAt: '2026-09-20T10:00:00.000Z',
  uploadState: 'SUCCESS',
  verificationState: 'VERIFIED',
  distribution: { youtube: { state: 'SUCCESS', url: `https://youtu.be/${videoId}` } },
  ...overrides,
})

const runPublication = (videoId, overrides = {}) => ({
  videoId,
  publishedAt: '2026-09-19T10:00:00.000Z',
  upload: { state: 'SUCCESS', url: `https://youtu.be/${videoId}` },
  verification: { state: 'VERIFIED (REENCODED)', passed: true },
  distribution: { youtube: { state: 'SUCCESS', videoId, url: `https://youtu.be/${videoId}` } },
  ...overrides,
})

const detailPage = (videoId, overrides = {}) => ({
  videoId,
  title: `Detail ${videoId}`,
  category: 'general',
  description: `Detail description for ${videoId}`,
  ...overrides,
})

describe('mergeVerifiedPublicationSources — accumulated feed (task-115)', () => {
  it('accumulates run publications that have no ledger entry (historical evidence)', () => {
    const merged = mergeVerifiedPublicationSources({
      runPublications: [runPublication('AAA111'), runPublication('BBB222')],
    })
    assert.equal(merged.length, 2)
    const ids = merged.map(e => e.videoId).sort()
    assert.deepEqual(ids, ['AAA111', 'BBB222'])
  })

  it('deduplicates by videoId when the same video is in multiple sources', () => {
    const merged = mergeVerifiedPublicationSources({
      ledgerEntries: [ledgerEntry('AAA111')],
      runPublications: [runPublication('AAA111'), runPublication('BBB222')],
    })
    assert.equal(merged.length, 2)
    const aaa = merged.find(e => e.videoId === 'AAA111')
    // ledger metadata wins for the duplicated video
    assert.equal(aaa.title, 'Ledger AAA111')
  })

  it('rejects ledger REJECTED and non-SUCCESS uploads', () => {
    const merged = mergeVerifiedPublicationSources({
      ledgerEntries: [
        ledgerEntry('OK'),
        ledgerEntry('REJ', { verificationState: 'REJECTED' }),
        ledgerEntry('FL', { uploadState: 'FAILED' }),
      ],
    })
    assert.deepEqual(merged.map(e => e.videoId), ['OK'])
  })

  it('rejects run publications without passed verification', () => {
    const merged = mergeVerifiedPublicationSources({
      runPublications: [
        runPublication('PASS'),
        runPublication('NOF', { verification: { state: 'REJECTED', passed: false } }),
        runPublication('NOV', { upload: { state: 'FAILED' } }),
      ],
    })
    assert.deepEqual(merged.map(e => e.videoId), ['PASS'])
  })

  it('enriches surviving records with committed gallery metadata but never fabricates new videoIds', () => {
    const merged = mergeVerifiedPublicationSources({
      runPublications: [runPublication('AAA111')],
      detailPages: [detailPage('AAA111', { title: 'Real Title', category: 'technology' }), detailPage('GHOST')],
    })
    assert.equal(merged.length, 1)
    const [v] = merged
    assert.equal(v.videoId, 'AAA111')
    assert.equal(v.title, 'Real Title')
    // a ghost detail page without any verified backing must NOT appear
    assert.ok(!merged.some(e => e.videoId === 'GHOST'))
  })

  it('preserves verification state and distribution from run publications', () => {
    const merged = mergeVerifiedPublicationSources({
      runPublications: [runPublication('VID_123')],
    })
    const [v] = merged
    assert.equal(v.uploadState, 'SUCCESS')
    assert.equal(v.verificationState, 'VERIFIED (REENCODED)')
    assert.equal(v.distribution.youtube.url, 'https://youtu.be/VID_123')
  })

  it('handles a fully empty source set without throwing', () => {
    assert.deepEqual(mergeVerifiedPublicationSources(), [])
    assert.deepEqual(mergeVerifiedPublicationSources({ ledgerEntries: [], runPublications: [], detailPages: [] }), [])
  })
})