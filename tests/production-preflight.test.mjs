import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import path from 'node:path'
import os from 'node:os'
import { fileURLToPath } from 'node:url'
import fs from 'node:fs'

import { AudioPreflight } from '../src/preflight/AudioPreflight.mjs'
import { SceneAssetPreflight } from '../src/preflight/SceneAssetPreflight.mjs'
import { AssetRegistry } from '../src/uniqueness/AssetRegistry.mjs'
import { ProductionUniquenessManifest } from '../src/uniqueness/ProductionUniquenessManifest.mjs'
import { UniquenessPreflight } from '../src/uniqueness/UniquenessPreflight.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const FIXTURES = path.join(__dirname, 'fixtures')
const TEST_VIDEO = path.join(FIXTURES, 'test-video.mp4')
const TEST_IMG_16x9 = path.join(FIXTURES, 'test-image-16x9.png')
const TEST_IMG_9x16 = path.join(FIXTURES, 'test-image-9x16.png')

describe('AudioPreflight', () => {
  it('passes for a valid video with audio + narration context', async () => {
    const r = await AudioPreflight.validate(TEST_VIDEO, {
      musicTrack: 'epic-trailer-001',
      narrationScript: 'This is a test narration about technology.',
    })
    assert.equal(r.pass, true, `errors: ${r.errors.join(', ')}`)
    assert.ok(r.checks.length >= 4)
    for (const c of r.checks) {
      assert.equal(c.pass, true, `${c.name} failed: ${c.detail}`)
    }
  })

  it('fails when video is missing', async () => {
    const r = await AudioPreflight.validate('/nonexistent/video.mp4', {})
    assert.equal(r.pass, false)
    assert.ok(r.errors.includes('VIDEO_MISSING'))
  })

  it('fails when musicTrack is not provided', async () => {
    const r = await AudioPreflight.validate(TEST_VIDEO, {
      narrationScript: 'Test narration',
    })
    // Should fail on music_selected check
    const musicCheck = r.checks.find(c => c.name === 'music_selected')
    assert.equal(musicCheck.pass, false)
    assert.ok(r.errors.includes('NO_MUSIC_TRACK_SELECTED'))
  })

  it('fails when narrationScript is not provided', async () => {
    const r = await AudioPreflight.validate(TEST_VIDEO, {
      musicTrack: 'epic-trailer-001',
    })
    const narrationCheck = r.checks.find(c => c.name === 'narration_script')
    assert.equal(narrationCheck.pass, false)
    assert.ok(r.errors.includes('NO_NARRATION_SCRIPT'))
  })

  it('reports audio stream check', async () => {
    const r = await AudioPreflight.validate(TEST_VIDEO, {
      musicTrack: 't1', narrationScript: 'test',
    })
    const audioCheck = r.checks.find(c => c.name === 'audio_stream')
    assert.ok(audioCheck)
    assert.equal(audioCheck.pass, true)
  })
})

describe('SceneAssetPreflight', () => {
  it('passes for valid 16:9 images', () => {
    const scenes = [
      { sceneIndex: 0, imagePath: TEST_IMG_16x9, imageHash: 'hash1' },
    ]
    const r = SceneAssetPreflight.validate(scenes)
    assert.equal(r.pass, true, `errors: ${r.errors.join(', ')}`)
  })

  it('passes for valid 9:16 images', () => {
    const scenes = [
      { sceneIndex: 0, imagePath: TEST_IMG_9x16, imageHash: 'hash1' },
    ]
    const r = SceneAssetPreflight.validate(scenes)
    assert.equal(r.pass, true, `errors: ${r.errors.join(', ')}`)
  })

  it('fails when image file is missing', () => {
    const scenes = [
      { sceneIndex: 0, imagePath: '/nonexistent/image.png', imageHash: 'hash1' },
    ]
    const r = SceneAssetPreflight.validate(scenes)
    assert.equal(r.pass, false)
    assert.ok(r.errors.some(e => e.includes('NO_IMAGE')))
  })

  it('reports scene count', () => {
    const scenes = [
      { sceneIndex: 0, imagePath: TEST_IMG_16x9 },
      { sceneIndex: 1, imagePath: TEST_IMG_9x16 },
    ]
    const r = SceneAssetPreflight.validate(scenes)
    const countCheck = r.checks.find(c => c.name === 'scene_count')
    assert.equal(countCheck.detail, '2 scenes')
  })

  it('passes for empty scenes (audio-only)', () => {
    const r = SceneAssetPreflight.validate([])
    assert.equal(r.pass, true)
  })

  it('detects resolution of 16:9 image', () => {
    const scenes = [{ sceneIndex: 0, imagePath: TEST_IMG_16x9 }]
    const r = SceneAssetPreflight.validate(scenes)
    const resCheck = r.checks.find(c => c.name === 'scene_0_resolution')
    assert.ok(resCheck)
    assert.ok(resCheck.detail.includes('1920x1080'))
  })

  it('detects resolution of 9:16 image', () => {
    const scenes = [{ sceneIndex: 0, imagePath: TEST_IMG_9x16 }]
    const r = SceneAssetPreflight.validate(scenes)
    const resCheck = r.checks.find(c => c.name === 'scene_0_resolution')
    assert.ok(resCheck)
    assert.ok(resCheck.detail.includes('1080x1920'))
  })

  it('_classifyAspect works for standard ratios', () => {
    assert.equal(SceneAssetPreflight._classifyAspect(1920, 1080), '16:9')
    assert.equal(SceneAssetPreflight._classifyAspect(1080, 1920), '9:16')
    assert.equal(SceneAssetPreflight._classifyAspect(1000, 1000), '1:1')
    assert.equal(SceneAssetPreflight._classifyAspect(0, 0), 'unknown')
  })
})

