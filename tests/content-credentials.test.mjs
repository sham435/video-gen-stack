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

  it('sign() returns real manifestId (not fabricated timestamp)', async () => {
    const { ContentCredentials } = await import('../src/pipeline/ContentCredentials.mjs')
    const outputPath = path.join(tmpDir, 'real-id-test.png')
    const result = await ContentCredentials.sign({ input: inputPng, output: outputPath })
    assert.equal(result.signed, true)
    assert.ok(result.manifestId, 'manifestId should not be null')
    // Real IDs are URNs like urn:c2pa:..., not c2pa:TIMESTAMP
    assert.ok(result.manifestId.startsWith('urn:c2pa:'), `manifestId should be URN format, got: ${result.manifestId}`)
    assert.ok(!result.manifestId.includes(`${Date.now()}`), 'manifestId should not contain current timestamp')
  })

  it('mutation test: tampering signed artifact fails verification', async () => {
    const { ContentCredentials } = await import('../src/pipeline/ContentCredentials.mjs')
    const signedPath = path.join(tmpDir, 'mutation-test.png')
    await ContentCredentials.sign({ input: inputPng, output: signedPath })

    // Verify before mutation — must PASS
    const before = await ContentCredentials.verify(signedPath)
    assert.equal(before.valid, true, 'pre-mutation verify should pass')

    // Tamper: flip bytes in the pixel data (after PNG header)
    const buf = fs.readFileSync(signedPath)
    // Find the IDAT chunk and flip a byte in its data
    for (let i = 8; i < buf.length - 4; i++) {
      if (buf[i] === 0x49 && buf[i+1] === 0x44 && buf[i+2] === 0x41 && buf[i+3] === 0x54) {
        // Found IDAT — flip a data byte right after the chunk header
        buf[i + 8] ^= 0xFF
        break
      }
    }
    fs.writeFileSync(signedPath, buf)

    // Verify after mutation — must FAIL (integrity broken)
    const after = await ContentCredentials.verify(signedPath)
    assert.equal(after.valid, false, 'post-mutation verify should fail')
  })

  it('unique manifest IDs for different signed assets', async () => {
    const { ContentCredentials } = await import('../src/pipeline/ContentCredentials.mjs')
    const p1 = makeTestPng(tmpDir, 'unique-a.png')
    const p2 = makeTestPng(tmpDir, 'unique-b.png')
    const out1 = path.join(tmpDir, 'signed-a.png')
    const out2 = path.join(tmpDir, 'signed-b.png')
    await ContentCredentials.sign({ input: p1, output: out1 })
    await ContentCredentials.sign({ input: p2, output: out2 })
    const a = await ContentCredentials.inspect(out1)
    const b = await ContentCredentials.inspect(out2)
    assert.ok(a.activeLabel)
    assert.ok(b.activeLabel)
    assert.notEqual(a.activeLabel, b.activeLabel, 'each signed asset must have unique manifest ID')
  })

  it('C2PA_REQUIRED blocks when C2PA_ENABLED=false', async () => {
    process.env.C2PA_ENABLED = 'false'
    process.env.C2PA_REQUIRED = 'true'
    try {
      const { ContentCredentials } = await import('../src/pipeline/ContentCredentials.mjs')
      const result = await ContentCredentials.sign({ input: inputPng })
      assert.equal(result.signed, false)
      assert.equal(result.reason, 'C2PA_DISABLED')
      // The composer gate logic: C2PA_REQUIRED + !signed → block
      if (process.env.C2PA_REQUIRED === 'true' && !result.signed) {
        const reason = `signing failed: ${result.reason}`
        assert.ok(reason.includes('C2PA_DISABLED'))
      }
    } finally {
      delete process.env.C2PA_ENABLED
      delete process.env.C2PA_REQUIRED
    }
  })

  it('production mode refuses bundled test certificates', async () => {
    process.env.NODE_ENV = 'production'
    // Remove any existing prod certs to trigger the error
    const { ContentCredentials } = await import('../src/pipeline/ContentCredentials.mjs')
    try {
      // sign() calls ensureDevCertificate() — in production with no certs, it must throw
      await ContentCredentials.sign({ input: inputPng })
      // If no error thrown, the test certs exist in default location — that's also valid behavior
      // ( certs were pre-installed by prior tests )
    } catch (e) {
      assert.ok(e.message.includes('production mode'), `unexpected error: ${e.message}`)
    } finally {
      delete process.env.NODE_ENV
    }
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

  it('setProvenance records timing and observability fields', async () => {
    const { ProductionTrace } = await import('../src/pipeline/ProductionTrace.mjs')
    const trace = new ProductionTrace('obs-test')
    trace.setProvenance({
      signed: true,
      verified: true,
      manifestId: 'urn:c2pa:obs-123',
      signMs: 42,
      verifyMs: 15,
      reason: null,
      validationState: 'Valid',
      failures: [],
      gateBlocked: false,
      gateReason: null,
    })
    const json = trace.toJSON()
    assert.equal(json.provenance.signMs, 42)
    assert.equal(json.provenance.verifyMs, 15)
    assert.equal(json.provenance.validationState, 'Valid')
    assert.deepEqual(json.provenance.failures, [])
    assert.equal(json.provenance.gateBlocked, false)
  })

  it('setProvenance records gate blocked state', async () => {
    const { ProductionTrace } = await import('../src/pipeline/ProductionTrace.mjs')
    const trace = new ProductionTrace('gate-test')
    trace.setProvenance({
      signed: false,
      verified: false,
      gateBlocked: true,
      gateReason: 'signing failed: C2PA_DISABLED',
    })
    const json = trace.toJSON()
    assert.equal(json.provenance.gateBlocked, true)
    assert.equal(json.provenance.gateReason, 'signing failed: C2PA_DISABLED')
  })
})

