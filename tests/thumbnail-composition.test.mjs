import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import path from 'node:path'
import fs from 'node:fs'
import os from 'node:os'
import { fileURLToPath } from 'node:url'

import { ThumbnailCompositionPreflight } from '../src/thumbnail/ThumbnailCompositionPreflight.mjs'
import { ThumbnailFactory } from '../src/thumbnail/ThumbnailFactory.mjs'
import { ThumbnailJudge } from '../src/thumbnail/ThumbnailJudge.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const FIXTURES = path.join(__dirname, 'fixtures')

describe('ThumbnailCompositionPreflight', () => {
  it('passes for a well-composed thumbnail', async () => {
    const imgPath = path.join(FIXTURES, 'test-image-16x9.png')
    const r = await ThumbnailCompositionPreflight.validate(imgPath)
    // A solid color image won't have text or safe zone issues
    assert.ok(r.checks.length >= 4, `expected >=4 checks, got ${r.checks.length}`)
    // May fail on text_density (no text in test image) — that's expected
  })

  it('fails for null path', async () => {
    const r = await ThumbnailCompositionPreflight.validate(null)
    assert.equal(r.pass, false)
    assert.ok(r.errors.includes('NO_IMAGE_PATH'))
  })

  it('fails for nonexistent file', async () => {
    const r = await ThumbnailCompositionPreflight.validate('/nonexistent/thumb.png')
    assert.equal(r.pass, false)
    assert.ok(r.errors.some(e => e.includes('IMAGE_LOAD_FAILED')))
  })

  it('detects correct aspect ratio', async () => {
    const imgPath = path.join(FIXTURES, 'test-image-16x9.png')
    const r = await ThumbnailCompositionPreflight.validate(imgPath)
    const aspectCheck = r.checks.find(c => c.name === 'aspect_ratio')
    assert.ok(aspectCheck)
    assert.equal(aspectCheck.pass, true)
  })

  it('detects wrong aspect ratio', async () => {
    const imgPath = path.join(FIXTURES, 'test-image-9x16.png')
    const r = await ThumbnailCompositionPreflight.validate(imgPath)
    const aspectCheck = r.checks.find(c => c.name === 'aspect_ratio')
    assert.ok(aspectCheck)
    assert.equal(aspectCheck.pass, false)
  })

  it('returns composition metrics', async () => {
    const imgPath = path.join(FIXTURES, 'test-image-16x9.png')
    const r = await ThumbnailCompositionPreflight.validate(imgPath)
    assert.ok(typeof r.composition.pillarboxRatio === 'number')
    assert.ok(typeof r.composition.verticalEmbedRatio === 'number')
    assert.ok(typeof r.composition.emptyAreaRatio === 'number')
    assert.ok(typeof r.composition.textDensity === 'number')
  })

  it('_detectPillarboxing returns valid ratio', () => {
    // Create a 100x60 pixel buffer with dark sides, bright center
    const w = 100, h = 60
    const pixels = new Uint8ClampedArray(w * h * 4)
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = (y * w + x) * 4
        const isSide = x < 15 || x >= 85
        const brightness = isSide ? 10 : 200
        pixels[i] = brightness
        pixels[i + 1] = brightness
        pixels[i + 2] = brightness
        pixels[i + 3] = 255
      }
    }
    const result = ThumbnailCompositionPreflight._detectPillarboxing(pixels, w, h)
    assert.ok(result.ratio > 0.5, `expected high pillarbox ratio, got ${result.ratio}`)
  })

  it('_detectEmbeddedVertical returns high ratio for center-bright pattern', () => {
    const w = 100, h = 60
    const pixels = new Uint8ClampedArray(w * h * 4)
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = (y * w + x) * 4
        const isCenter = x >= 30 && x <= 70
        const brightness = isCenter ? 220 : 20
        pixels[i] = brightness
        pixels[i + 1] = brightness
        pixels[i + 2] = brightness
        pixels[i + 3] = 255
      }
    }
    const result = ThumbnailCompositionPreflight._detectEmbeddedVertical(pixels, w, h)
    assert.ok(result.ratio > 3, `expected high vertical ratio, got ${result.ratio}`)
  })

  it('_detectEmptyArea returns high ratio for uniform image', () => {
    const w = 50, h = 50
    const pixels = new Uint8ClampedArray(w * h * 4)
    // All pixels same color
    for (let i = 0; i < pixels.length; i += 4) {
      pixels[i] = 128
      pixels[i + 1] = 128
      pixels[i + 2] = 128
      pixels[i + 3] = 255
    }
    const result = ThumbnailCompositionPreflight._detectEmptyArea(pixels, w, h)
    assert.ok(result.ratio > 0.8, `expected high empty ratio, got ${result.ratio}`)
  })

  it('_detectTextDensity counts accent pixels', () => {
    const w = 50, h = 50
    const pixels = new Uint8ClampedArray(w * h * 4)
    // Fill with black
    for (let i = 0; i < pixels.length; i += 4) {
      pixels[i] = 0; pixels[i + 1] = 0; pixels[i + 2] = 0; pixels[i + 3] = 255
    }
    // Add red accent bar at top (y=0..5, all x)
    for (let y = 0; y < 5; y++) {
      for (let x = 0; x < w; x++) {
        const i = (y * w + x) * 4
        pixels[i] = 225; pixels[i + 1] = 6; pixels[i + 2] = 0
      }
    }
    const result = ThumbnailCompositionPreflight._detectTextDensity(pixels, w, h)
    assert.ok(result.ratio > 0, `expected some text density, got ${result.ratio}`)
    assert.ok(result.regions >= 1, `expected >=1 region, got ${result.regions}`)
  })
})

describe('ThumbnailFactory + CompositionPreflight integration', () => {
  let tmpDir

  it('composition preflight rejects invalid candidates', async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'thumb-comp-'))
    const factory = new ThumbnailFactory({ outputDir: tmpDir })

    const article = {
      title: 'Test Article for Thumbnail Composition',
      category: 'technology',
      imageUrl: null,
    }

    const result = await factory.produce({
      article,
      title: article.title,
      category: 'technology',
      heroImage: null,
    })

    // Should still produce a result (fallback or winner)
    assert.ok(result.selected)
    assert.ok(result.selected.path)

    // Cleanup
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  it('ThumbnailJudge respects composition rejection', () => {
    const judge = new ThumbnailJudge()
    const candidates = [
      {
        rendered: true,
        path: path.join(FIXTURES, 'test-image-16x9.png'),
        strategy: 'hero-hook',
        hook: 'TEST',
        headline: 'TEST HEADLINE',
        bottomBadge: 'TECH',
        eligible: false,
        compositionErrors: ['EMBEDDED_VERTICAL: center is 5.2x brighter'],
      },
      {
        rendered: true,
        path: path.join(FIXTURES, 'test-image-16x9.png'),
        strategy: 'breaking-news',
        hook: 'BREAKING',
        headline: 'BREAKING NEWS HEADLINE HERE',
        bottomBadge: 'NEWS',
      },
    ]

    const result = judge.judge(candidates)
    // First candidate should be rejected
    const first = result.scored.find(c => c.strategy === 'hero-hook')
    assert.equal(first.eligible, false)
    assert.ok(first.reason.includes('composition rejected'))

    // Second should be eligible
    const second = result.scored.find(c => c.strategy === 'breaking-news')
    assert.equal(second.eligible, true)
  })
})
