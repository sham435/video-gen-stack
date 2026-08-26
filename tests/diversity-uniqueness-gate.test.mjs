import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import path from 'node:path'
import fs from 'node:fs'
import os from 'node:os'
import { fileURLToPath } from 'node:url'

import { CandidateDiversityGate } from '../src/thumbnail/CandidateDiversityGate.mjs'
import { GlobalAssetUniquenessGate, ScopeEnforcement } from '../src/uniqueness/GlobalAssetUniquenessGate.mjs'
import { AssetRegistry } from '../src/uniqueness/AssetRegistry.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const FIXTURES = path.join(__dirname, 'fixtures')

describe('CandidateDiversityGate', () => {
  it('computes signature from a real image', async () => {
    const sig = await CandidateDiversityGate.computeSignature(path.join(FIXTURES, 'test-image-16x9.png'))
    assert.ok(sig.perceptualHash)
    assert.ok(Array.isArray(sig.layoutSignature))
    assert.ok(Array.isArray(sig.colorPalette))
    assert.ok(Array.isArray(sig.textRegions))
  })

  it('identical images have low similarity', async () => {
    const sigA = await CandidateDiversityGate.computeSignature(path.join(FIXTURES, 'test-image-16x9.png'))
    const sigB = await CandidateDiversityGate.computeSignature(path.join(FIXTURES, 'test-image-16x9.png'))
    const sim = CandidateDiversityGate.computeSimilarity(sigA, sigB)
    assert.ok(sim < 0.2, `identical images should be very similar, got ${sim}`)
  })

  it('different images have higher similarity', async () => {
    const sigA = await CandidateDiversityGate.computeSignature(path.join(FIXTURES, 'test-image-16x9.png'))
    const sigB = await CandidateDiversityGate.computeSignature(path.join(FIXTURES, 'test-image-9x16.png'))
    const sim = CandidateDiversityGate.computeSimilarity(sigA, sigB)
    assert.ok(sim > 0.05, `different images should have some distance, got ${sim}`)
  })

  it('filter returns all candidates when few', async () => {
    const candidates = [
      { rendered: true, path: path.join(FIXTURES, 'test-image-16x9.png'), strategy: 'a', eligible: true },
    ]
    const r = await CandidateDiversityGate.filter(candidates)
    assert.equal(r.diverse.length, 1)
    assert.equal(r.rejected.length, 0)
  })

  it('filter rejects near-duplicate candidates', async () => {
    // Two copies of the same image = high similarity
    const candidates = [
      { rendered: true, path: path.join(FIXTURES, 'test-image-16x9.png'), strategy: 'hero-hook', eligible: true, compositeScore: 80 },
      { rendered: true, path: path.join(FIXTURES, 'test-image-16x9.png'), strategy: 'breaking-news', eligible: true, compositeScore: 60 },
      { rendered: true, path: path.join(FIXTURES, 'test-image-9x16.png'), strategy: 'data-hook', eligible: true, compositeScore: 70 },
    ]
    const r = await CandidateDiversityGate.filter(candidates, { maxSimilarity: 0.5 })
    // At least one should be rejected
    assert.ok(r.rejected.length >= 1 || r.relaxed, `expected some rejections or relaxation, got ${r.rejected.length}`)
    assert.ok(r.pairs.length >= 1)
  })

  it('filter relaxes when too few diverse candidates remain', async () => {
    // All same image = all similar
    const candidates = [
      { rendered: true, path: path.join(FIXTURES, 'test-image-16x9.png'), strategy: 'a', eligible: true },
      { rendered: true, path: path.join(FIXTURES, 'test-image-16x9.png'), strategy: 'b', eligible: true },
    ]
    const r = await CandidateDiversityGate.filter(candidates, { maxSimilarity: 0.1, minDiverseSet: 2 })
    assert.equal(r.relaxed, true)
    assert.equal(r.diverse.length, 2)
  })

  it('filter skips non-rendered candidates', async () => {
    const candidates = [
      { rendered: false, path: null, strategy: 'failed' },
      { rendered: true, path: path.join(FIXTURES, 'test-image-16x9.png'), strategy: 'ok', eligible: true },
    ]
    const r = await CandidateDiversityGate.filter(candidates)
    assert.equal(r.diverse.length, 1)
  })

  it('_hammingDistance returns 0 for identical strings', () => {
    assert.equal(CandidateDiversityGate._hammingDistance('111000', '111000'), 0)
  })

  it('_hammingDistance returns 1 for completely different strings', () => {
    assert.equal(CandidateDiversityGate._hammingDistance('000000', '111111'), 1)
  })

  it('_layoutDistance returns 0 for identical layouts', () => {
    const sig = [0.5, 0.3, 0.7, 0.2]
    assert.equal(CandidateDiversityGate._layoutDistance(sig, sig), 0)
  })

  it('_paletteDistance returns 0 for identical palettes', () => {
    const pal = [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8]
    assert.equal(CandidateDiversityGate._paletteDistance(pal, pal), 0)
  })
})

