// ContentCredentials — C2PA content-provenance stage.
//
// Fits between CoverComposer (raw thumbnail) and ThumbnailPreflight (validation).
//
// Pipeline position:
//   CoverComposer → ContentCredentials.sign() → ContentCredentials.verify()
//                   → ThumbnailPreflight → YouTube Upload
//
// Env vars:
//   C2PA_ENABLED=true            — enable/disable C2PA signing
//   C2PA_REQUIRED=false          — if true, missing/invalid C2PA blocks publish
//   C2PA_VERIFY_AFTER_SIGN=true  — verify immediately after signing
//   C2PA_CERT_PATH               — path to PEM cert chain (dev auto-generates)
//   C2PA_KEY_PATH                — path to PEM private key
//
// IMPORTANT: c2pa-node 0.9.x requires:
//   - EC P-256 (ES256) signing key + cert chain signed by a CA (not self-signed)
//   - File-path-based signing via signFile() for proper JUMBF embedding
//   - fs-extra ESM import fix applied before Reader.fromAsset usage

import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'

const VERSION = '1.0.0'
const CLAIM_GENERATOR = `video-gen-stack/${VERSION}`
const DIGITAL_SOURCE_TYPE = 'http://cv.iptc.org/newscodes/digitalsourcetype/compositeWithTrainedAlgorithmicMedia'

let _c2pa = null
let _c2paLoading = null
async function getC2pa() {
  if (_c2pa) return _c2pa
  if (_c2paLoading) return _c2paLoading
  _c2paLoading = import('@contentauth/c2pa-node').then(m => { _c2pa = m; return m }).catch(() => null)
  return _c2paLoading
}

// ─── Certificate Management ──────────────────────────────────────────────────

function getCertPaths() {
  const certDir = path.join(os.homedir(), '.config', 'news-monster', 'c2pa')
  return {
    cert: process.env.C2PA_CERT_PATH || path.join(certDir, 'cert-chain.pem'),
    key: process.env.C2PA_KEY_PATH || path.join(certDir, 'private-key.pem'),
  }
}

const BUNDLED_CERT_DIR = path.join(path.dirname(new URL(import.meta.url).pathname), 'c2pa-certs')

function ensureDevCertificate() {
  const { cert, key } = getCertPaths()
  const isProduction = process.env.NODE_ENV === 'production'

  // Production: certs must exist — never auto-copy test fixtures
  if (isProduction) {
    if (!fs.existsSync(cert) || !fs.existsSync(key)) {
      throw new Error(
        'C2PA: production mode requires C2PA_CERT_PATH + C2PA_KEY_PATH env vars '
        + 'pointing to an organization-issued certificate. '
        + 'Bundled test certificates cannot be used in production.'
      )
    }
    // Warn if the production cert is actually the test fixture
    const certContent = fs.readFileSync(cert, 'utf8')
    if (certContent.includes('FOR TESTING_ONLY')) {
      console.warn('[C2PA] WARNING: production cert contains FOR TESTING_ONLY marker — this is a test certificate')
    }
    return { cert, key }
  }

  // Development/CI: use existing certs or copy bundled test fixtures
  if (fs.existsSync(cert) && fs.existsSync(key)) return { cert, key }

  const certDir = path.dirname(cert)
  fs.mkdirSync(certDir, { recursive: true })

  // Copy bundled c2pa-rs test certs for development
  const bundledCert = path.join(BUNDLED_CERT_DIR, 'es256-certchain.pem')
  const bundledKey = path.join(BUNDLED_CERT_DIR, 'es256-private-key.pem')

  if (fs.existsSync(bundledCert) && fs.existsSync(bundledKey)) {
    fs.copyFileSync(bundledCert, cert)
    fs.copyFileSync(bundledKey, key)
    console.log(`[C2PA] dev certificate installed: ${certDir}`)
    return { cert, key }
  }

  throw new Error(
    'C2PA: no certificates found. Set C2PA_CERT_PATH + C2PA_KEY_PATH, '
    + 'or ensure bundled test certs exist at: ' + BUNDLED_CERT_DIR
  )
}

// ─── ContentCredentials ──────────────────────────────────────────────────────