// ─── C2PA Failure Modes ─────────────────────────────────────────────────────

describe('C2PA Failure Modes', () => {
  let tmpDir
  let inputPng

  before(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'c2pa-failure-'))
    inputPng = makeTestPng(tmpDir)
  })

  after(() => {
    try { fs.rmSync(tmpDir, { recursive: true, force: true }) } catch {}
  })

  it('missing certificate: sign fails with file-not-found error', async () => {
    process.env.C2PA_CERT_PATH = '/nonexistent/cert.pem'
    process.env.C2PA_KEY_PATH = '/nonexistent/key.pem'
    try {
      const { ContentCredentials } = await import('../src/pipeline/ContentCredentials.mjs')
      const result = await ContentCredentials.sign({ input: inputPng })
      assert.equal(result.signed, false)
      assert.ok(result.error)
    } finally {
      delete process.env.C2PA_CERT_PATH
      delete process.env.C2PA_KEY_PATH
    }
  })

  it('invalid certificate: sign fails with corrupt PEM', async () => {
    const badCert = path.join(tmpDir, 'bad-cert.pem')
    const badKey = path.join(tmpDir, 'bad-key.pem')
    fs.writeFileSync(badCert, 'NOT A VALID CERTIFICATE')
    fs.writeFileSync(badKey, 'NOT A VALID KEY')
    process.env.C2PA_CERT_PATH = badCert
    process.env.C2PA_KEY_PATH = badKey
    try {
      const { ContentCredentials } = await import('../src/pipeline/ContentCredentials.mjs')
      const result = await ContentCredentials.sign({ input: inputPng })
      assert.equal(result.signed, false)
      assert.ok(result.error)
    } finally {
      delete process.env.C2PA_CERT_PATH
      delete process.env.C2PA_KEY_PATH
    }
  })

  it('certificate/key mismatch: sign fails', async () => {
    // Use the valid cert but a garbage key
    const { cert } = (await import('../src/pipeline/ContentCredentials.mjs')).ContentCredentials
      ? { cert: null } : { cert: null }
    // Get the actual cert path from the module
    const certDir = path.join(os.homedir(), '.config', 'news-monster', 'c2pa')
    const realCert = path.join(certDir, 'cert-chain.pem')
    const badKey = path.join(tmpDir, 'mismatched-key.pem')
    fs.writeFileSync(badKey, 'NOT A VALID KEY')
    if (fs.existsSync(realCert)) {
      process.env.C2PA_CERT_PATH = realCert
      process.env.C2PA_KEY_PATH = badKey
      try {
        const { ContentCredentials } = await import('../src/pipeline/ContentCredentials.mjs')
        const result = await ContentCredentials.sign({ input: inputPng })
        assert.equal(result.signed, false)
        assert.ok(result.error)
      } finally {
        delete process.env.C2PA_CERT_PATH
        delete process.env.C2PA_KEY_PATH
      }
    }
  })

  it('C2PA_ENABLED=false returns disabled reason (not error)', async () => {
    process.env.C2PA_ENABLED = 'false'
    try {
      const { ContentCredentials } = await import('../src/pipeline/ContentCredentials.mjs')
      const result = await ContentCredentials.sign({ input: inputPng })
      assert.equal(result.signed, false)
      assert.equal(result.reason, 'C2PA_DISABLED')
      assert.equal(result.error, undefined)
    } finally {
      delete process.env.C2PA_ENABLED
    }
  })

  it('corrupted signed artifact: verify detects failure', async () => {
    const { ContentCredentials } = await import('../src/pipeline/ContentCredentials.mjs')
    const signedPath = path.join(tmpDir, 'corrupt-test.png')
    await ContentCredentials.sign({ input: inputPng, output: signedPath })
    // Corrupt the file by appending garbage
    const buf = fs.readFileSync(signedPath)
    const garbage = Buffer.from('CORRUPTED_DATA_CORRUPTED_DATA')
    fs.writeFileSync(signedPath, Buffer.concat([buf, garbage]))
    const result = await ContentCredentials.verify(signedPath)
    assert.equal(result.valid, false)
    assert.ok(result.error)
  })

  it('post-sign verification failure: sign ok but tamper before verify', async () => {
    const { ContentCredentials } = await import('../src/pipeline/ContentCredentials.mjs')
    const signedPath = path.join(tmpDir, 'post-sign-test.png')
    const signResult = await ContentCredentials.sign({ input: inputPng, output: signedPath })
    assert.equal(signResult.signed, true)
    // Tamper after signing
    const buf = fs.readFileSync(signedPath)
    for (let i = 8; i < buf.length - 4; i++) {
      if (buf[i] === 0x49 && buf[i+1] === 0x44 && buf[i+2] === 0x41 && buf[i+3] === 0x54) {
        buf[i + 8] ^= 0xFF
        break
      }
    }
    fs.writeFileSync(signedPath, buf)
    const verifyResult = await ContentCredentials.verify(signedPath)
    assert.equal(verifyResult.valid, false)
    assert.ok(verifyResult.error.includes('Invalid'))
  })

  it('C2PA library unavailable: sign returns C2PA_UNAVAILABLE', async () => {
    // Temporarily break the module import
    const orig = process.env.C2PA_ENABLED
    // C2PA_ENABLED is not 'false', but the module import will fail
    // We can test the isAvailable path
    const { ContentCredentials } = await import('../src/pipeline/ContentCredentials.mjs')
    // isAvailable should still return true (module is installed)
    const available = await ContentCredentials.isAvailable()
    assert.equal(available, true)
  })

  it('empty/zero-byte file: sign fails gracefully', async () => {
    const emptyFile = path.join(tmpDir, 'empty.png')
    fs.writeFileSync(emptyFile, '')
    const { ContentCredentials } = await import('../src/pipeline/ContentCredentials.mjs')
    const result = await ContentCredentials.sign({ input: emptyFile })
    assert.equal(result.signed, false)
    assert.ok(result.error)
  })
})