describe('GlobalAssetUniquenessGate', () => {
  let tmpDir, registry

  function makeRegistry() {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'uniqueness-gate-'))
    return new AssetRegistry({ filePath: path.join(tmpDir, 'registry.json'), rollingWindow: 50 })
  }

  it('getScopes returns all 8 scopes', () => {
    const scopes = GlobalAssetUniquenessGate.getScopes()
    assert.equal(scopes.length, 8)
    assert.ok(scopes.every(s => s.enforcement))
  })

  it('getEnforcementStatus returns ENFORCED/BEST_EFFORT per scope', () => {
    const gate = new GlobalAssetUniquenessGate(makeRegistry())
    const status = gate.getEnforcementStatus()
    assert.equal(status.length, 8)
    const enforced = status.filter(s => s.enforcement === ScopeEnforcement.ENFORCED)
    const bestEffort = status.filter(s => s.enforcement === ScopeEnforcement.BEST_EFFORT)
    assert.ok(enforced.length >= 6, `expected >=6 ENFORCED, got ${enforced.length}`)
    assert.ok(bestEffort.length >= 1, `expected >=1 BEST_EFFORT, got ${bestEffort.length}`)
  })

  it('validates empty manifest passes', async () => {
    const gate = new GlobalAssetUniquenessGate(makeRegistry())
    const r = await gate.validate({})
    assert.equal(r.pass, true)
    assert.equal(r.violations.length, 0)
  })

  it('scene-within-video detects duplicate images', async () => {
    const gate = new GlobalAssetUniquenessGate(makeRegistry())
    const manifest = {
      scenes: [
        { sceneIndex: 0, imageHash: 'hash_a' },
        { sceneIndex: 1, imageHash: 'hash_a' }, // duplicate!
      ],
    }
    const r = await gate.validate(manifest)
    assert.equal(r.pass, false)
    assert.ok(r.violations.some(v => v.type === 'DUPLICATE_SCENE_IMAGE'))
  })

  it('scene-within-video passes for unique images', async () => {
    const gate = new GlobalAssetUniquenessGate(makeRegistry())
    const manifest = {
      scenes: [
        { sceneIndex: 0, imageHash: 'hash_a' },
        { sceneIndex: 1, imageHash: 'hash_b' },
      ],
    }
    const r = await gate.validate(manifest)
    assert.equal(r.pass, true)
  })

  it('music-within-video passes for single track', async () => {
    const gate = new GlobalAssetUniquenessGate(makeRegistry())
    const manifest = { music: { trackId: 'track_1' } }
    const r = await gate.validate(manifest)
    assert.equal(r.pass, true)
  })

  it('thumbnail-across-video detects duplicate composition hash', async () => {
    const reg = makeRegistry()
    reg.recordPublishedVideo('vid_1', { thumbnailCompositionHash: 'thumb_hash_1' })
    const gate = new GlobalAssetUniquenessGate(reg)
    const manifest = { thumbnail: { compositionHash: 'thumb_hash_1' } }
    const r = await gate.validate(manifest)
    assert.equal(r.pass, false)
    assert.ok(r.violations.some(v => v.type === 'THUMBNAIL_COMPOSITION_DUPLICATE'))
  })

  it('thumbnail-across-video passes for unique hash', async () => {
    const gate = new GlobalAssetUniquenessGate(makeRegistry())
    const manifest = { thumbnail: { compositionHash: 'new_thumb_hash' } }
    const r = await gate.validate(manifest)
    assert.equal(r.pass, true)
  })

  it('thumbnail-within-video is BEST_EFFORT (warning not violation)', async () => {
    const gate = new GlobalAssetUniquenessGate(makeRegistry())
    const manifest = {
      scenes: [{ sceneIndex: 0, imageHash: 'scene_hash' }],
      thumbnail: { compositionHash: 'scene_hash' }, // matches scene
    }
    const r = await gate.validate(manifest)
    // Should still pass (BEST_EFFORT = warning)
    assert.equal(r.pass, true)
    assert.ok(r.warnings.length >= 1)
    assert.ok(r.scopeResults.find(s => s.scope === 'thumbnail-within-video').enforcement === ScopeEnforcement.BEST_EFFORT)
  })

  it('scene-across-video detects duplicates via registry', async () => {
    const reg = makeRegistry()
    reg.recordPublishedVideo('vid_1', { imageHashes: ['old_img'] })
    const gate = new GlobalAssetUniquenessGate(reg)
    const manifest = { scenes: [{ sceneIndex: 0, imageHash: 'old_img' }] }
    const r = await gate.validate(manifest)
    assert.equal(r.pass, false)
    assert.ok(r.violations.some(v => v.scope === 'scene-across-video'))
  })

  it('music-across-video detects duplicates via registry', async () => {
    const reg = makeRegistry()
    reg.recordPublishedVideo('vid_1', { musicTrackId: 'old_track' })
    const gate = new GlobalAssetUniquenessGate(reg)
    const manifest = { music: { trackId: 'old_track' } }
    const r = await gate.validate(manifest)
    assert.equal(r.pass, false)
    assert.ok(r.violations.some(v => v.scope === 'music-across-video'))
  })

  it('reserve/commit/release lifecycle works', () => {
    const reg = makeRegistry()
    const gate = new GlobalAssetUniquenessGate(reg)

    const r1 = gate.reserve('job-1', { scriptHash: 's1', imageHashes: ['img1'] })
    assert.equal(r1.reserved, true)

    // Second job cannot reserve same assets
    const r2 = gate.reserve('job-2', { scriptHash: 's1' })
    assert.equal(r2.reserved, false)
    assert.ok(r2.conflict.includes('SCRIPT'))

    // Release and re-reserve
    gate.release('job-1')
    const r3 = gate.reserve('job-2', { scriptHash: 's1' })
    assert.equal(r3.reserved, true)

    gate.commit('job-2', { videoId: 'vid-2' })
  })

  it('scope results include enforcement level', async () => {
    const gate = new GlobalAssetUniquenessGate(makeRegistry())
    const r = await gate.validate({})
    assert.ok(r.scopeResults.length === 8)
    for (const s of r.scopeResults) {
      assert.ok(['ENFORCED', 'BEST_EFFORT', 'NOT_IMPLEMENTED'].includes(s.enforcement))
    }
  })
})

