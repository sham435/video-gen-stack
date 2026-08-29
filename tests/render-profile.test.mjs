import { describe, it, before } from 'node:test'
import assert from 'node:assert/strict'
import { RenderProfiles, resolveRenderProfile, sx, sy, sf } from '../src/video/RenderProfile.mjs'

describe('RenderProfile', () => {
  it('defines SHORT_4K logical 1080x1920 -> output 2160x3840, scale 2', () => {
    const p = RenderProfiles.SHORT_4K
    assert.deepEqual(p.logical, { width: 1080, height: 1920 })
    assert.deepEqual(p.output, { width: 2160, height: 3840 })
    assert.equal(p.scale, 2)
    assert.equal(p.aspectRatio, '9:16')
    assert.equal(p.type, 'SHORT')
  })

  it('defines VIDEO_HD logical 1280x720 -> output 1920x1080, scale 1.5', () => {
    const p = RenderProfiles.VIDEO_HD
    assert.deepEqual(p.logical, { width: 1280, height: 720 })
    assert.deepEqual(p.output, { width: 1920, height: 1080 })
    assert.equal(p.scale, 1.5)
    assert.equal(p.aspectRatio, '16:9')
  })

  it('resolves SHORT_4K for 9:16 / short media', () => {
    assert.equal(resolveRenderProfile({ type: 'short' }).type, 'SHORT')
    assert.equal(resolveRenderProfile({ aspectRatio: '9:16' }).type, 'SHORT')
    assert.equal(resolveRenderProfile({ width: 1080, height: 1920 }).type, 'SHORT')
    assert.equal(resolveRenderProfile({ width: 2160, height: 3840 }).type, 'SHORT')
  })

  it('resolves VIDEO_HD for 16:9 / landscape media', () => {
    assert.equal(resolveRenderProfile({ type: 'video' }).type, 'VIDEO')
    assert.equal(resolveRenderProfile({ aspectRatio: '16:9' }).type, 'VIDEO')
  })

  it('sx/sy/sf scale logical design values by the profile factor', () => {
    const p = RenderProfiles.SHORT_4K
    assert.equal(sx(80, p), 160)
    assert.equal(sy(1450, p), 2900)
    assert.equal(sf(72, p), 144)
  })
})
