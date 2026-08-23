import assert from 'node:assert/strict'
import { describe, it, beforeEach, afterEach } from 'node:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { AssetRegistry } from '../src/uniqueness/AssetRegistry.mjs'
import { ProductionUniquenessManifest } from '../src/uniqueness/ProductionUniquenessManifest.mjs'
import { ScriptUniqueness } from '../src/uniqueness/ScriptUniqueness.mjs'
import { SceneAssetUniqueness } from '../src/uniqueness/SceneAssetUniqueness.mjs'
import { MusicUniqueness } from '../src/uniqueness/MusicUniqueness.mjs'
import { UniquenessPreflight } from '../src/uniqueness/UniquenessPreflight.mjs'

const ARTICLE = {
  title: 'Tesla Q4 Earnings Crush Expectations',
  category: 'TESLA',
  publishedAt: '2026-08-24T12:00:00Z',
}

describe('AssetRegistry', () => {
  let tmpDir, reg

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'asset-reg-'))
    reg = new AssetRegistry({ filePath: path.join(tmpDir, 'registry.json') })
  })
  afterEach(() => { fs.rmSync(tmpDir, { recursive: true, force: true }) })

  it('records and detects script duplicates', () => {
    const hash = AssetRegistry.hash('Tesla crushes earnings')
    reg.recordScript(hash, { articleHash: 'art-1', jobId: 'j1' })
    assert.equal(reg.isScriptDuplicate(hash), false) // first use, no video published

    // After publishing a video with this script
    reg.recordPublishedVideo('v1', { scriptHash: hash })
    assert.equal(reg.isScriptDuplicate(hash), true) // now it's in the rolling window
  })

  it('records and detects image duplicates', () => {
    const hash = AssetRegistry.hash('tesla-hero-image')
    reg.recordImage(hash, { sourceId: 'pexels-123' })
    assert.equal(reg.isImageDuplicate(hash), false)

    reg.recordPublishedVideo('v1', { imageHashes: [hash] })
    assert.equal(reg.isImageDuplicate(hash), true)
  })

  it('records and detects music duplicates', () => {
    const trackId = 'epic-trailer-001'
    reg.recordMusic(trackId, { family: 'epic' })
    assert.equal(reg.isMusicDuplicate(trackId), false)

    reg.recordPublishedVideo('v1', { musicTrackId: trackId })
    assert.equal(reg.isMusicDuplicate(trackId), true)
  })

  it('rolling window limits dedup to last N videos', () => {
    const hash = AssetRegistry.hash('old-script')
    reg.recordScript(hash)
    // Publish 1 video with the old script
    reg.recordPublishedVideo('v0', { scriptHash: hash })
    // Then publish 50 videos with different scripts (pushes v0 out of window)
    for (let i = 1; i <= 50; i++) {
      reg.recordPublishedVideo(`v${i}`, { scriptHash: `other-${i}` })
    }
    // Only last 50 videos in window: v1..v50 (v0 pushed out)
    assert.equal(reg.state.publishedVideos.length, 50)
    // Old script should NOT be a duplicate (aged out of window)
    assert.equal(reg.isScriptDuplicate(hash), false)
  })

  it('multiple script uses without video publication', () => {
    const hash = AssetRegistry.hash('repeated-script')
    reg.recordScript(hash, { jobId: 'j1' })
    reg.recordScript(hash, { jobId: 'j2' }) // used again
    // usageCount > 1 means it's tracked
    assert.equal(reg.state.scripts[hash].usageCount, 2)
    // isScriptDuplicate checks publishedVideos window, not usageCount alone
    assert.equal(reg.isScriptDuplicate(hash), false) // no video published
    reg.recordPublishedVideo('v1', { scriptHash: hash })
    assert.equal(reg.isScriptDuplicate(hash), true)
  })

  it('getStats returns counts', () => {
    reg.recordScript('hash1')
    reg.recordImage('hash2')
    reg.recordMusic('track1')
    const stats = reg.getStats()
    assert.equal(stats.scripts, 1)
    assert.equal(stats.images, 1)
    assert.equal(stats.music, 1)
    assert.equal(stats.publishedVideos, 0)
  })

  it('cleanup resets state', () => {
    reg.recordScript('hash1')
    reg.cleanup()
    assert.equal(Object.keys(reg.state.scripts).length, 0)
  })

  it('hash() is deterministic', () => {
    const h1 = AssetRegistry.hash('hello world')
    const h2 = AssetRegistry.hash('hello world')
    assert.equal(h1, h2)
    assert.equal(h1.length, 16)
  })
})

