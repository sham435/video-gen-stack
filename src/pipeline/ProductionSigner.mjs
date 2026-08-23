// ProductionSigner — production-certificate-gated C2PA signing.
//
// Wraps ContentCredentials.sign() with certificate lifecycle validation.
// In production (NODE_ENV=production): validates cert before signing, records
// certificate metadata in trace, blocks signing on invalid/expired certs.
// In development/CI: passes through to ContentCredentials directly.
//
// Pipeline position:
//   CoverComposer → ProductionSigner.sign() → ThumbnailPreflight → YouTube Upload
//
// This module does NOT implement signing — it delegates to ContentCredentials.
// This module DOES enforce certificate validity before allowing signing.

import { CertificateManager } from './CertificateManager.mjs'

// Lazy singleton
let _ContentCredentials = null
async function getCC() {
  if (_ContentCredentials) return _ContentCredentials
  const mod = await import('./ContentCredentials.mjs')
  _ContentCredentials = mod.ContentCredentials
  return _ContentCredentials
}

export const ProductionSigner = Object.freeze({

  // ─── resolve ────────────────────────────────────────────────────────────
  // Resolve and validate certificate. Returns { valid, certInfo, errors[] }.
  // In production: full validation (test marker, expiry, key pair, chain).
  // In development: lightweight check (existence only).
  async resolve() {
    const isProduction = process.env.NODE_ENV === 'production'
    const { cert, key } = CertificateManager.resolvePaths()

    if (!isProduction) {
      // Development: just check files exist (ContentCredentials handles the rest)
      const fs = await import('node:fs')
      if (!fs.default.existsSync(cert) || !fs.default.existsSync(key)) {
        return { valid: false, certInfo: null, errors: ['Certificate or key not found'] }
      }
      try {
        const info = CertificateManager.parse(cert)
        return {
          valid: true,
          certInfo: {
            fingerprint: info.leaf.fingerprint256,
            subject: CertificateManager._parseSubject(info.leaf.subject),
            serial: info.leaf.serialNumber,
            validTo: info.leaf.validTo,
            remainingDays: Math.floor((new Date(info.leaf.validTo) - new Date()) / (1000 * 60 * 60 * 24)),
          },
          errors: [],
        }
      } catch (e) {
        return { valid: false, certInfo: null, errors: [e.message] }
      }
    }

    // Production: full validation
    const validation = CertificateManager.validate(cert, key)
    if (!validation.valid) {
      return { valid: false, certInfo: null, errors: validation.errors }
    }

    return {
      valid: true,
      certInfo: {
        fingerprint: validation.info.leaf.fingerprint256,
        subject: validation.info.leaf.subject,
        serial: validation.info.leaf.serial,
        validTo: validation.info.leaf.validTo,
        remainingDays: validation.info.remainingDays,
        keyValid: validation.info.keyValid,
        hasTestMarker: validation.info.hasTestMarker,
        chainLength: validation.info.chain.length,
      },
      errors: [],
    }
  },

  // ─── sign ───────────────────────────────────────────────────────────────
  // Production-certificate-gated signing.
  // Validates cert → delegates to ContentCredentials.sign() → records metadata.
  // Returns: { signed, path, manifestId, size, certInfo, errors[] }
  async sign({ input, output, article, productionContext, productionTrace } = {}) {
    const isProduction = process.env.NODE_ENV === 'production'

    // Resolve certificate
    const resolution = await ProductionSigner.resolve()
    if (!resolution.valid) {
      const error = `Certificate validation failed: ${resolution.errors.join('; ')}`
      if (productionTrace) {
        productionTrace.setProvenance({
          signed: false, verified: false, error,
          reason: 'CERT_VALIDATION_FAILED',
        })
      }
      if (isProduction) {
        // Production: block signing entirely
        return { signed: false, path: input, manifestId: null, certInfo: null, error }
      }
      // Development: warn but proceed (ContentCredentials will handle)
      console.warn(`[C2PA] ${error} — proceeding in development mode`)
    }

    // Delegate to ContentCredentials
    const CC = await getCC()
    const result = await CC.sign({ input, output, article, productionContext })

    // Record certificate metadata in trace
    if (productionTrace && resolution.certInfo) {
      productionTrace.setProvenance({
        certFingerprint: resolution.certInfo.fingerprint || null,
        certSubject: resolution.certInfo.subject?.CN || null,
        certSerial: resolution.certInfo.serial || null,
        certExpiry: resolution.certInfo.validTo || null,
        certRemainingDays: resolution.certInfo.remainingDays ?? null,
      })
    }

    return {
      ...result,
      certInfo: resolution.certInfo || null,
    }
  },

  // ─── getCertInfo ────────────────────────────────────────────────────────
  // Lightweight cert info for tracing (no validation, just parse).
  async getCertInfo() {
    try {
      const { cert } = CertificateManager.resolvePaths()
      const info = CertificateManager.parse(cert)
      return {
        fingerprint: info.leaf.fingerprint256,
        subject: CertificateManager._parseSubject(info.leaf.subject),
        serial: info.leaf.serialNumber,
        validTo: info.leaf.validTo,
        remainingDays: Math.floor((new Date(info.leaf.validTo) - new Date()) / (1000 * 60 * 60 * 24)),
        chainLength: info.chain.length,
      }
    } catch {
      return null
    }
  },

})