export const ContentCredentials = Object.freeze({

  // ─── sign ──────────────────────────────────────────────────────────────
  // Sign a PNG thumbnail with C2PA manifest.
  // Uses builder.signFile() for proper JUMBF embedding into PNG.
  // Input must be a file on disk (c2pa-rs requirement).
  // Returns: { signed, path, manifestId, size }
  async sign({ input, output, article, productionContext } = {}) {
    if (!input) throw new Error('C2PA sign: input path required')
    if (!fs.existsSync(input)) throw new Error(`C2PA sign: file not found: ${input}`)

    const enabled = process.env.C2PA_ENABLED !== 'false'
    if (!enabled) return { signed: false, path: input, manifestId: null, reason: 'C2PA_DISABLED' }

    const c2pa = await getC2pa()
    if (!c2pa) {
      console.warn('[C2PA] @contentauth/c2pa-node not available — skipping sign')
      return { signed: false, path: input, manifestId: null, reason: 'C2PA_UNAVAILABLE' }
    }

    const outputPath = output || input.replace(/\.png$/, '.c2pa.png')

    try {
      const { cert, key } = ensureDevCertificate()
      const certChain = fs.readFileSync(cert)
      const privateKey = fs.readFileSync(key)

      const signer = c2pa.LocalSigner.newSigner(certChain, privateKey, 'es256')

      // Build manifest via builder API
      const builder = c2pa.Builder.new()
      builder.setIntent({ create: DIGITAL_SOURCE_TYPE })
      builder.addAssertion('c2pa.actions', {
        actions: [{
          action: 'c2pa.created',
          digitalSourceType: DIGITAL_SOURCE_TYPE,
          softwareAgent: CLAIM_GENERATOR,
        }],
      })
      builder.addAssertion('c2pa.generatorInfo', {
        name: 'NEWS-MONSTER Pipeline',
        version: VERSION,
      })

      // signFile writes the signed PNG to outputPath with JUMBF embedded
      const manifestData = builder.signFile(signer, input, { path: outputPath })

      // Extract the real manifest label from the signed file
      let manifestId = null
      try {
        const reader = await c2pa.Reader.fromAsset(
          { path: outputPath },
          { verify: { verify_after_reading: false, verify_trust: false } }
        )
        const json = reader.json()
        manifestId = json?.active_manifest || null
      } catch {}

      console.log(`[C2PA] signed: ${outputPath} (${manifestData.length} bytes manifest${manifestId ? ', id=' + manifestId : ''})`)

      return {
        signed: true,
        path: outputPath,
        manifestId,
        size: manifestData.length,
      }
    } catch (e) {
      console.warn(`[C2PA] sign failed: ${e.message}`)
      return { signed: false, path: input, manifestId: null, error: e.message }
    }
  },

  // ─── verify ────────────────────────────────────────────────────────────
  // Verify the C2PA manifest on a signed asset via Reader.fromAsset({ path }).
  // Returns: { valid, manifest, issuer, claimGenerator, error }
  async verify(assetPath) {
    if (!assetPath || !fs.existsSync(assetPath)) {
      return { valid: false, error: 'file not found', manifest: null }
    }

    const c2pa = await getC2pa()
    if (!c2pa) {
      return { valid: false, error: 'c2pa-node unavailable', manifest: null }
    }

    try {
      const reader = await c2pa.Reader.fromAsset(
        { path: assetPath },
        { verify: { verify_after_reading: true, verify_trust: false } }
      )
      const json = reader.json()

      if (!json?.active_manifest || !json?.manifests) {
        return { valid: false, error: 'no active manifest', manifest: null }
      }

      const active = json.manifests[json.active_manifest]
      if (!active) {
        return { valid: false, error: 'active manifest not found', manifest: null }
      }

      // Check validation_state — 'Invalid' means integrity/hash mismatch
      const validationState = json.validation_state || null
      const failures = json.validation_results?.activeManifest?.failure || []
      const isValid = validationState === 'Valid' && failures.length === 0

      return {
        valid: isValid,
        manifest: {
          label: json.active_manifest,
          claimGenerator: active.claim?.generator?.[0] || null,
          title: active.title || null,
          generatedByAI: active.claim?.generated_by_ai || false,
          actions: (active.assertions || []).find(a => a.label?.startsWith('c2pa.actions'))?.data?.actions || [],
          validationState,
          failures: failures.map(f => f.code),
        },
        issuer: active.claim?.generator?.[0] || null,
        claimGenerator: active.claim?.generator?.[0] || null,
        error: isValid ? null : `validation_state=${validationState}, failures=${failures.map(f => f.code).join(',')}`,
      }
    } catch (e) {
      return { valid: false, error: e.message, manifest: null }
    }
  },

  // ─── inspect ───────────────────────────────────────────────────────────
  // Lightweight inspection — does the file have a C2PA manifest?
  async inspect(assetPath) {
    if (!assetPath || !fs.existsSync(assetPath)) {
      return { hasManifest: false, error: 'file not found' }
    }

    const c2pa = await getC2pa()
    if (!c2pa) return { hasManifest: false, error: 'c2pa-node unavailable' }

    try {
      const reader = await c2pa.Reader.fromAsset(
        { path: assetPath },
        { verify: { verify_after_reading: false, verify_trust: false } }
      )
      const json = reader.json()
      const hasManifest = !!(json?.active_manifest && json?.manifests)
      return {
        hasManifest,
        activeLabel: json?.active_manifest || null,
        error: null,
      }
    } catch {
      return { hasManifest: false, error: 'no valid manifest found' }
    }
  },

  // ─── isAvailable ───────────────────────────────────────────────────────
  // Check if C2PA is available (package installed + not disabled)
  async isAvailable() {
    if (process.env.C2PA_ENABLED === 'false') return false
    const c2pa = await getC2pa()
    return c2pa != null
  },

})
