import { describe, it, before, after, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { createCanvas } from '@napi-rs/canvas'

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeTestPng(dir, name = 'test.png', w = 1280, h = 720) {
  const p = path.join(dir, name)
  const canvas = createCanvas(w, h)
  const ctx = canvas.getContext('2d')
  ctx.fillStyle = '#E82127'
  ctx.fillRect(0, 0, w, h)
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(p, canvas.toBuffer('image/png'))
  return p
}

// ─── ContentCredentials ──────────────────────────────────────────────────────

describe('ContentCredentials', () => {
  let tmpDir
  let inputPng

  before(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'c2pa-test-'))
    inputPng = makeTestPng(tmpDir)
  })

  after(() => {
    try { fs.rmSync(tmpDir, { recursive: true, force: true }) } catch {}
  })

  it('isAvailable returns true when @contentauth/c2pa-node is installed', async () => {
    const { ContentCredentials } = await import('../src/pipeline/ContentCredentials.mjs')
    const available = await ContentCredentials.isAvailable()
    assert.equal(typeof available, 'boolean')
    // Should be true since we installed the package
    assert.equal(available, true)
  })

  it('sign() produces a C2PA-signed PNG', async () => {
    const { ContentCredentials } = await import('../src/pipeline/ContentCredentials.mjs')
    const outputPath = path.join(tmpDir, 'signed.png')
    const result = await ContentCredentials.sign({
      input: inputPng,
      output: outputPath,
      article: { headline: 'Test headline' },
      productionContext: { niche: { key: 'TESLA' }, articleId: 'test-001' },
    })
    assert.equal(result.signed, true)
    assert.equal(result.path, outputPath)
    assert.ok(result.manifestId)
    assert.ok(result.size > 0)
    assert.ok(fs.existsSync(outputPath))
    // Signed file should be larger than input (JUMBF embedded)
    const inputSize = fs.statSync(inputPng).size
    const outputSize = fs.statSync(outputPath).size
    assert.ok(outputSize > inputSize, `signed (${outputSize}) should be larger than input (${inputSize})`)
  })

  it('sign() returns signed:false when C2PA_ENABLED=false', async () => {
    process.env.C2PA_ENABLED = 'false'
    try {
      const { ContentCredentials } = await import('../src/pipeline/ContentCredentials.mjs')
      const result = await ContentCredentials.sign({ input: inputPng })
      assert.equal(result.signed, false)
      assert.equal(result.reason, 'C2PA_DISABLED')
    } finally {
      delete process.env.C2PA_ENABLED
    }
  })

  it('sign() throws when input path is missing', async () => {
    const { ContentCredentials } = await import('../src/pipeline/ContentCredentials.mjs')
    await assert.rejects(() => ContentCredentials.sign({}), /input path required/)
  })

  it('sign() throws when input file does not exist', async () => {
    const { ContentCredentials } = await import('../src/pipeline/ContentCredentials.mjs')
    await assert.rejects(
      () => ContentCredentials.sign({ input: '/nonexistent/file.png' }),
      /file not found/
    )
  })

  it('verify() validates a C2PA-signed asset', async () => {
    const { ContentCredentials } = await import('../src/pipeline/ContentCredentials.mjs')
    const outputPath = path.join(tmpDir, 'verify-test.png')
    await ContentCredentials.sign({
      input: inputPng,
      output: outputPath,
      article: { headline: 'Verify test' },
      productionContext: { niche: { key: 'AI' }, articleId: 'v-001' },
    })
    const verifyResult = await ContentCredentials.verify(outputPath)
    assert.equal(verifyResult.valid, true)
    assert.ok(verifyResult.manifest)
    assert.equal(verifyResult.manifest.validationState, 'Valid')
    assert.ok(verifyResult.manifest.actions.length > 0)
    assert.equal(verifyResult.manifest.actions[0].action, 'c2pa.created')
    assert.equal(verifyResult.error, null)
  })

  it('verify() returns invalid for unsigned file', async () => {
    const { ContentCredentials } = await import('../src/pipeline/ContentCredentials.mjs')
    const verifyResult = await ContentCredentials.verify(inputPng)
    assert.equal(verifyResult.valid, false)
    assert.ok(verifyResult.error)
  })

  it('verify() returns invalid for nonexistent file', async () => {
    const { ContentCredentials } = await import('../src/pipeline/ContentCredentials.mjs')
    const verifyResult = await ContentCredentials.verify('/nonexistent/file.png')
    assert.equal(verifyResult.valid, false)
    assert.equal(verifyResult.error, 'file not found')
  })

  it('inspect() detects C2PA manifest presence', async () => {
    const { ContentCredentials } = await import('../src/pipeline/ContentCredentials.mjs')
    const outputPath = path.join(tmpDir, 'inspect-test.png')
    await ContentCredentials.sign({
      input: inputPng,
      output: outputPath,
    })
    const inspectResult = await ContentCredentials.inspect(outputPath)
    assert.equal(inspectResult.hasManifest, true)
    assert.ok(inspectResult.activeLabel)
  })

  it('inspect() returns hasManifest:false for unsigned file', async () => {
    const { ContentCredentials } = await import('../src/pipeline/ContentCredentials.mjs')
    const inspectResult = await ContentCredentials.inspect(inputPng)
    assert.equal(inspectResult.hasManifest, false)
  })

  it('sign+verify roundtrip preserves digitalSourceType', async () => {
    const { ContentCredentials } = await import('../src/pipeline/ContentCredentials.mjs')
    const outputPath = path.join(tmpDir, 'roundtrip.png')
    await ContentCredentials.sign({ input: inputPng, output: outputPath })
    const { manifest } = await ContentCredentials.verify(outputPath)
    const action = manifest.actions.find(a => a.action === 'c2pa.created')
    assert.ok(action)
    assert.ok(action.digitalSourceType.includes('compositeWithTrainedAlgorithmicMedia'))
    assert.ok(action.softwareAgent.includes('video-gen-stack'))
  })
})

