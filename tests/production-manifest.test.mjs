import assert from 'node:assert/strict'
import { describe, it, beforeEach, afterEach } from 'node:test'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { ProductionManifest } from '../src/experiment/ProductionManifest.mjs'

describe('ProductionManifest', () => {
  let tmpDir

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'manifest-test-'))
  })

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  describe('create', () => {
    it('creates a complete frozen manifest', () => {
      const pm = new ProductionManifest({ outDir: tmpDir })
      const manifest = pm.create({
        article: { title: 'Test Article', description: 'desc', category: 'AI' },
        niche: { key: 'AI', source: 'heuristic', confidence: 0.85 },
        plan: {
          hookStrategy: { style: 'reveal', source: 'ai_optimized' },
          sceneStrategy: { sceneCount: 6 },
        },
        decisionTrace: {
          aiCalled: true,
          aiProvider: 'Gemini',
          aiLatencyMs: 200,
          recommendationsReceived: 2,
          recommendationsAccepted: 1,
        },
        experimentId: 'EXP-001',
        variant: 'treatment',
      })

      assert.equal(manifest.schemaVersion, 1)
      assert.ok(manifest.artifactId.startsWith('vid-'))
      assert.equal(manifest.article.title, 'Test Article')
      assert.equal(manifest.niche.key, 'AI')
      assert.equal(manifest.productionPlan.hookStrategy.style, 'reveal')
      assert.equal(manifest.strategyTrace.aiCalled, true)
      assert.equal(manifest.strategyTrace.aiProvider, 'Gemini')
      assert.equal(manifest.experiment.experimentId, 'EXP-001')
      assert.equal(manifest.experiment.variant, 'treatment')
    })

    it('manifest is deeply frozen', () => {
      const pm = new ProductionManifest({ outDir: tmpDir })
      const manifest = pm.create({
        article: { title: 'Test' },
        niche: { key: 'GENERAL' },
      })
      assert.throws(() => { manifest.article.title = 'changed' }, /Cannot assign/)
      assert.throws(() => { manifest.niche.key = 'changed' }, /Cannot assign/)
      assert.throws(() => { manifest.stages.render.status = 'changed' }, /Cannot assign/)
    })

    it('generates deterministic artifactId from title', () => {
      const pm = new ProductionManifest({ outDir: tmpDir })
      const m1 = pm.create({ article: { title: 'Same Title' }, niche: { key: 'AI' } })
      const m2 = pm.create({ article: { title: 'Same Title' }, niche: { key: 'AI' } })
      assert.equal(m1.artifactId, m2.artifactId)
    })

    it('different titles produce different artifactIds', () => {
      const pm = new ProductionManifest({ outDir: tmpDir })
      const m1 = pm.create({ article: { title: 'Title A' }, niche: { key: 'AI' } })
      const m2 = pm.create({ article: { title: 'Title B' }, niche: { key: 'AI' } })
      assert.notEqual(m1.artifactId, m2.artifactId)
    })

    it('records all stage data', () => {
      const pm = new ProductionManifest({ outDir: tmpDir })
      const manifest = pm.create({
        article: { title: 'Test' },
        niche: { key: 'AI' },
        stages: {
          render: { status: 'completed', durationMs: 45000, sceneCount: 6 },
          thumbnail: { status: 'completed', layout: 'bold', candidatesGenerated: 4 },
          upload: { status: 'completed', provider: 'youtube', videoId: 'yt-123' },
          c2pa: { status: 'completed', signed: true },
        },
      })
      assert.equal(manifest.stages.render.status, 'completed')
      assert.equal(manifest.stages.render.sceneCount, 6)
      assert.equal(manifest.stages.thumbnail.layout, 'bold')
      assert.equal(manifest.stages.upload.videoId, 'yt-123')
      assert.equal(manifest.stages.c2pa.signed, true)
    })
  })

  describe('write / read', () => {
    it('persists and retrieves manifest', () => {
      const pm = new ProductionManifest({ outDir: tmpDir })
      const manifest = pm.create({
        article: { title: 'Persist Test', category: 'AI' },
        niche: { key: 'AI' },
        plan: { hookStrategy: { style: 'reveal' } },
      })

      const filePath = pm.write(manifest)
      assert.ok(fs.existsSync(filePath))
      assert.ok(filePath.endsWith(`${manifest.artifactId}.json`))

      const loaded = pm.read(manifest.artifactId)
      assert.equal(loaded.artifactId, manifest.artifactId)
      assert.equal(loaded.article.title, 'Persist Test')
      assert.equal(loaded.productionPlan.hookStrategy.style, 'reveal')
    })

    it('read returns null for unknown artifact', () => {
      const pm = new ProductionManifest({ outDir: tmpDir })
      assert.equal(pm.read('nonexistent'), null)
    })

    it('list returns all artifact IDs', () => {
      const pm = new ProductionManifest({ outDir: tmpDir })
      const m1 = pm.create({ article: { title: 'A' }, niche: { key: 'AI' } })
      const m2 = pm.create({ article: { title: 'B' }, niche: { key: 'APPLE' } })
      pm.write(m1)
      pm.write(m2)

      const list = pm.list()
      assert.equal(list.length, 2)
      assert.ok(list.includes(m1.artifactId))
      assert.ok(list.includes(m2.artifactId))
    })
  })

  describe('generateArtifactId', () => {
    it('produces vid- prefix with hash', () => {
      const id = ProductionManifest.generateArtifactId({ title: 'Test' })
      assert.ok(id.startsWith('vid-'))
      assert.ok(id.length > 10)
    })

    it('handles null article', () => {
      const id = ProductionManifest.generateArtifactId(null)
      assert.ok(id.startsWith('vid-'))
    })
  })
})