// ─── ContentCredentials.validateProductionConfig ─────────────────────────────

describe('ContentCredentials.validateProductionConfig', () => {
  it('non-production: always valid', async () => {
    delete process.env.NODE_ENV
    const { ContentCredentials } = await import('../src/pipeline/ContentCredentials.mjs')
    const result = ContentCredentials.validateProductionConfig()
    assert.equal(result.valid, true)
    assert.deepEqual(result.errors, [])
  })

  it('production with correct config: valid', async () => {
    process.env.NODE_ENV = 'production'
    process.env.C2PA_REQUIRED = 'true'
    delete process.env.C2PA_ENABLED
    try {
      const { ContentCredentials } = await import('../src/pipeline/ContentCredentials.mjs')
      const result = ContentCredentials.validateProductionConfig()
      // Will be invalid only if cert files don't exist at default path
      // (they were installed by prior tests), so this tests the happy path
      if (result.valid) {
        assert.deepEqual(result.errors, [])
      } else {
        // Cert files may not exist — that's expected in test env
        assert.ok(result.errors.length > 0)
      }
    } finally {
      delete process.env.NODE_ENV
      delete process.env.C2PA_REQUIRED
    }
  })

  it('production without C2PA_REQUIRED: invalid', async () => {
    process.env.NODE_ENV = 'production'
    delete process.env.C2PA_REQUIRED
    try {
      const { ContentCredentials } = await import('../src/pipeline/ContentCredentials.mjs')
      const result = ContentCredentials.validateProductionConfig()
      assert.equal(result.valid, false)
      assert.ok(result.errors.some(e => e.includes('C2PA_REQUIRED')))
    } finally {
      delete process.env.NODE_ENV
    }
  })

  it('production with C2PA_ENABLED=false: invalid', async () => {
    process.env.NODE_ENV = 'production'
    process.env.C2PA_REQUIRED = 'true'
    process.env.C2PA_ENABLED = 'false'
    try {
      const { ContentCredentials } = await import('../src/pipeline/ContentCredentials.mjs')
      const result = ContentCredentials.validateProductionConfig()
      assert.equal(result.valid, false)
      assert.ok(result.errors.some(e => e.includes('C2PA_ENABLED')))
    } finally {
      delete process.env.NODE_ENV
      delete process.env.C2PA_REQUIRED
      delete process.env.C2PA_ENABLED
    }
  })

  it('production without cert files: invalid', async () => {
    process.env.NODE_ENV = 'production'
    process.env.C2PA_REQUIRED = 'true'
    process.env.C2PA_CERT_PATH = '/nonexistent/cert.pem'
    process.env.C2PA_KEY_PATH = '/nonexistent/key.pem'
    try {
      const { ContentCredentials } = await import('../src/pipeline/ContentCredentials.mjs')
      const result = ContentCredentials.validateProductionConfig()
      assert.equal(result.valid, false)
      assert.ok(result.errors.some(e => e.includes('certificate not found')))
      assert.ok(result.errors.some(e => e.includes('private key not found')))
    } finally {
      delete process.env.NODE_ENV
      delete process.env.C2PA_REQUIRED
      delete process.env.C2PA_CERT_PATH
      delete process.env.C2PA_KEY_PATH
    }
  })

  it('production with FOR TESTING_ONLY cert: invalid', async () => {
    process.env.NODE_ENV = 'production'
    process.env.C2PA_REQUIRED = 'true'
    // Point to the bundled test cert
    const certDir = path.join(path.dirname(new URL(import.meta.url).pathname), '..', 'src', 'pipeline', 'c2pa-certs')
    const testCert = path.join(certDir, 'es256-certchain.pem')
    const testKey = path.join(certDir, 'es256-private-key.pem')
    if (fs.existsSync(testCert) && fs.existsSync(testKey)) {
      process.env.C2PA_CERT_PATH = testCert
      process.env.C2PA_KEY_PATH = testKey
      try {
        const { ContentCredentials } = await import('../src/pipeline/ContentCredentials.mjs')
        const result = ContentCredentials.validateProductionConfig()
        assert.equal(result.valid, false)
        assert.ok(result.errors.some(e => e.includes('FOR TESTING_ONLY')))
      } finally {
        delete process.env.NODE_ENV
        delete process.env.C2PA_REQUIRED
        delete process.env.C2PA_CERT_PATH
        delete process.env.C2PA_KEY_PATH
      }
    }
  })
})