describe('AssetRegistry thumbnail extensions', () => {
  let tmpDir

  function makeRegistry() {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'registry-thumb-'))
    return new AssetRegistry({ filePath: path.join(tmpDir, 'registry.json'), rollingWindow: 10 })
  }

  it('isThumbnailDuplicate returns false for new hash', () => {
    const reg = makeRegistry()
    assert.equal(reg.isThumbnailDuplicate('new_hash'), false)
  })

  it('isThumbnailDuplicate returns true for committed hash', () => {
    const reg = makeRegistry()
    reg.recordPublishedVideo('v1', { thumbnailCompositionHash: 'thumb_1' })
    assert.equal(reg.isThumbnailDuplicate('thumb_1'), true)
  })

  it('isThumbnailDuplicate excludes own reservation jobId', () => {
    const reg = makeRegistry()
    reg.reserve('job-1', { thumbnailCompositionHash: 'thumb_1' })
    assert.equal(reg.isThumbnailDuplicate('thumb_1'), true) // reserved by job-1, visible to others
    assert.equal(reg.isThumbnailDuplicate('thumb_1', 'job-1'), false) // exclude own reservation
    reg.commit('job-1', { videoId: 'v1' })
    assert.equal(reg.isThumbnailDuplicate('thumb_1'), true) // now committed permanently
    assert.equal(reg.isThumbnailDuplicate('thumb_1', 'job-1'), true) // committed = permanent, exclude doesn't apply
  })

  it('isThumbnailPerceptualDuplicate works', () => {
    const reg = makeRegistry()
    reg.recordPublishedVideo('v1', { thumbnailPerceptualHash: 'perc_1' })
    assert.equal(reg.isThumbnailPerceptualDuplicate('perc_1'), true)
    assert.equal(reg.isThumbnailPerceptualDuplicate('perc_2'), false)
  })

  it('reserve includes thumbnail hashes', () => {
    const reg = makeRegistry()
    const r = reg.reserve('job-1', { thumbnailHash: 'th_1', thumbnailCompositionHash: 'tc_1' })
    assert.equal(r.reserved, true)
    const res = reg.listReservations()
    assert.equal(res['job-1'].thumbnailHash, 'th_1')
    assert.equal(res['job-1'].thumbnailCompositionHash, 'tc_1')
  })

  it('thumbnail conflict detected across reservations', () => {
    const reg = makeRegistry()
    reg.reserve('job-1', { thumbnailCompositionHash: 'tc_1' })
    const r = reg.reserve('job-2', { thumbnailCompositionHash: 'tc_1' })
    assert.equal(r.reserved, false)
    assert.ok(r.conflict.includes('THUMBNAIL'))
  })

  it('getStats includes thumbnails', () => {
    const reg = makeRegistry()
    reg.recordThumbnail({ compositionHash: 'c1', perceptualHash: 'p1' })
    const stats = reg.getStats()
    assert.equal(stats.thumbnails, 1)
  })
})