describe('ProductionUniquenessManifest', () => {
  it('builds a complete manifest', () => {
    const m = new ProductionUniquenessManifest()
      .setArticle(ARTICLE)
      .setScript('Tesla has reported record Q4 earnings...')
      .addScene(0, { imageHash: 'img-001', sourceId: 'pexels-1' })
      .addScene(1, { imageHash: 'img-002', sourceId: 'pexels-2' })
      .setMusic('epic-001', { family: 'epic' })
      .setThumbnail('thumb-abc')
      .setJobId('job-123')
      .build()

    assert.ok(m.articleHash)
    assert.ok(m.scriptHash)
    assert.equal(m.scenes.length, 2)
    assert.equal(m.scenes[0].imageHash, 'img-001')
    assert.equal(m.music.trackId, 'epic-001')
    assert.equal(m.thumbnail.artifactHash, 'thumb-abc')
    assert.equal(m.jobId, 'job-123')
    assert.ok(m.createdAt)
  })

  it('getAllImageHashes collects scenes + thumbnail', () => {
    const m = new ProductionUniquenessManifest()
      .addScene(0, { imageHash: 'img-001' })
      .addScene(1, { imageHash: 'img-002' })
      .setThumbnail('thumb-xyz')

    const hashes = m.getAllImageHashes()
    assert.deepEqual(hashes, ['img-001', 'img-002', 'thumb-xyz'])
  })

  it('hashArticle is deterministic', () => {
    const h1 = ProductionUniquenessManifest.hashArticle(ARTICLE)
    const h2 = ProductionUniquenessManifest.hashArticle(ARTICLE)
    assert.equal(h1, h2)
  })
})

describe('ScriptUniqueness', () => {
  let tmpDir, reg, checker

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'script-unq-'))
    reg = new AssetRegistry({ filePath: path.join(tmpDir, 'reg.json') })
    checker = new ScriptUniqueness(reg)
  })
  afterEach(() => { fs.rmSync(tmpDir, { recursive: true, force: true }) })

  it('passes for a new script', () => {
    const r = checker.validate('Brand new narration text about Tesla')
    assert.equal(r.pass, true)
    assert.ok(r.hash)
  })

  it('fails for empty script', () => {
    const r = checker.validate('')
    assert.equal(r.pass, false)
    assert.equal(r.reason, 'EMPTY_SCRIPT')
  })

  it('fails for script published in recent video', () => {
    const text = 'Tesla crushes Q4 with record revenue'
    const hash = AssetRegistry.hash(text)
    reg.recordScript(hash)
    reg.recordPublishedVideo('v1', { scriptHash: hash })

    const r = checker.validate(text)
    assert.equal(r.pass, false)
    assert.ok(r.reason.includes('SCRIPT_DUPLICATE'))
  })

  it('passes for script outside rolling window', () => {
    const text = 'Ancient news from the past'
    const hash = AssetRegistry.hash(text)
    reg.recordScript(hash)
    // Publish 51 videos without this script to push it out
    for (let i = 0; i < 51; i++) {
      reg.recordPublishedVideo(`v${i}`, { scriptHash: `other-${i}` })
    }
    // The script hash is NOT in any recent video
    const r = checker.validate(text)
    assert.equal(r.pass, true)
  })

  it('record() tracks the script in registry', () => {
    const text = 'Recorded narration'
    const hash = checker.record(text, { articleHash: 'a1', jobId: 'j1' })
    assert.ok(hash)
    assert.ok(reg.state.scripts[hash])
    assert.equal(reg.state.scripts[hash].jobId, 'j1')
  })
})

