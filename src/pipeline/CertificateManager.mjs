// CertificateManager — X.509 certificate lifecycle for C2PA production signing.
//
// Parses, validates, and monitors certificates using Node.js crypto.X509Certificate.
// Does NOT sign — that remains in ContentCredentials.sign() (frozen).
// Does NOT load keys — key material stays in ContentCredentials.sign().
// This module is for validation, metadata extraction, and expiry monitoring.
//
// Env vars:
//   C2PA_CERT_PATH              — path to PEM cert chain
//   C2PA_KEY_PATH               — path to PEM private key
//   C2PA_EXPIRY_WARNING_DAYS    — days before expiry to warn (default: 30)
//   C2PA_EXPIRY_HARD_FAIL_DAYS  — days before expiry to hard-fail (default: 0 = disabled)
//   NODE_ENV=production          — enables strict validation

import fs from 'node:fs'
import crypto from 'node:crypto'
import path from 'node:path'
import os from 'node:os'

// ─── Helpers ────────────────────────────────────────────────────────────────

function getCertPaths() {
  const certDir = path.join(os.homedir(), '.config', 'news-monster', 'c2pa')
  return {
    cert: process.env.C2PA_CERT_PATH || path.join(certDir, 'cert-chain.pem'),
    key: process.env.C2PA_KEY_PATH || path.join(certDir, 'private-key.pem'),
  }
}

function extractPemBlocks(pem) {
  return pem.match(/-----BEGIN [^-]+-----[\s\S]*?-----END [^-]+-----/g) || []
}

function hasPartialPem(pem) {
  return /-----BEGIN [^-]+-----/.test(pem) && !/-----END [^-]+-----/.test(pem)
}

function containsTestMarker(certPath) {
  try {
    const pem = fs.readFileSync(certPath, 'utf8')
    const b64 = pem.replace(/-----[^-]+-----/g, '').replace(/\s/g, '')
    const der = Buffer.from(b64, 'base64')
    return der.includes(Buffer.from('FOR TESTING_ONLY'))
  } catch { return false }
}

// ─── CertificateManager ─────────────────────────────────────────────────────