// ─── ThumbnailPreflight C2PA gate ───────────────────────────────────────────

describe('ThumbnailPreflight.validateC2PA', () => {
  let tmpDir
  let signedPng

  before(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'preflight-c2pa-'))
    const inputPng = makeTestPng(tmpDir)
    const { ContentCredentials } = await import('../src/pipeline/ContentCredentials.mjs')
    const result = await ContentCredentials.sign({
      input: inputPng,
      output: path.join(tmpDir, 'signed.png'),
    })
    signedPng = result.path
  })

  after(() => {
    try { fs.rmSync(tmpDir, { recursive: true, force: true }) } catch {}
  })

  it('passes through when C2PA_REQUIRED is not set', async () => {
    const { ThumbnailPreflight } = await import('../src/pipeline/ThumbnailPreflight.mjs')
    delete process.env.C2PA_REQUIRED
    const result = await ThumbnailPreflight.validateC2PA({ path: signedPng })
    assert.equal(result.ready, true)
    assert.deepEqual(result.errors, [])
  })

  it('validates C2PA when C2PA_REQUIRED=true and asset is signed', async () => {
    const { ThumbnailPreflight } = await import('../src/pipeline/ThumbnailPreflight.mjs')
    process.env.C2PA_REQUIRED = 'true'
    try {
      const result = await ThumbnailPreflight.validateC2PA({ path: signedPng })
      assert.equal(result.ready, true)
      assert.ok(result.c2paResult)
      assert.equal(result.c2paResult.valid, true)
    } finally {
      delete process.env.C2PA_REQUIRED
    }
  })

  it('fails when C2PA_REQUIRED=true and asset is unsigned', async () => {
    const { ThumbnailPreflight } = await import('../src/pipeline/ThumbnailPreflight.mjs')
    process.env.C2PA_REQUIRED = 'true'
    try {
      const unsignedPng = path.join(tmpDir, 'unsigned.png')
      fs.copyFileSync(path.join(tmpDir, 'test.png'), unsignedPng)
      const result = await ThumbnailPreflight.validateC2PA({ path: unsignedPng })
      assert.equal(result.ready, false)
      assert.ok(result.errors.length > 0)
      assert.ok(result.errors[0].includes('C2PA verification failed'))
    } finally {
      delete process.env.C2PA_REQUIRED
    }
  })

  it('fails when C2PA_REQUIRED=true and no path provided', async () => {
    const { ThumbnailPreflight } = await import('../src/pipeline/ThumbnailPreflight.mjs')
    process.env.C2PA_REQUIRED = 'true'
    try {
      const result = await ThumbnailPreflight.validateC2PA({})
      assert.equal(result.ready, false)
      assert.ok(result.errors[0].includes('path not provided'))
    } finally {
      delete process.env.C2PA_REQUIRED
    }
  })
})

// ─── ProductionTrace provenance ──────────────────────────────────────────────

describe('ProductionTrace.provenance', () => {
  it('has provenance field with defaults', async () => {
    const { ProductionTrace } = await import('../src/pipeline/ProductionTrace.mjs')
    const trace = new ProductionTrace('test-article')
    const json = trace.toJSON()
    assert.ok(json.provenance)
    assert.equal(json.provenance.c2paSigned, false)
    assert.equal(json.provenance.c2paVerified, false)
    assert.equal(json.provenance.manifestId, null)
    assert.equal(json.provenance.error, null)
  })

  it('setProvenance records C2PA state', async () => {
    const { ProductionTrace } = await import('../src/pipeline/ProductionTrace.mjs')
    const trace = new ProductionTrace('test-article')
    trace.setProvenance({
      signed: true,
      verified: true,
      manifestId: 'c2pa:123',
      error: null,
    })
    const json = trace.toJSON()
    assert.equal(json.provenance.c2paSigned, true)
    assert.equal(json.provenance.c2paVerified, true)
    assert.equal(json.provenance.manifestId, 'c2pa:123')
    assert.equal(json.provenance.error, null)
  })

  it('setProvenance records error state', async () => {
    const { ProductionTrace } = await import('../src/pipeline/ProductionTrace.mjs')
    const trace = new ProductionTrace('test-article')
    trace.setProvenance({
      signed: false,
      verified: false,
      error: 'signing failed',
    })
    const json = trace.toJSON()
    assert.equal(json.provenance.c2paSigned, false)
    assert.equal(json.provenance.error, 'signing failed')
  })
})