describe('SceneAssetUniqueness', () => {
  let tmpDir, reg, checker

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'scene-unq-'))
    reg = new AssetRegistry({ filePath: path.join(tmpDir, 'reg.json') })
    checker = new SceneAssetUniqueness(reg)
  })
  afterEach(() => { fs.rmSync(tmpDir, { recursive: true, force: true }) })

  it('passes for all new images', () => {
    const scenes = [
      { sceneIndex: 0, imageHash: 'img-new-1' },
      { sceneIndex: 1, imageHash: 'img-new-2' },
    ]
    const r = checker.validate(scenes)
    assert.equal(r.pass, true)
    assert.equal(r.violations.length, 0)
    assert.equal(r.total, 2)
  })

  it('fails when any image was used in a recent video', () => {
    reg.recordImage('img-used', { sourceId: 'pexels-1' })
    reg.recordPublishedVideo('v1', { imageHashes: ['img-used'] })

    const scenes = [
      { sceneIndex: 0, imageHash: 'img-new' },
      { sceneIndex: 1, imageHash: 'img-used' },
    ]
    const r = checker.validate(scenes)
    assert.equal(r.pass, false)
    assert.equal(r.violations.length, 1)
    assert.equal(r.violations[0].sceneIndex, 1)
    assert.ok(r.violations[0].reason.includes('IMAGE_DUPLICATE'))
  })

  it('skips scenes without imageHash', () => {
    const scenes = [
      { sceneIndex: 0 }, // no imageHash
      { sceneIndex: 1, imageHash: 'img-123' },
    ]
    const r = checker.validate(scenes)
    assert.equal(r.pass, true)
    assert.equal(r.total, 2)
  })

  it('record() tracks all scene images', () => {
    const scenes = [
      { sceneIndex: 0, imageHash: 'img-a' },
      { sceneIndex: 1, imageHash: 'img-b' },
    ]
    checker.record(scenes, { jobId: 'j1' })
    assert.ok(reg.state.images['img-a'])
    assert.ok(reg.state.images['img-b'])
  })
})

describe('MusicUniqueness', () => {
  let tmpDir, reg, checker

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'music-unq-'))
    reg = new AssetRegistry({ filePath: path.join(tmpDir, 'reg.json') })
    checker = new MusicUniqueness(reg)
  })
  afterEach(() => { fs.rmSync(tmpDir, { recursive: true, force: true }) })

  it('passes for a new track', () => {
    const r = checker.validate({ trackId: 'track-001', family: 'epic' })
    assert.equal(r.pass, true)
  })

  it('passes for null/empty music', () => {
    const r = checker.validate(null)
    assert.equal(r.pass, true)
    const r2 = checker.validate({})
    assert.equal(r2.pass, true)
  })

  it('fails for track used in recent video', () => {
    reg.recordMusic('track-used', { family: 'epic' })
    reg.recordPublishedVideo('v1', { musicTrackId: 'track-used' })

    const r = checker.validate({ trackId: 'track-used' })
    assert.equal(r.pass, false)
    assert.ok(r.reason.includes('MUSIC_DUPLICATE'))
  })

  it('record() tracks music in registry', () => {
    checker.record({ trackId: 't1', family: 'ambient' }, { jobId: 'j1' })
    assert.ok(reg.state.music['t1'])
    assert.equal(reg.state.music['t1'].family, 'ambient')
  })
})