describe('RESERVE/COMMIT/RELEASE lifecycle', () => {
  let tmpDir, reg

  it('reserve blocks other jobs from same assets', () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lifecycle-'))
    reg = new AssetRegistry({ filePath: path.join(tmpDir, 'reg.json') })

    const manifest = { scriptHash: 'script-1', imageHashes: ['img-1'], musicTrackId: 'music-1' }
    const r1 = reg.reserve('job-A', manifest)
    assert.equal(r1.reserved, true)

    // Job B tries to reserve same assets — should fail
    const r2 = reg.reserve('job-B', manifest)
    assert.equal(r2.reserved, false)
    assert.ok(r2.conflict)

    // Job A can reserve different assets
    const r3 = reg.reserve('job-B', { scriptHash: 'script-2', imageHashes: ['img-2'], musicTrackId: 'music-2' })
    assert.equal(r3.reserved, true)

    // Cleanup
    reg.release('job-A')
    reg.release('job-B')
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  it('commit moves reservation to permanent index', () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lifecycle-'))
    reg = new AssetRegistry({ filePath: path.join(tmpDir, 'reg.json') })

    reg.reserve('job-A', { scriptHash: 's1', imageHashes: ['i1'], musicTrackId: 'm1' })
    assert.ok(reg.state.reservations['job-A'])

    reg.commit('job-A', { videoId: 'vid-1' })
    assert.equal(reg.state.reservations['job-A'], undefined)
    assert.ok(reg.state.scripts['s1'])
    assert.ok(reg.state.images['i1'])
    assert.ok(reg.state.music['m1'])
    assert.equal(reg.state.publishedVideos.length, 1)
    assert.equal(reg.state.publishedVideos[0].videoId, 'vid-1')

    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  it('release frees assets for retry', () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lifecycle-'))
    reg = new AssetRegistry({ filePath: path.join(tmpDir, 'reg.json') })

    reg.reserve('job-A', { scriptHash: 's1' })
    assert.ok(reg.state.reservations['job-A'])

    reg.release('job-A')
    assert.equal(reg.state.reservations['job-A'], undefined)

    // Job B can now reserve same assets
    const r = reg.reserve('job-B', { scriptHash: 's1' })
    assert.equal(r.reserved, true)

    reg.release('job-B')
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  it('isScriptDuplicate excludes own reservation', () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lifecycle-'))
    reg = new AssetRegistry({ filePath: path.join(tmpDir, 'reg.json') })

    reg.reserve('job-A', { scriptHash: 's1' })
    // Job A's own reservation should NOT block it
    assert.equal(reg.isScriptDuplicate('s1', 'job-A'), false)
    // But it SHOULD block other jobs
    assert.equal(reg.isScriptDuplicate('s1', 'job-B'), true)

    reg.release('job-A')
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  it('listReservations returns all active', () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lifecycle-'))
    reg = new AssetRegistry({ filePath: path.join(tmpDir, 'reg.json') })

    reg.reserve('job-A', { scriptHash: 's1' })
    reg.reserve('job-B', { scriptHash: 's2' })

    const list = reg.listReservations()
    assert.equal(Object.keys(list).length, 2)
    assert.ok(list['job-A'])
    assert.ok(list['job-B'])

    reg.release('job-A')
    reg.release('job-B')
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })
})

describe('RESERVE/COMMIT/RELEASE via UniquenessPreflight', () => {
  let tmpDir, reg, preflight

  it('validate → reserve → commit lifecycle', () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'preflight-lifecycle-'))
    reg = new AssetRegistry({ filePath: path.join(tmpDir, 'reg.json') })
    preflight = new UniquenessPreflight(reg)

    const manifest = new ProductionUniquenessManifest()
      .setArticle({ title: 'Test article', category: 'AI' })
      .setScript('Unique narration text about AI')
      .addScene(0, { imageHash: 'img-unique' })
      .setMusic('music-unique', { family: 'ambient' })
      .setJobId('job-lifecycle')
      .build()

    // Validate — should pass
    const v = preflight.validate(manifest, { jobId: 'job-lifecycle' })
    assert.equal(v.pass, true)

    // Reserve
    const res = preflight.reserve(manifest, { jobId: 'job-lifecycle' })
    assert.equal(res.reserved, true)

    // Same manifest from another job — should fail (reserved)
    const manifest2 = new ProductionUniquenessManifest()
      .setArticle({ title: 'Test article 2', category: 'AI' })
      .setScript('Unique narration text about AI')
      .addScene(0, { imageHash: 'img-unique' })
      .setMusic('music-unique', { family: 'ambient' })
      .setJobId('job-other')
      .build()

    const v2 = preflight.validate(manifest2, { jobId: 'job-other' })
    assert.equal(v2.pass, false)
    assert.ok(v2.violations.length > 0)

    // Commit
    preflight.commit('job-lifecycle', { videoId: 'vid-123' })
    assert.equal(reg.state.reservations['job-lifecycle'], undefined)
    assert.equal(reg.state.publishedVideos.length, 1)

    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  it('release allows retry', () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'preflight-release-'))
    reg = new AssetRegistry({ filePath: path.join(tmpDir, 'reg.json') })
    preflight = new UniquenessPreflight(reg)

    const manifest = new ProductionUniquenessManifest()
      .setArticle({ title: 'Test', category: 'AI' })
      .setScript('Test narration')
      .setJobId('job-retry')
      .build()

    preflight.reserve(manifest, { jobId: 'job-retry' })

    // Release
    preflight.release('job-retry')

    // Re-reserve should work
    const res = preflight.reserve(manifest, { jobId: 'job-retry' })
    assert.equal(res.reserved, true)

    preflight.release('job-retry')
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })
})
