import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { VIDEO_HD, DEFAULT_PROFILE, sx, sy, sf } from '../src/video/RenderProfile.mjs'

describe('RenderProfile (16:9 only)', () => {
  it('VIDEO_HD logical 1280x720 -> output 1920x1080, scale 1.5, 16:9', () => {
    assert.deepEqual(VIDEO_HD.logical, { width: 1280, height: 720 })
    assert.deepEqual(VIDEO_HD.output, { width: 1920, height: 1080 })
    assert.equal(VIDEO_HD.scale, 1.5)
    assert.equal(VIDEO_HD.aspectRatio, '16:9')
    assert.equal(VIDEO_HD.type, 'VIDEO')
    assert.equal(VIDEO_HD.fps, 30)
  })

  it('VIDEO_HD is the default profile', () => {
    assert.equal(DEFAULT_PROFILE, VIDEO_HD)
  })

  it('sx/sy/sf scale logical design values by the 1.5 factor', () => {
    assert.equal(sx(80), 120)
    assert.equal(sy(100), 150)
    assert.equal(sf(72), 108)
    // Explicit profile argument is accepted and equals the default.
    assert.equal(sx(80, VIDEO_HD), 120)
  })

  it('VIDEO_HD is frozen (immutable canonical contract)', () => {
    assert.equal(Object.isFrozen(VIDEO_HD), true)
  })
})