describe('UniquenessPreflight', () => {
  let tmpDir, reg, preflight

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'preflight-unq-'))
    reg = new AssetRegistry({ filePath: path.join(tmpDir, 'reg.json') })
    preflight = new UniquenessPreflight(reg)
  })
  afterEach(() => { fs.rmSync(tmpDir, { recursive: true, force: true }) })

  it('passes for a completely new manifest', () => {
    const manifest = new ProductionUniquenessManifest()
      .setArticle(ARTICLE)
      .setScript('Fresh narration about Tesla earnings')
      .addScene(0, { imageHash: 'img-fresh' })
      .setMusic('fresh-track', { family: 'ambient' })
      .setJobId('job-new')
      .build()

    const r = preflight.validate(manifest)
    assert.equal(r.pass, true)
    assert.equal(r.violations.length, 0)
  })

  it('fails when script is duplicate', () => {
    // Pre-populate registry with a used script
    const scriptHash = AssetRegistry.hash('Tesla crushes Q4')
    reg.recordScript(scriptHash)
    reg.recordPublishedVideo('v1', { scriptHash })

    const manifest = new ProductionUniquenessManifest()
      .setArticle(ARTICLE)
      .setScript('Tesla crushes Q4')
      .setJobId('job-dup')
      .build()

    const r = preflight.validate(manifest)
    assert.equal(r.pass, false)
    assert.ok(r.violations.some(v => v.type === 'SCRIPT'))
  })

  it('fails when scene image is duplicate', () => {
    reg.recordImage('img-reused')
    reg.recordPublishedVideo('v1', { imageHashes: ['img-reused'] })

    const manifest = new ProductionUniquenessManifest()
      .setArticle(ARTICLE)
      .setScript('New unique script')
      .addScene(0, { imageHash: 'img-reused' })
      .setJobId('job-img-dup')
      .build()

    const r = preflight.validate(manifest)
    assert.equal(r.pass, false)
    assert.ok(r.violations.some(v => v.type === 'SCENE_IMAGE'))
  })

  it('fails when music track is duplicate', () => {
    reg.recordMusic('used-track', { family: 'epic' })
    reg.recordPublishedVideo('v1', { musicTrackId: 'used-track' })

    const manifest = new ProductionUniquenessManifest()
      .setArticle(ARTICLE)
      .setScript('New script for music test')
      .setMusic('used-track', { family: 'epic' })
      .setJobId('job-music-dup')
      .build()

    const r = preflight.validate(manifest)
    assert.equal(r.pass, false)
    assert.ok(r.violations.some(v => v.type === 'MUSIC'))
  })

  it('passes for assets outside the rolling window', () => {
    // Pre-populate with old assets
    const oldHash = AssetRegistry.hash('old narration')
    reg.recordScript(oldHash)
    for (let i = 0; i < 51; i++) {
      reg.recordPublishedVideo(`v${i}`, { scriptHash: `other-${i}` })
    }

    const manifest = new ProductionUniquenessManifest()
      .setArticle(ARTICLE)
      .setScript('old narration')
      .setJobId('job-old')
      .build()

    const r = preflight.validate(manifest)
    assert.equal(r.pass, true) // aged out of window
  })

  it('reserve() + commit() tracks all assets after publish', () => {
    const manifest = new ProductionUniquenessManifest()
      .setArticle(ARTICLE)
      .setScript('Published narration')
      .addScene(0, { imageHash: 'img-pub' })
      .setMusic('music-pub', { family: 'ambient' })
      .setJobId('job-pub')
      .build()

    // Reserve
    const res = preflight.reserve(manifest, { jobId: 'job-pub' })
    assert.equal(res.reserved, true)
    assert.ok(reg.state.reservations['job-pub'])

    // Commit
    const committed = preflight.commit('job-pub', { videoId: 'vid-123' })
    assert.equal(committed, true)
    assert.equal(reg.state.reservations['job-pub'], undefined)

    // All assets should now be in permanent indexes
    const scriptHash = AssetRegistry.hash('Published narration')
    assert.ok(reg.state.scripts[scriptHash])
    assert.ok(reg.state.images['img-pub'])
    assert.ok(reg.state.music['music-pub'])
    assert.equal(reg.state.publishedVideos.length, 1)
    assert.equal(reg.state.publishedVideos[0].videoId, 'vid-123')
  })

  it('multiple violations reported together', () => {
    // Pre-populate duplicates
    const scriptHash = AssetRegistry.hash('dup script')
    reg.recordScript(scriptHash)
    reg.recordImage('dup-img')
    reg.recordMusic('dup-music')
    reg.recordPublishedVideo('v1', {
      scriptHash,
      imageHashes: ['dup-img'],
      musicTrackId: 'dup-music',
    })

    const manifest = new ProductionUniquenessManifest()
      .setArticle(ARTICLE)
      .setScript('dup script')
      .addScene(0, { imageHash: 'dup-img' })
      .setMusic('dup-music')
      .setJobId('job-multi')
      .build()

    const r = preflight.validate(manifest)
    assert.equal(r.pass, false)
    assert.ok(r.violations.length >= 3)
    const types = r.violations.map(v => v.type)
    assert.ok(types.includes('SCRIPT'))
    assert.ok(types.includes('SCENE_IMAGE'))
    assert.ok(types.includes('MUSIC'))
  })
})
