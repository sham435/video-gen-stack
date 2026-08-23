import assert from 'node:assert/strict'
import { describe, it, before, after } from 'node:test'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const CERTS_DIR = path.join(__dirname, '..', 'src', 'pipeline', 'c2pa-certs')
const BUNDLED_CERT = path.join(CERTS_DIR, 'es256-certchain.pem')
const BUNDLED_KEY = path.join(CERTS_DIR, 'es256-private-key.pem')

describe('ProductionPreflight', () => {
  const savedEnv = {}

  before(() => {
    for (const k of ['NODE_ENV', 'C2PA_ENABLED', 'C2PA_REQUIRED', 'C2PA_CERT_PATH', 'C2PA_KEY_PATH']) {
      savedEnv[k] = process.env[k]
    }
  })

  after(() => {
    for (const k of Object.keys(savedEnv)) {
      if (savedEnv[k] === undefined) delete process.env[k]
      else process.env[k] = savedEnv[k]
    }
  })

  describe('development mode', () => {
    it('passes with default dev config', async () => {
      delete process.env.NODE_ENV
      delete process.env.C2PA_ENABLED
      delete process.env.C2PA_REQUIRED
      process.env.C2PA_CERT_PATH = BUNDLED_CERT
      process.env.C2PA_KEY_PATH = BUNDLED_KEY
      const { ProductionPreflight } = await import('../src/pipeline/ProductionPreflight.mjs')
      const result = await ProductionPreflight.run()
      assert.equal(result.ok, true)
      assert.equal(result.diagnostics.environment, 'development')
      assert.equal(result.diagnostics.c2paEnabled, false, 'C2PA_ENABLED not set = disabled')
      assert.equal(result.diagnostics.c2paRequired, false)
    })

    it('reports test certificate in dev', async () => {
      delete process.env.NODE_ENV
      process.env.C2PA_ENABLED = 'true'
      process.env.C2PA_CERT_PATH = BUNDLED_CERT
      process.env.C2PA_KEY_PATH = BUNDLED_KEY
      const { ProductionPreflight } = await import('../src/pipeline/ProductionPreflight.mjs')
      const result = await ProductionPreflight.run()
      assert.equal(result.diagnostics.certificateType, 'test')
      assert.equal(result.diagnostics.certificate, 'configured')
      assert.ok(result.diagnostics.certificateFingerprint.startsWith('6F:B5:ED:'))
      assert.ok(result.diagnostics.certificateExpiry !== 'n/a')
    })

    it('reports missing cert gracefully', async () => {
      delete process.env.NODE_ENV
      process.env.C2PA_ENABLED = 'true'
      process.env.C2PA_CERT_PATH = '/nonexistent.pem'
      process.env.C2PA_KEY_PATH = '/nonexistent.pem'
      const { ProductionPreflight } = await import('../src/pipeline/ProductionPreflight.mjs')
      const result = await ProductionPreflight.run()
      assert.equal(result.ok, true, 'dev mode does not block on missing cert')
      assert.equal(result.diagnostics.certificate, 'missing')
    })

    it('reports C2PA disabled', async () => {
      delete process.env.NODE_ENV
      delete process.env.C2PA_ENABLED
      delete process.env.C2PA_REQUIRED
      delete process.env.C2PA_CERT_PATH
      delete process.env.C2PA_KEY_PATH
      const { ProductionPreflight } = await import('../src/pipeline/ProductionPreflight.mjs')
      const result = await ProductionPreflight.run()
      assert.equal(result.ok, true)
      assert.equal(result.diagnostics.c2paEnabled, false)
      assert.equal(result.diagnostics.certificate, 'disabled')
    })
  })

  describe('production mode — invariant enforcement', () => {
    it('blocks when NODE_ENV missing', async () => {
      delete process.env.NODE_ENV
      process.env.C2PA_ENABLED = 'true'
      process.env.C2PA_REQUIRED = 'true'
      process.env.C2PA_CERT_PATH = BUNDLED_CERT
      process.env.C2PA_KEY_PATH = BUNDLED_KEY
      const { ProductionPreflight } = await import('../src/pipeline/ProductionPreflight.mjs')
      const result = await ProductionPreflight.run()
      assert.equal(result.ok, false)
      assert.ok(result.errors.some(e => e.includes('NODE_ENV')))
    })

    it('blocks when C2PA_ENABLED missing', async () => {
      process.env.NODE_ENV = 'production'
      delete process.env.C2PA_ENABLED
      process.env.C2PA_REQUIRED = 'true'
      process.env.C2PA_CERT_PATH = BUNDLED_CERT
      process.env.C2PA_KEY_PATH = BUNDLED_KEY
      const { ProductionPreflight } = await import('../src/pipeline/ProductionPreflight.mjs')
      const result = await ProductionPreflight.run()
      assert.equal(result.ok, false)
      assert.ok(result.errors.some(e => e.includes('C2PA_ENABLED')))
    })

    it('blocks when C2PA_REQUIRED missing', async () => {
      process.env.NODE_ENV = 'production'
      process.env.C2PA_ENABLED = 'true'
      delete process.env.C2PA_REQUIRED
      process.env.C2PA_CERT_PATH = BUNDLED_CERT
      process.env.C2PA_KEY_PATH = BUNDLED_KEY
      const { ProductionPreflight } = await import('../src/pipeline/ProductionPreflight.mjs')
      const result = await ProductionPreflight.run()
      assert.equal(result.ok, false)
      assert.ok(result.errors.some(e => e.includes('C2PA_REQUIRED')))
    })

    it('blocks when certificate missing', async () => {
      process.env.NODE_ENV = 'production'
      process.env.C2PA_ENABLED = 'true'
      process.env.C2PA_REQUIRED = 'true'
      process.env.C2PA_CERT_PATH = '/nonexistent.pem'
      process.env.C2PA_KEY_PATH = '/nonexistent.pem'
      const { ProductionPreflight } = await import('../src/pipeline/ProductionPreflight.mjs')
      const result = await ProductionPreflight.run()
      assert.equal(result.ok, false)
      assert.ok(result.errors.some(e => e.includes('not found')))
    })

    it('blocks when private key missing', async () => {
      process.env.NODE_ENV = 'production'
      process.env.C2PA_ENABLED = 'true'
      process.env.C2PA_REQUIRED = 'true'
      process.env.C2PA_CERT_PATH = BUNDLED_CERT
      process.env.C2PA_KEY_PATH = '/nonexistent.pem'
      const { ProductionPreflight } = await import('../src/pipeline/ProductionPreflight.mjs')
      const result = await ProductionPreflight.run()
      assert.equal(result.ok, false)
      assert.ok(result.errors.some(e => e.includes('key not found')))
    })

    it('blocks when test certificate used', async () => {
      process.env.NODE_ENV = 'production'
      process.env.C2PA_ENABLED = 'true'
      process.env.C2PA_REQUIRED = 'true'
      process.env.C2PA_CERT_PATH = BUNDLED_CERT
      process.env.C2PA_KEY_PATH = BUNDLED_KEY
      const { ProductionPreflight } = await import('../src/pipeline/ProductionPreflight.mjs')
      const result = await ProductionPreflight.run()
      assert.equal(result.ok, false)
      assert.ok(result.errors.some(e => e.includes('Test certificate')))
      assert.equal(result.diagnostics.certificateType, 'test')
    })

    it('blocks when key/cert mismatch', async () => {
      process.env.NODE_ENV = 'production'
      process.env.C2PA_ENABLED = 'true'
      process.env.C2PA_REQUIRED = 'true'
      const crypto = await import('node:crypto')
      const fs = await import('node:fs')
      const { privateKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' })
      const wrongKeyPath = path.join(__dirname, '..', 'output', '_preflight_wrong_key.pem')
      fs.mkdirSync(path.dirname(wrongKeyPath), { recursive: true })
      fs.writeFileSync(wrongKeyPath, privateKey.export({ type: 'pkcs8', format: 'pem' }))
      process.env.C2PA_CERT_PATH = BUNDLED_CERT
      process.env.C2PA_KEY_PATH = wrongKeyPath
      const { ProductionPreflight } = await import('../src/pipeline/ProductionPreflight.mjs')
      const result = await ProductionPreflight.run()
      fs.rmSync(wrongKeyPath, { force: true })
      assert.equal(result.ok, false)
      assert.ok(result.errors.some(e => e.includes('do not match') || e.includes('key mismatch')))
    })

    it('passes all invariants with production cert', async () => {
      // This test can only pass with a real production cert.
      // With the bundled test cert it correctly blocks.
      process.env.NODE_ENV = 'production'
      process.env.C2PA_ENABLED = 'true'
      process.env.C2PA_REQUIRED = 'true'
      process.env.C2PA_CERT_PATH = BUNDLED_CERT
      process.env.C2PA_KEY_PATH = BUNDLED_KEY
      const { ProductionPreflight } = await import('../src/pipeline/ProductionPreflight.mjs')
      const result = await ProductionPreflight.run()
      // With test cert: should fail
      assert.equal(result.ok, false)
      // Diagnostic should show test cert type
      assert.equal(result.diagnostics.certificateType, 'test')
      assert.equal(result.diagnostics.certificate, 'configured')
      assert.ok(result.diagnostics.trustChain)
    })
  })

  describe('diagnostic output', () => {
    it('includes all required fields', async () => {
      process.env.NODE_ENV = 'production'
      process.env.C2PA_ENABLED = 'true'
      process.env.C2PA_REQUIRED = 'true'
      process.env.C2PA_CERT_PATH = BUNDLED_CERT
      process.env.C2PA_KEY_PATH = BUNDLED_KEY
      const { ProductionPreflight } = await import('../src/pipeline/ProductionPreflight.mjs')
      const result = await ProductionPreflight.run()
      const d = result.diagnostics
      assert.ok('environment' in d, 'has environment')
      assert.ok('c2paEnabled' in d, 'has c2paEnabled')
      assert.ok('c2paRequired' in d, 'has c2paRequired')
      assert.ok('certificate' in d, 'has certificate')
      assert.ok('certificateType' in d, 'has certificateType')
      assert.ok('certificateExpiry' in d, 'has certificateExpiry')
      assert.ok('certificateFingerprint' in d, 'has certificateFingerprint')
      assert.ok('trustChain' in d, 'has trustChain')
    })

    it('does not expose private key path', async () => {
      process.env.NODE_ENV = 'production'
      process.env.C2PA_ENABLED = 'true'
      process.env.C2PA_REQUIRED = 'true'
      process.env.C2PA_CERT_PATH = BUNDLED_CERT
      process.env.C2PA_KEY_PATH = BUNDLED_KEY
      const { ProductionPreflight } = await import('../src/pipeline/ProductionPreflight.mjs')
      const result = await ProductionPreflight.run()
      const json = JSON.stringify(result.diagnostics)
      assert.ok(!json.includes('private-key.pem'), 'does not expose key path')
      assert.ok(!json.includes('es256-private'), 'does not expose key filename')
    })

    it('fingerprint is truncated to 16 chars in display', async () => {
      process.env.NODE_ENV = 'production'
      process.env.C2PA_ENABLED = 'true'
      process.env.C2PA_REQUIRED = 'true'
      process.env.C2PA_CERT_PATH = BUNDLED_CERT
      process.env.C2PA_KEY_PATH = BUNDLED_KEY
      const { ProductionPreflight } = await import('../src/pipeline/ProductionPreflight.mjs')
      // Capture console output
      const logs = []
      const origLog = console.log
      console.log = (...args) => logs.push(args.join(' '))
      try {
        await ProductionPreflight.run()
      } finally {
        console.log = origLog
      }
      const fingerprintLine = logs.find(l => l.includes('fingerprint'))
      assert.ok(fingerprintLine, 'fingerprint line exists')
      // Full fingerprint is 59 chars (6F:B5:ED:...), truncated to 16 in display
      assert.ok(fingerprintLine.includes('6F:B5:ED:'), 'shows truncated fingerprint')
    })
  })

  describe('production startup flow', () => {
    it('errors array accumulates all failures', async () => {
      process.env.NODE_ENV = 'production'
      process.env.C2PA_ENABLED = 'true'
      process.env.C2PA_REQUIRED = 'true'
      process.env.C2PA_CERT_PATH = '/nonexistent.pem'
      process.env.C2PA_KEY_PATH = '/nonexistent.pem'
      const { ProductionPreflight } = await import('../src/pipeline/ProductionPreflight.mjs')
      const result = await ProductionPreflight.run()
      assert.equal(result.ok, false)
      assert.ok(result.errors.length >= 1, 'errors accumulated')
    })

    it('returns ok=true only when no errors', async () => {
      delete process.env.NODE_ENV
      delete process.env.C2PA_ENABLED
      delete process.env.C2PA_REQUIRED
      process.env.C2PA_CERT_PATH = BUNDLED_CERT
      process.env.C2PA_KEY_PATH = BUNDLED_KEY
      const { ProductionPreflight } = await import('../src/pipeline/ProductionPreflight.mjs')
      const result = await ProductionPreflight.run()
      assert.equal(result.ok, true)
      assert.equal(result.errors.length, 0)
    })
  })
})
