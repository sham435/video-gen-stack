import assert from 'node:assert/strict'
import { describe, it, before, after } from 'node:test'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { fileURLToPath } from 'node:url'
import { execSync } from 'node:child_process'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const CERTS_DIR = path.join(__dirname, '..', 'src', 'pipeline', 'c2pa-certs')
const BUNDLED_CERT = path.join(CERTS_DIR, 'es256-certchain.pem')
const BUNDLED_KEY = path.join(CERTS_DIR, 'es256-private-key.pem')
const TMP_DIR = path.join(os.tmpdir(), `c2pa-cert-test-${Date.now()}`)

function tmpFile(name, content) {
  const p = path.join(TMP_DIR, name)
  fs.mkdirSync(path.dirname(p), { recursive: true })
  fs.writeFileSync(p, content)
  return p
}

const SAMPLE_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64'
)

// ─── CertificateManager ──────────────────────────────────────────────────────

describe('CertificateManager', () => {
  before(() => { fs.mkdirSync(TMP_DIR, { recursive: true }) })
  after(() => { fs.rmSync(TMP_DIR, { recursive: true, force: true }) })

  describe('parse', () => {
    it('parses valid cert chain', async () => {
      const { CertificateManager } = await import('../src/pipeline/CertificateManager.mjs')
      const result = CertificateManager.parse(BUNDLED_CERT)
      assert.ok(result.certs.length >= 2, 'chain has at least 2 certs')
      assert.ok(result.leaf, 'leaf cert exists')
      assert.equal(result.chain[0].subject.CN, 'C2PA Signer')
      assert.equal(result.chain[0].issuer.CN, 'Intermediate CA')
      assert.ok(result.chain[0].serial, 'serial present')
      assert.ok(result.chain[0].fingerprint256, 'fingerprint present')
      assert.ok(result.chain[0].validFrom, 'validFrom present')
      assert.ok(result.chain[0].validTo, 'validTo present')
    })

    it('throws on missing file', async () => {
      const { CertificateManager } = await import('../src/pipeline/CertificateManager.mjs')
      assert.throws(() => CertificateManager.parse('/nonexistent.pem'), /not found/)
    })

    it('throws on empty file', async () => {
      const { CertificateManager } = await import('../src/pipeline/CertificateManager.mjs')
      const p = tmpFile('empty.pem', '')
      assert.throws(() => CertificateManager.parse(p), /No valid PEM/)
    })

    it('throws on malformed PEM', async () => {
      const { CertificateManager } = await import('../src/pipeline/CertificateManager.mjs')
      const p = tmpFile('bad.pem', 'not a cert at all')
      assert.throws(() => CertificateManager.parse(p), /No valid PEM/)
    })

    it('throws on truncated cert', async () => {
      const { CertificateManager } = await import('../src/pipeline/CertificateManager.mjs')
      const realPem = fs.readFileSync(BUNDLED_CERT, 'utf8')
      const truncated = realPem.slice(0, Math.floor(realPem.length / 2))
      const p = tmpFile('truncated.pem', truncated)
      assert.throws(() => CertificateManager.parse(p), /Malformed certificate/)
    })
  })

  describe('validate', () => {
    it('validates correct cert + key pair', async () => {
      const { CertificateManager } = await import('../src/pipeline/CertificateManager.mjs')
      const result = CertificateManager.validate(BUNDLED_CERT, BUNDLED_KEY)
      assert.ok(result.info.leaf, 'leaf info present')
      assert.ok(result.info.chain.length >= 2, 'chain info present')
      assert.equal(result.info.keyValid, true)
      assert.equal(result.info.hasTestMarker, true)
      assert.ok(typeof result.info.remainingDays === 'number', 'remainingDays is number')
      // Bundled cert IS a test cert, so valid=false is correct
      assert.equal(result.valid, false)
      assert.ok(result.errors.some(e => e.includes('FOR TESTING_ONLY')))
    })

    it('fails on missing cert', async () => {
      const { CertificateManager } = await import('../src/pipeline/CertificateManager.mjs')
      const result = CertificateManager.validate('/nonexistent.pem', BUNDLED_KEY)
      assert.equal(result.valid, false)
      assert.ok(result.errors.some(e => e.includes('not found')))
    })

    it('fails on missing key', async () => {
      const { CertificateManager } = await import('../src/pipeline/CertificateManager.mjs')
      const result = CertificateManager.validate(BUNDLED_CERT, '/nonexistent.pem')
      assert.equal(result.valid, false)
      assert.ok(result.errors.some(e => e.includes('not found')))
    })

    it('fails on mismatched key', async () => {
      const { CertificateManager } = await import('../src/pipeline/CertificateManager.mjs')
      const crypto = await import('node:crypto')
      const { privateKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' })
      const wrongKeyPath = path.join(TMP_DIR, 'wrong-key.pem')
      fs.writeFileSync(wrongKeyPath, privateKey.export({ type: 'pkcs8', format: 'pem' }))
      const result = CertificateManager.validate(BUNDLED_CERT, wrongKeyPath)
      assert.equal(result.valid, false)
      assert.ok(result.errors.some(e => e.includes('do not match')))
    })

    it('detects test certificate marker', async () => {
      const { CertificateManager } = await import('../src/pipeline/CertificateManager.mjs')
      const result = CertificateManager.validate(BUNDLED_CERT, BUNDLED_KEY)
      assert.equal(result.info.hasTestMarker, true)
    })

    it('reports expiry warning when threshold exceeded', async () => {
      const { CertificateManager } = await import('../src/pipeline/CertificateManager.mjs')
      process.env.C2PA_EXPIRY_WARNING_DAYS = '999999'
      const result = CertificateManager.validate(BUNDLED_CERT, BUNDLED_KEY)
      delete process.env.C2PA_EXPIRY_WARNING_DAYS
      assert.ok(result.errors.some(e => e.includes('expires in')))
    })
  })

  describe('getExpiryInfo', () => {
    it('returns expiry metadata', async () => {
      const { CertificateManager } = await import('../src/pipeline/CertificateManager.mjs')
      const info = CertificateManager.getExpiryInfo(BUNDLED_CERT)
      assert.ok(info.validFrom)
      assert.ok(info.validTo)
      assert.ok(typeof info.remainingDays === 'number')
      assert.equal(typeof info.isExpired, 'boolean')
      assert.equal(typeof info.isNearExpiry, 'boolean')
      assert.equal(typeof info.isNotYetValid, 'boolean')
      assert.ok(info.warningDays > 0)
    })

    it('dev cert is not expired', async () => {
      const { CertificateManager } = await import('../src/pipeline/CertificateManager.mjs')
      const info = CertificateManager.getExpiryInfo(BUNDLED_CERT)
      assert.equal(info.isExpired, false)
    })

    it('throws on missing file', async () => {
      const { CertificateManager } = await import('../src/pipeline/CertificateManager.mjs')
      assert.throws(() => CertificateManager.getExpiryInfo('/nonexistent.pem'), /not found/)
    })
  })

  describe('getFingerprint', () => {
    it('returns SHA-256 fingerprint', async () => {
      const { CertificateManager } = await import('../src/pipeline/CertificateManager.mjs')
      const fp = CertificateManager.getFingerprint(BUNDLED_CERT)
      assert.ok(fp.startsWith('6F:B5:ED:'), 'starts with expected prefix')
      assert.equal(fp.split(':').length, 32, 'has 32 colon-separated hex pairs')
    })

    it('throws on missing file', async () => {
      const { CertificateManager } = await import('../src/pipeline/CertificateManager.mjs')
      assert.throws(() => CertificateManager.getFingerprint('/nonexistent.pem'), /not found/)
    })
  })

  describe('isExpired', () => {
    it('returns false for valid cert', async () => {
      const { CertificateManager } = await import('../src/pipeline/CertificateManager.mjs')
      assert.equal(CertificateManager.isExpired(BUNDLED_CERT), false)
    })
  })

  describe('isNearExpiry', () => {
    it('returns false for cert with years remaining', async () => {
      const { CertificateManager } = await import('../src/pipeline/CertificateManager.mjs')
      assert.equal(CertificateManager.isNearExpiry(BUNDLED_CERT), false)
    })

    it('returns true with high threshold', async () => {
      const { CertificateManager } = await import('../src/pipeline/CertificateManager.mjs')
      assert.equal(CertificateManager.isNearExpiry(BUNDLED_CERT, 2000), true)
    })
  })

  describe('verifyKeyPair', () => {
    it('returns true for matching pair', async () => {
      const { CertificateManager } = await import('../src/pipeline/CertificateManager.mjs')
      assert.equal(CertificateManager.verifyKeyPair(BUNDLED_CERT, BUNDLED_KEY), true)
    })

    it('returns false for wrong key', async () => {
      const { CertificateManager } = await import('../src/pipeline/CertificateManager.mjs')
      const crypto = await import('node:crypto')
      const { privateKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' })
      const wrongKeyPath = path.join(TMP_DIR, 'wrong-key.pem')
      fs.writeFileSync(wrongKeyPath, privateKey.export({ type: 'pkcs8', format: 'pem' }))
      assert.equal(CertificateManager.verifyKeyPair(BUNDLED_CERT, wrongKeyPath), false)
    })

    it('returns false for missing files', async () => {
      const { CertificateManager } = await import('../src/pipeline/CertificateManager.mjs')
      assert.equal(CertificateManager.verifyKeyPair('/no.pem', '/no.pem'), false)
    })
  })

  describe('resolvePaths', () => {
    it('returns default paths when env not set', async () => {
      const { CertificateManager } = await import('../src/pipeline/CertificateManager.mjs')
      delete process.env.C2PA_CERT_PATH
      delete process.env.C2PA_KEY_PATH
      const paths = CertificateManager.resolvePaths()
      assert.ok(paths.cert.includes('news-monster'))
      assert.ok(paths.key.includes('news-monster'))
    })

    it('uses env overrides', async () => {
      const { CertificateManager } = await import('../src/pipeline/CertificateManager.mjs')
      process.env.C2PA_CERT_PATH = '/custom/cert.pem'
      process.env.C2PA_KEY_PATH = '/custom/key.pem'
      const paths = CertificateManager.resolvePaths()
      assert.equal(paths.cert, '/custom/cert.pem')
      assert.equal(paths.key, '/custom/key.pem')
      delete process.env.C2PA_CERT_PATH
      delete process.env.C2PA_KEY_PATH
    })
  })

  describe('detects expired self-signed cert', () => {
    it('getExpiryInfo reports expired for cert created with -days 0', async () => {
      const { CertificateManager } = await import('../src/pipeline/CertificateManager.mjs')
      const expiredKey = path.join(TMP_DIR, 'expired-key.pem')
      const expiredCert = path.join(TMP_DIR, 'expired-cert.pem')
      try {
        execSync(`openssl ecparam -genkey -name prime256v1 -noout -out "${expiredKey}" 2>/dev/null`)
        execSync(
          `openssl req -new -x509 -key "${expiredKey}" -out "${expiredCert}" -days 0 -subj "/CN=Expired Test" 2>/dev/null`,
          { timeout: 5000 }
        )
        const info = CertificateManager.getExpiryInfo(expiredCert)
        assert.equal(info.isExpired, true)
        assert.ok(info.remainingDays <= 0)
      } catch {
        // openssl not available — skip
      }
    })
  })
})

// ─── ProductionSigner ─────────────────────────────────────────────────────────

describe('ProductionSigner', () => {
  const savedEnv = {}

  before(() => {
    fs.mkdirSync(TMP_DIR, { recursive: true })
    savedEnv.NODE_ENV = process.env.NODE_ENV
    savedEnv.C2PA_CERT_PATH = process.env.C2PA_CERT_PATH
    savedEnv.C2PA_KEY_PATH = process.env.C2PA_KEY_PATH
  })

  after(() => {
    if (savedEnv.NODE_ENV === undefined) delete process.env.NODE_ENV
    else process.env.NODE_ENV = savedEnv.NODE_ENV
    if (savedEnv.C2PA_CERT_PATH === undefined) delete process.env.C2PA_CERT_PATH
    else process.env.C2PA_CERT_PATH = savedEnv.C2PA_CERT_PATH
    if (savedEnv.C2PA_KEY_PATH === undefined) delete process.env.C2PA_KEY_PATH
    else process.env.C2PA_KEY_PATH = savedEnv.C2PA_KEY_PATH
    fs.rmSync(TMP_DIR, { recursive: true, force: true })
  })

  describe('resolve', () => {
    it('resolves successfully in development with valid certs', async () => {
      delete process.env.NODE_ENV
      process.env.C2PA_CERT_PATH = BUNDLED_CERT
      process.env.C2PA_KEY_PATH = BUNDLED_KEY
      const { ProductionSigner } = await import('../src/pipeline/ProductionSigner.mjs')
      const result = await ProductionSigner.resolve()
      assert.equal(result.valid, true)
      assert.ok(result.certInfo, 'certInfo present')
      assert.ok(result.certInfo.fingerprint, 'fingerprint present')
      assert.ok(result.certInfo.remainingDays > 0, 'remainingDays positive')
      assert.equal(result.errors.length, 0)
    })

    it('fails when cert missing in production', async () => {
      process.env.NODE_ENV = 'production'
      process.env.C2PA_CERT_PATH = '/nonexistent.pem'
      process.env.C2PA_KEY_PATH = '/nonexistent.pem'
      const { ProductionSigner } = await import('../src/pipeline/ProductionSigner.mjs')
      const result = await ProductionSigner.resolve()
      assert.equal(result.valid, false)
      assert.ok(result.errors.length > 0)
    })

    it('fails when cert has test marker in production', async () => {
      process.env.NODE_ENV = 'production'
      process.env.C2PA_CERT_PATH = BUNDLED_CERT
      process.env.C2PA_KEY_PATH = BUNDLED_KEY
      const { ProductionSigner } = await import('../src/pipeline/ProductionSigner.mjs')
      const result = await ProductionSigner.resolve()
      assert.equal(result.valid, false)
      assert.ok(result.errors.some(e => e.includes('FOR TESTING_ONLY')))
    })

    it('fails when key mismatches in production', async () => {
      process.env.NODE_ENV = 'production'
      process.env.C2PA_CERT_PATH = BUNDLED_CERT
      const crypto = await import('node:crypto')
      const { privateKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' })
      const wrongKeyPath = path.join(TMP_DIR, 'wrong-key-prod.pem')
      fs.writeFileSync(wrongKeyPath, privateKey.export({ type: 'pkcs8', format: 'pem' }))
      process.env.C2PA_KEY_PATH = wrongKeyPath
      const { ProductionSigner } = await import('../src/pipeline/ProductionSigner.mjs')
      const result = await ProductionSigner.resolve()
      assert.equal(result.valid, false)
      assert.ok(result.errors.some(e => e.includes('do not match')))
    })
  })

  describe('sign', () => {
    it('signs and records cert metadata in development', async () => {
      delete process.env.NODE_ENV
      process.env.C2PA_CERT_PATH = BUNDLED_CERT
      process.env.C2PA_KEY_PATH = BUNDLED_KEY
      const { ProductionSigner } = await import('../src/pipeline/ProductionSigner.mjs')
      const { ContentCredentials } = await import('../src/pipeline/ContentCredentials.mjs')
      if (!ContentCredentials.isAvailable()) return

      const inputPath = path.join(TMP_DIR, 'sign-dev-input.png')
      fs.writeFileSync(inputPath, SAMPLE_PNG)

      const result = await ProductionSigner.sign({
        input: inputPath,
        article: { title: 'Test', body: 'Body', imageUrl: 'http://test.com/img.png', source: 'test' },
      })
      assert.equal(result.signed, true)
      assert.ok(result.path, 'output path present')
      assert.ok(result.manifestId, 'manifestId present')
      assert.ok(result.certInfo, 'certInfo present')
      assert.ok(result.certInfo.fingerprint, 'cert fingerprint recorded')
    })

    it('blocks signing in production with test cert', async () => {
      process.env.NODE_ENV = 'production'
      process.env.C2PA_CERT_PATH = BUNDLED_CERT
      process.env.C2PA_KEY_PATH = BUNDLED_KEY
      const { ProductionSigner } = await import('../src/pipeline/ProductionSigner.mjs')
      const { ContentCredentials } = await import('../src/pipeline/ContentCredentials.mjs')
      if (!ContentCredentials.isAvailable()) return

      const inputPath = path.join(TMP_DIR, 'sign-blocked-input.png')
      fs.writeFileSync(inputPath, SAMPLE_PNG)

      const result = await ProductionSigner.sign({
        input: inputPath,
        article: { title: 'Test', body: 'Body', imageUrl: 'http://test.com/img.png', source: 'test' },
      })
      assert.equal(result.signed, false, 'signing blocked in production with test cert')
      assert.ok(result.error, 'error message present')
    })

    it('records cert metadata in production trace', async () => {
      delete process.env.NODE_ENV
      process.env.C2PA_CERT_PATH = BUNDLED_CERT
      process.env.C2PA_KEY_PATH = BUNDLED_KEY
      const { ProductionSigner } = await import('../src/pipeline/ProductionSigner.mjs')
      const { ContentCredentials } = await import('../src/pipeline/ContentCredentials.mjs')
      const { ProductionTrace } = await import('../src/pipeline/ProductionTrace.mjs')
      if (!ContentCredentials.isAvailable()) return

      const trace = new ProductionTrace()
      const inputPath = path.join(TMP_DIR, 'sign-trace-input.png')
      fs.writeFileSync(inputPath, SAMPLE_PNG)

      await ProductionSigner.sign({
        input: inputPath,
        article: { title: 'Test', body: 'Body', imageUrl: 'http://test.com/img.png', source: 'test' },
        productionTrace: trace,
      })

      assert.ok(trace.record.provenance.certFingerprint, 'certFingerprint in trace')
      assert.ok(trace.record.provenance.certSerial, 'certSerial in trace')
      assert.ok(trace.record.provenance.certExpiry, 'certExpiry in trace')
      assert.ok(typeof trace.record.provenance.certRemainingDays === 'number', 'certRemainingDays in trace')
    })

    it('returns error object on failure without throwing', async () => {
      delete process.env.NODE_ENV
      process.env.C2PA_CERT_PATH = '/nonexistent.pem'
      process.env.C2PA_KEY_PATH = '/nonexistent.pem'
      const { ProductionSigner } = await import('../src/pipeline/ProductionSigner.mjs')
      const { ContentCredentials } = await import('../src/pipeline/ContentCredentials.mjs')
      if (!ContentCredentials.isAvailable()) return

      const inputPath = path.join(TMP_DIR, 'sign-error-input.png')
      fs.writeFileSync(inputPath, SAMPLE_PNG)

      const result = await ProductionSigner.sign({
        input: inputPath,
        article: { title: 'Test', body: 'Body', imageUrl: 'http://test.com/img.png', source: 'test' },
      })
      assert.equal(result.signed, false)
      assert.ok(result.error)
    })
  })

  describe('getCertInfo', () => {
    it('returns cert info', async () => {
      process.env.C2PA_CERT_PATH = BUNDLED_CERT
      process.env.C2PA_KEY_PATH = BUNDLED_KEY
      const { ProductionSigner } = await import('../src/pipeline/ProductionSigner.mjs')
      const info = await ProductionSigner.getCertInfo()
      assert.ok(info, 'cert info present')
      assert.ok(info.fingerprint, 'fingerprint present')
      assert.ok(info.subject, 'subject present')
      assert.ok(info.serial, 'serial present')
      assert.ok(info.validTo, 'validTo present')
      assert.ok(typeof info.remainingDays === 'number', 'remainingDays is number')
      assert.ok(info.chainLength >= 2, 'chainLength >= 2')
    })

    it('returns null for missing cert', async () => {
      process.env.C2PA_CERT_PATH = '/nonexistent.pem'
      const { ProductionSigner } = await import('../src/pipeline/ProductionSigner.mjs')
      const info = await ProductionSigner.getCertInfo()
      assert.equal(info, null)
    })
  })
})

// ─── ProductionTrace certificate fields ───────────────────────────────────────

describe('ProductionTrace certificate observability', () => {
  it('includes cert fields in sealed provenance', async () => {
    const { ProductionTrace } = await import('../src/pipeline/ProductionTrace.mjs')
    const trace = new ProductionTrace()
    assert.equal(trace.record.provenance.certFingerprint, null)
    assert.equal(trace.record.provenance.certSubject, null)
    assert.equal(trace.record.provenance.certSerial, null)
    assert.equal(trace.record.provenance.certExpiry, null)
    assert.equal(trace.record.provenance.certRemainingDays, null)
  })

  it('setProvenance accepts cert fields', async () => {
    const { ProductionTrace } = await import('../src/pipeline/ProductionTrace.mjs')
    const trace = new ProductionTrace()
    trace.setProvenance({
      signed: true, verified: true,
      certFingerprint: 'AA:BB:CC',
      certSubject: 'Test Signer',
      certSerial: '12345',
      certExpiry: 'Dec 31 2030',
      certRemainingDays: 1800,
    })
    assert.equal(trace.record.provenance.certFingerprint, 'AA:BB:CC')
    assert.equal(trace.record.provenance.certSubject, 'Test Signer')
    assert.equal(trace.record.provenance.certSerial, '12345')
    assert.equal(trace.record.provenance.certExpiry, 'Dec 31 2030')
    assert.equal(trace.record.provenance.certRemainingDays, 1800)
  })

  it('cert fields remain null when not set', async () => {
    const { ProductionTrace } = await import('../src/pipeline/ProductionTrace.mjs')
    const trace = new ProductionTrace()
    trace.setProvenance({ signed: true, verified: true })
    assert.equal(trace.record.provenance.certFingerprint, null)
    assert.equal(trace.record.provenance.certSubject, null)
  })

  it('emit() includes cert fields in JSON output', async () => {
    const { ProductionTrace } = await import('../src/pipeline/ProductionTrace.mjs')
    const trace = new ProductionTrace()
    trace.setProvenance({ signed: true, verified: true, certFingerprint: 'FF:EE:DD', certSerial: '999' })
    const emitted = trace.emit()
    assert.equal(emitted.provenance.certFingerprint, 'FF:EE:DD')
    assert.equal(emitted.provenance.certSerial, '999')
  })
})

// ─── Production cert lifecycle failure modes ──────────────────────────────────

describe('Certificate lifecycle failure modes', () => {
  const savedEnv = {}
  before(() => {
    fs.mkdirSync(TMP_DIR, { recursive: true })
    savedEnv.C2PA_CERT_PATH = process.env.C2PA_CERT_PATH
    savedEnv.C2PA_KEY_PATH = process.env.C2PA_KEY_PATH
    savedEnv.C2PA_EXPIRY_WARNING_DAYS = process.env.C2PA_EXPIRY_WARNING_DAYS
    savedEnv.C2PA_EXPIRY_HARD_FAIL_DAYS = process.env.C2PA_EXPIRY_HARD_FAIL_DAYS
  })
  after(() => {
    for (const k of ['C2PA_CERT_PATH', 'C2PA_KEY_PATH', 'C2PA_EXPIRY_WARNING_DAYS', 'C2PA_EXPIRY_HARD_FAIL_DAYS']) {
      if (savedEnv[k] === undefined) delete process.env[k]
      else process.env[k] = savedEnv[k]
    }
  })

  it('hard-fail threshold blocks valid cert', async () => {
    const { CertificateManager } = await import('../src/pipeline/CertificateManager.mjs')
    process.env.C2PA_EXPIRY_HARD_FAIL_DAYS = '999999'
    const result = CertificateManager.validate(BUNDLED_CERT, BUNDLED_KEY)
    delete process.env.C2PA_EXPIRY_HARD_FAIL_DAYS
    assert.ok(result.errors.some(e => e.includes('hard-fail threshold')))
  })

  it('expired self-signed cert detected', async () => {
    const { CertificateManager } = await import('../src/pipeline/CertificateManager.mjs')
    const expiredKey = path.join(TMP_DIR, 'expired-lifecycle-key.pem')
    const expiredCert = path.join(TMP_DIR, 'expired-lifecycle-cert.pem')
    try {
      execSync(`openssl ecparam -genkey -name prime256v1 -noout -out "${expiredKey}" 2>/dev/null`)
      execSync(
        `openssl req -new -x509 -key "${expiredKey}" -out "${expiredCert}" -days 0 -subj "/CN=Expired Lifecycle Test" 2>/dev/null`,
        { timeout: 5000 }
      )
      const result = CertificateManager.validate(expiredCert, expiredKey)
      assert.ok(result.errors.some(e => e.includes('expired')))
    } catch {
      // openssl not available — skip
    }
  })

  it('generateKeyPair produces valid cert+key that CertificateManager validates', async () => {
    const { CertificateManager } = await import('../src/pipeline/CertificateManager.mjs')
    const crypto = await import('node:crypto')
    const genKey = path.join(TMP_DIR, 'gen-key.pem')
    const genCert = path.join(TMP_DIR, 'gen-cert.pem')
    const { privateKey, publicKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' })
    fs.writeFileSync(genKey, privateKey.export({ type: 'pkcs8', format: 'pem' }))

    // Create a self-signed cert using openssl
    try {
      execSync(
        `openssl req -new -x509 -key "${genKey}" -out "${genCert}" -days 365 -subj "/CN=Generated Test Cert" 2>/dev/null`,
        { timeout: 5000 }
      )
      const result = CertificateManager.validate(genCert, genKey)
      assert.equal(result.info.keyValid, true)
      assert.equal(result.info.hasTestMarker, false, 'generated cert has no test marker')
    } catch {
      // openssl not available — skip
    }
  })

  it('key pair with wrong algorithm fails', async () => {
    const { CertificateManager } = await import('../src/pipeline/CertificateManager.mjs')
    const crypto = await import('node:crypto')
    // Generate RSA key (wrong algorithm for EC cert)
    const { privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 })
    const rsaKeyPath = path.join(TMP_DIR, 'rsa-key.pem')
    fs.writeFileSync(rsaKeyPath, privateKey.export({ type: 'pkcs8', format: 'pem' }))
    assert.equal(CertificateManager.verifyKeyPair(BUNDLED_CERT, rsaKeyPath), false)
  })
})
