import assert from 'node:assert/strict'
import { describe, it, before, after } from 'node:test'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const THUMB_DIR = path.join(__dirname, '..', '.test-thumbnails')

describe('ThumbnailFactory', () => {
  before(() => { fs.mkdirSync(THUMB_DIR, { recursive: true }) })
  after(() => { fs.rmSync(THUMB_DIR, { recursive: true, force: true }) })

  describe('ThumbnailPolicy', () => {
    it('validates a 16:9 PNG buffer', async () => {
      const { ThumbnailPolicy } = await import('../src/thumbnail/ThumbnailPolicy.mjs')
      // Create a minimal 1280x720 PNG
      const buf = createPngBuffer(1280, 720)
      const result = ThumbnailPolicy.validate(buf, 'youtube')
      assert.equal(result.valid, true)
      assert.equal(result.meta.width, 1280)
      assert.equal(result.meta.height, 720)
    })

    it('rejects non-16:9 buffer', async () => {
      const { ThumbnailPolicy } = await import('../src/thumbnail/ThumbnailPolicy.mjs')
      const buf = createPngBuffer(1080, 1920)
      const result = ThumbnailPolicy.validate(buf, 'youtube')
      assert.equal(result.valid, false)
      assert.ok(result.errors.some(e => e.includes('aspect ratio')))
    })

    it('rejects too-small buffer', async () => {
      const { ThumbnailPolicy } = await import('../src/thumbnail/ThumbnailPolicy.mjs')
      const buf = createPngBuffer(100, 100)
      const result = ThumbnailPolicy.validate(buf, 'youtube')
      assert.equal(result.valid, false)
      assert.ok(result.errors.some(e => e.includes('resolution')))
    })

    it('rejects non-PNG buffer', async () => {
      const { ThumbnailPolicy } = await import('../src/thumbnail/ThumbnailPolicy.mjs')
      const buf = Buffer.from([0xFF, 0xD8, 0xFF, 0xE0, ...new Array(20).fill(0)])
      const result = ThumbnailPolicy.validate(buf, 'youtube')
      assert.equal(result.valid, false)
    })

    it('isYouTubeCompatible returns true for valid 16:9', async () => {
      const { ThumbnailPolicy } = await import('../src/thumbnail/ThumbnailPolicy.mjs')
      assert.equal(ThumbnailPolicy.isYouTubeCompatible(createPngBuffer(1280, 720)), true)
    })
  })

  describe('ThumbnailCandidateGenerator', () => {
    it('generates 5 candidates from an article', async () => {
      const { ThumbnailCandidateGenerator } = await import('../src/thumbnail/ThumbnailCandidateGenerator.mjs')
      const gen = new ThumbnailCandidateGenerator()
      const candidates = gen.generate({ title: 'Tesla Reports Record Q3 Revenue of $25B', category: 'tesla' })
      assert.equal(candidates.length, 5)
      assert.ok(candidates.every(c => c.id && c.strategy && c.headline))
    })

    it('extracts hook words from title', async () => {
      const { ThumbnailCandidateGenerator } = await import('../src/thumbnail/ThumbnailCandidateGenerator.mjs')
      const gen = new ThumbnailCandidateGenerator()
      const candidates = gen.generate({ title: 'Apple Launches iPhone 17 With AI Features', category: 'apple' })
      const hooks = candidates.map(c => c.hook)
      assert.ok(hooks.some(h => h.includes('IPHONE') || h.includes('17') || h.includes('APPLE')))
    })

    it('includes different strategies', async () => {
      const { ThumbnailCandidateGenerator } = await import('../src/thumbnail/ThumbnailCandidateGenerator.mjs')
      const gen = new ThumbnailCandidateGenerator()
      const candidates = gen.generate({ title: 'Test Article', category: 'tech' })
      const strategies = new Set(candidates.map(c => c.strategy))
      assert.ok(strategies.size >= 3, 'should have diverse strategies')
    })
  })

  describe('ThumbnailJudge', () => {
    it('judges rendered candidates and picks winner', async () => {
      const { ThumbnailJudge } = await import('../src/thumbnail/ThumbnailJudge.mjs')
      // Create fake rendered candidates with valid PNGs
      const candidates = [
        { id: 'a', strategy: 'hero-hook', hook: 'TESLA', rendered: true, path: writeTestPng(THUMB_DIR, 'a.png', 1280, 720) },
        { id: 'b', strategy: 'breaking', hook: 'BREAKING', rendered: true, path: writeTestPng(THUMB_DIR, 'b.png', 1280, 720) },
        { id: 'c', strategy: 'data', hook: '25B', rendered: true, path: writeTestPng(THUMB_DIR, 'c.png', 1280, 720) },
      ]
      const judge = new ThumbnailJudge()
      const result = judge.judge(candidates)
      assert.equal(result.winner !== null, true)
      assert.equal(result.eligibleCount, 3)
      assert.ok(result.winner.compositeScore > 0)
    })

    it('excludes non-rendered candidates', async () => {
      const { ThumbnailJudge } = await import('../src/thumbnail/ThumbnailJudge.mjs')
      const candidates = [
        { id: 'a', strategy: 'hero-hook', hook: 'TEST', rendered: false, path: null },
      ]
      const judge = new ThumbnailJudge()
      const result = judge.judge(candidates)
      assert.equal(result.winner, null)
      assert.equal(result.eligibleCount, 0)
    })

    it('excludes candidates with wrong aspect ratio', async () => {
      const { ThumbnailJudge } = await import('../src/thumbnail/ThumbnailJudge.mjs')
      const candidates = [
        { id: 'a', strategy: 'hero-hook', hook: 'TEST', rendered: true, path: writeTestPng(THUMB_DIR, 'bad.png', 1080, 1920) },
      ]
      const judge = new ThumbnailJudge()
      const result = judge.judge(candidates)
      assert.equal(result.winner, null)
    })
  })

  describe('ThumbnailManifest', () => {
    it('records candidates and selection', async () => {
      const { ThumbnailManifest } = await import('../src/thumbnail/ThumbnailManifest.mjs')
      const m = new ThumbnailManifest('test-001')
      m.setCandidates([
        { id: 'a', strategy: 'hero-hook', compositeScore: 85, eligible: true },
        { id: 'b', strategy: 'breaking', compositeScore: 72, eligible: true },
      ])
      m.setSelected({ path: '/tmp/thumb.png', strategy: 'hero-hook', compositeScore: 85, policy: { meta: { width: 1280, height: 720 } } })
      m.finish()
      const json = m.toJSON()
      assert.equal(json.candidates.length, 2)
      assert.equal(json.selected.strategy, 'hero-hook')
      assert.equal(json.status, 'completed')
    })

    it('saves manifest to disk', async () => {
      const { ThumbnailManifest } = await import('../src/thumbnail/ThumbnailManifest.mjs')
      const m = new ThumbnailManifest('test-002')
      m.setSelected({ path: '/tmp/thumb.png', strategy: 'minimal', compositeScore: 80, policy: { meta: { width: 1280, height: 720 } } })
      m.finish()
      const outPath = m.save(THUMB_DIR)
      assert.ok(fs.existsSync(outPath))
      const content = JSON.parse(fs.readFileSync(outPath, 'utf8'))
      assert.equal(content.productionId, 'test-002')
    })
  })

  describe('ThumbnailFactory', () => {
    it('produces a complete result with selected, candidates, strategy', async () => {
      const { ThumbnailFactory } = await import('../src/thumbnail/ThumbnailFactory.mjs')
      const factory = new ThumbnailFactory({ outputDir: THUMB_DIR })
      const result = await factory.produce({
        article: { title: 'AI Transforms Healthcare Industry', category: 'ai' },
        title: 'AI Transforms Healthcare Industry',
        category: 'ai',
      })
      assert.ok(result.selected)
      assert.ok(result.selected.path)
      assert.ok(result.selected.width > 0)
      assert.ok(result.selected.height > 0)
      assert.equal(result.selected.aspectRatio, '16:9')
      assert.ok(result.candidates.length >= 3)
      assert.ok(result.strategy)
      assert.ok(result.manifest)
    })

    it('selected thumbnail is a valid 16:9 PNG on disk', async () => {
      const { ThumbnailFactory } = await import('../src/thumbnail/ThumbnailFactory.mjs')
      const factory = new ThumbnailFactory({ outputDir: THUMB_DIR })
      const result = await factory.produce({
        article: { title: 'Samsung Unveils New Galaxy Phone', category: 'samsung' },
      })
      assert.ok(fs.existsSync(result.selected.path))
      const buf = fs.readFileSync(result.selected.path)
      assert.equal(buf[0], 0x89) // PNG magic
      assert.equal(buf[1], 0x50)
    })

    it('manifest records all candidates', async () => {
      const { ThumbnailFactory } = await import('../src/thumbnail/ThumbnailFactory.mjs')
      const factory = new ThumbnailFactory({ outputDir: THUMB_DIR })
      const result = await factory.produce({
        article: { title: 'Crypto Markets Surge 15%', category: 'crypto' },
      })
      assert.ok(result.manifest.candidates.length >= 3)
      assert.ok(result.manifest.selected)
      assert.ok(['completed', 'completed_fallback'].includes(result.manifest.status))
    })
  })

  describe('ThumbnailVerifier', () => {
    it('returns error when videoId missing', async () => {
      const { ThumbnailVerifier } = await import('../src/thumbnail/ThumbnailVerifier.mjs')
      const v = new ThumbnailVerifier()
      const result = await v.verify(null, 'token')
      assert.equal(result.valid, false)
      assert.ok(result.error.includes('required'))
    })

    it('returns error when token missing', async () => {
      const { ThumbnailVerifier } = await import('../src/thumbnail/ThumbnailVerifier.mjs')
      const v = new ThumbnailVerifier()
      const result = await v.verify('abc123', null)
      assert.equal(result.valid, false)
    })
  })
})

function createPngBuffer(width, height) {
  // Minimal valid PNG: 8-byte signature + IHDR + IDAT + IEND, padded to >= 5KB
  const signature = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A])
  const ihdr = Buffer.alloc(25)
  ihdr.writeUInt32BE(13, 0)
  ihdr.write('IHDR', 4)
  ihdr.writeUInt32BE(width, 8)
  ihdr.writeUInt32BE(height, 12)
  ihdr[16] = 8
  ihdr[17] = 2
  // IDAT with enough data to exceed 5KB minimum
  const idatData = Buffer.alloc(6000, 0x80)
  const idat = Buffer.alloc(12 + idatData.length)
  idat.writeUInt32BE(idatData.length, 0)
  idat.write('IDAT', 4)
  idatData.copy(idat, 8)
  const iend = Buffer.alloc(12)
  iend.writeUInt32BE(0, 0)
  iend.write('IEND', 4)
  return Buffer.concat([signature, ihdr, idat, iend])
}

function writeTestPng(dir, name, width, height) {
  const p = path.join(dir, name)
  fs.writeFileSync(p, createPngBuffer(width, height))
  return p
}
