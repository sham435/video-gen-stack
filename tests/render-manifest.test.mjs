import { test } from 'node:test'
import assert from 'node:assert'
import { RenderManifest, resolveRenderManifest, resolveRenderGates } from '../src/pipeline/RenderManifest.mjs'

test('render manifest — canvas is the single text authority by default', () => {
  const m = resolveRenderManifest()
  assert.equal(m.canRender('headline', 'canvas'), true)
  assert.equal(m.canRender('caption', 'canvas'), true)
  assert.equal(m.canRender('emphasis', 'canvas'), true)
  assert.equal(m.canRender('banner', 'canvas'), true)
  assert.equal(m.canRender('footer', 'canvas'), true)
  assert.equal(m.canRender('subtitle', 'ffmpeg'), false)
  assert.equal(m.canRender('subtitle', 'canvas'), false)
  assert.equal(m.canRender('headline', 'ffmpeg'), false)
  assert.equal(m.canRender('unknown-layer', 'canvas'), false)
})

test('render manifest — no FFmpeg burns by default; opt-in enables them', () => {
  assert.deepEqual(resolveRenderGates({}), { burnSubtitles: false, overlayFooter: false })
  assert.deepEqual(resolveRenderGates({ burnSubtitles: true }), { burnSubtitles: true, overlayFooter: false })
})

test('render manifest — footer.png burn only when canvas footer disabled (single owner)', () => {
  const canvasOwned = resolveRenderManifest({})
  assert.deepEqual(resolveRenderGates({ overlayFooter: true }, canvasOwned), { burnSubtitles: false, overlayFooter: false })

  const footerOff = resolveRenderManifest({ footer: false })
  assert.equal(footerOff.canRender('footer', 'canvas'), false)
  assert.deepEqual(resolveRenderGates({ overlayFooter: true, footer: false }, footerOff), { burnSubtitles: false, overlayFooter: true })
})

test('render manifest — ownership is exclusive and validated', () => {
  const m = new RenderManifest({ headline: { owner: 'gpu', enabled: true } })
  assert.equal(m.canRender('headline', 'canvas'), false)
  assert.equal(m.owner('headline'), 'gpu')
  const issues = m.validate()
  assert.ok(issues.some(i => i.includes("headline: unknown owner 'gpu'")))
  assert.deepEqual(resolveRenderManifest({}).validate(), [])
})