export const CertificateManager = Object.freeze({

  // ─── parse ──────────────────────────────────────────────────────────────
  // Parse a PEM cert chain file into individual X509Certificate objects.
  // Returns: { certs: X509Certificate[], leaf: X509Certificate, chain: ParsedCert[] }
  parse(certPath) {
    if (!certPath || !fs.existsSync(certPath)) {
      throw new Error(`Certificate file not found: ${certPath || '(no path)'}`)
    }
    const pem = fs.readFileSync(certPath, 'utf8')
    const blocks = extractPemBlocks(pem)
    if (blocks.length === 0) {
      if (hasPartialPem(pem)) {
        throw new Error(`Malformed certificate: truncated PEM block in ${certPath}`)
      }
      throw new Error(`No valid PEM certificates found in: ${certPath}`)
    }
    const certs = blocks.map(b => {
      try { return new crypto.X509Certificate(b) }
      catch (e) { throw new Error(`Malformed certificate in chain: ${e.message}`) }
    })
    const leaf = certs[0]
    const chain = certs.map(c => ({
      subject: CertificateManager._parseSubject(c.subject),
      issuer: CertificateManager._parseIssuer(c.issuer),
      serial: c.serialNumber,
      validFrom: new Date(c.validFrom),
      validTo: new Date(c.validTo),
      fingerprint256: c.fingerprint256,
    }))
    return { certs, leaf, chain }
  },

  // ─── validate ───────────────────────────────────────────────────────────
  // Full certificate + key validation. Returns { valid, errors[], info }.
  // In production (NODE_ENV=production): rejects test certs, expired certs,
  // malformed certs, key mismatches, missing files.
  validate(certPath, keyPath) {
    const errors = []
    const isProduction = process.env.NODE_ENV === 'production'
    let info = null

    // File existence
    if (!certPath || !fs.existsSync(certPath)) {
      errors.push(`Certificate not found: ${certPath || '(no path)'}`)
      return { valid: false, errors, info }
    }
    if (!keyPath || !fs.existsSync(keyPath)) {
      errors.push(`Private key not found: ${keyPath || '(no path)'}`)
      return { valid: false, errors, info }
    }

    // Parse cert chain
    let parsed
    try {
      parsed = CertificateManager.parse(certPath)
    } catch (e) {
      errors.push(`Certificate parse error: ${e.message}`)
      return { valid: false, errors, info }
    }

    const leaf = parsed.leaf
    const leafInfo = CertificateManager._certInfo(leaf)
    info = { leaf: leafInfo, chain: parsed.chain }

    // Test certificate check
    if (containsTestMarker(certPath)) {
      errors.push('Certificate contains FOR TESTING_ONLY marker — this is a test certificate')
    }

    // Expiry checks
    const now = new Date()
    const validTo = new Date(leaf.validTo)
    const validFrom = new Date(leaf.validFrom)
    const remainingDays = Math.floor((validTo - now) / (1000 * 60 * 60 * 24))

    if (now < validFrom) {
      errors.push(`Certificate not yet valid (validFrom: ${leaf.validFrom})`)
    }
    if (now > validTo) {
      errors.push(`Certificate expired on ${leaf.validTo} (${Math.abs(remainingDays)} days ago)`)
    }

    // Expiry warning threshold
    const warningDays = parseInt(process.env.C2PA_EXPIRY_WARNING_DAYS || '30', 10)
    if (remainingDays > 0 && remainingDays <= warningDays) {
      errors.push(`Certificate expires in ${remainingDays} days (threshold: ${warningDays} days)`)
    }

    // Hard fail threshold
    const hardFailDays = parseInt(process.env.C2PA_EXPIRY_HARD_FAIL_DAYS || '0', 10)
    if (hardFailDays > 0 && remainingDays > 0 && remainingDays <= hardFailDays) {
      errors.push(`Certificate expires in ${remainingDays} days — below hard-fail threshold of ${hardFailDays} days`)
    }

    // Key pair verification
    const keyValid = CertificateManager._verifyKeyPair(certPath, keyPath)
    if (!keyValid) {
      errors.push('Certificate and private key do not match')
    }

    // Production-only: reject malformed chain (self-issued intermediate without root)
    if (isProduction && parsed.certs.length < 2) {
      errors.push('Production certificate chain must include at least leaf + intermediate CA')
    }

    return {
      valid: errors.length === 0,
      errors,
      info: {
        ...info,
        remainingDays,
        keyValid,
        hasTestMarker: containsTestMarker(certPath),
      },
    }
  },

  // ─── getExpiryInfo ──────────────────────────────────────────────────────
  // Returns: { validFrom, validTo, remainingDays, isExpired, isNearExpiry, warningDays }
  getExpiryInfo(certPath) {
    const { leaf } = CertificateManager.parse(certPath)
    const now = new Date()
    const validTo = new Date(leaf.validTo)
    const validFrom = new Date(leaf.validFrom)
    const remainingDays = Math.floor((validTo - now) / (1000 * 60 * 60 * 24))
    const warningDays = parseInt(process.env.C2PA_EXPIRY_WARNING_DAYS || '30', 10)
    return {
      validFrom: leaf.validFrom,
      validTo: leaf.validTo,
      remainingDays,
      isExpired: now > validTo,
      isNotYetValid: now < validFrom,
      isNearExpiry: remainingDays > 0 && remainingDays <= warningDays,
      warningDays,
    }
  },

  // ─── getFingerprint ─────────────────────────────────────────────────────
  // Returns SHA-256 fingerprint of the leaf certificate.
  getFingerprint(certPath) {
    const { leaf } = CertificateManager.parse(certPath)
    return leaf.fingerprint256
  },

  // ─── isExpired ──────────────────────────────────────────────────────────
  isExpired(certPath) {
    const { leaf } = CertificateManager.parse(certPath)
    return new Date() > new Date(leaf.validTo)
  },

  // ─── isNearExpiry ───────────────────────────────────────────────────────
  isNearExpiry(certPath, thresholdDays) {
    const threshold = thresholdDays || parseInt(process.env.C2PA_EXPIRY_WARNING_DAYS || '30', 10)
    const { leaf } = CertificateManager.parse(certPath)
    const remainingDays = Math.floor((new Date(leaf.validTo) - new Date()) / (1000 * 60 * 60 * 24))
    return remainingDays > 0 && remainingDays <= threshold
  },

  // ─── verifyKeyPair ──────────────────────────────────────────────────────
  // Verify that the private key matches the certificate's public key.
  verifyKeyPair(certPath, keyPath) {
    return CertificateManager._verifyKeyPair(certPath, keyPath)
  },

  // ─── resolvePaths ───────────────────────────────────────────────────────
  // Resolve certificate and key paths from env or defaults.
  resolvePaths() {
    return getCertPaths()
  },

  // ─── _verifyKeyPair (internal) ──────────────────────────────────────────
  _verifyKeyPair(certPath, keyPath) {
    try {
      const { leaf } = CertificateManager.parse(certPath)
      const keyPem = fs.readFileSync(keyPath, 'utf8')
      const sign = crypto.createSign('SHA256')
      sign.update('c2pa-keypair-verification')
      const sig = sign.sign(keyPem)
      const verify = crypto.createVerify('SHA256')
      verify.update('c2pa-keypair-verification')
      return verify.verify(leaf.publicKey, sig)
    } catch {
      return false
    }
  },

  // ─── _parseSubject / _parseIssuer (internal) ────────────────────────────
  _parseSubject(subject) {
    return CertificateManager._parseX509Name(subject)
  },
  _parseIssuer(issuer) {
    return CertificateManager._parseX509Name(issuer)
  },
  _parseX509Name(name) {
    // "C=US\nST=CA\nO=Org\nCN=Name" → { C:'US', ST:'CA', O:'Org', CN:'Name' }
    const result = {}
    for (const line of name.split('\n')) {
      const eq = line.indexOf('=')
      if (eq > 0) {
        const k = line.slice(0, eq).trim()
        const v = line.slice(eq + 1).trim()
        if (k) result[k] = v
      }
    }
    return result
  },

  // ─── _certInfo (internal) ───────────────────────────────────────────────
  _certInfo(x509) {
    return {
      subject: CertificateManager._parseSubject(x509.subject),
      issuer: CertificateManager._parseIssuer(x509.issuer),
      serial: x509.serialNumber,
      validFrom: x509.validFrom,
      validTo: x509.validTo,
      fingerprint256: x509.fingerprint256,
    }
  },

})
