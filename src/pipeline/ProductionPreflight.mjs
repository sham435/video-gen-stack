// ProductionPreflight — startup invariant validation + diagnostic output.
//
// Runs before accepting traffic in production. Validates all invariants:
//   NODE_ENV === production
//   C2PA_ENABLED === true
//   C2PA_REQUIRED === true
//   certificate present, not test, not expired, key matches, chain valid
//
// Prints a diagnostic block. Never prints private-key path or secret values.
// Returns { ok, diagnostics, errors[] }.

import fs from 'node:fs'
import { CertificateManager } from './CertificateManager.mjs'

export const ProductionPreflight = Object.freeze({

  // ─── run ────────────────────────────────────────────────────────────────
  // Execute full preflight. In production: fail-hard on any error.
  // In non-production: print diagnostics but don't block.
  async run() {
    const envIsProduction = process.env.NODE_ENV === 'production'
    const c2paEnabled = process.env.C2PA_ENABLED === 'true'
    const c2paRequired = process.env.C2PA_REQUIRED === 'true'
    // Effective production mode: NODE_ENV=production OR C2PA_REQUIRED=true
    const effectiveProduction = envIsProduction || c2paRequired

    const diagnostics = {
      environment: process.env.NODE_ENV || 'development',
      c2paEnabled,
      c2paRequired,
      certificate: 'not configured',
      certificateType: 'n/a',
      certificateExpiry: 'n/a',
      certificateFingerprint: 'n/a',
      trustChain: 'n/a',
    }
    const errors = []

    // ─── NODE_ENV check ────────────────────────────────────────────────────
    if (c2paRequired && !envIsProduction) {
      errors.push('NODE_ENV must be "production" when C2PA_REQUIRED=true')
    }

    // ─── C2PA checks ───────────────────────────────────────────────────────
    if (effectiveProduction && !c2paEnabled) {
      errors.push('C2PA_ENABLED must be true in production')
    }
    if (effectiveProduction && !c2paRequired) {
      errors.push('C2PA_REQUIRED must be true in production')
    }

    // ─── Certificate checks ────────────────────────────────────────────────
    if (c2paEnabled) {
      const { cert, key } = CertificateManager.resolvePaths()

      const certExists = fs.existsSync(cert)
      const keyExists = fs.existsSync(key)

      if (!certExists) {
        diagnostics.certificate = 'missing'
        if (effectiveProduction) errors.push('Production certificate not found')
      } else if (!keyExists) {
        diagnostics.certificate = 'key missing'
        if (effectiveProduction) errors.push('Production private key not found')
      } else {
        // Parse and validate
        try {
          const validation = CertificateManager.validate(cert, key)
          const expiryInfo = CertificateManager.getExpiryInfo(cert)
          const fingerprint = CertificateManager.getFingerprint(cert)

          diagnostics.certificate = 'configured'
          diagnostics.certificateFingerprint = fingerprint
          diagnostics.certificateExpiry = expiryInfo.validTo
          diagnostics.trustChain = validation.info.chain.length >= 2 ? 'valid' : 'incomplete'

          if (validation.info.hasTestMarker) {
            diagnostics.certificateType = 'test'
            if (effectiveProduction) errors.push('Test certificate rejected in production')
          } else {
            diagnostics.certificateType = 'production'
          }

          if (expiryInfo.isExpired) {
            diagnostics.certificate = 'expired'
            if (effectiveProduction) errors.push('Certificate is expired')
          } else if (expiryInfo.isNearExpiry) {
            diagnostics.certificate = `expires in ${expiryInfo.remainingDays} days`
          }

          if (!validation.info.keyValid) {
            diagnostics.trustChain = 'key mismatch'
            if (effectiveProduction) errors.push('Certificate and private key do not match')
          }

          // Accumulate validation errors only in effective production
          // (in dev, these are informational only — shown in diagnostics)
          if (effectiveProduction) {
            for (const e of validation.errors) {
              if (!errors.includes(e)) errors.push(e)
            }
          }
        } catch (e) {
          diagnostics.certificate = 'invalid'
          diagnostics.trustChain = 'parse error'
          if (effectiveProduction) errors.push(`Certificate error: ${e.message}`)
        }
      }
    } else {
      diagnostics.certificate = 'disabled'
    }

    // ─── AI Strategy checks ───────────────────────────────────────────────
    const aiStrategyEnabled = process.env.AI_STRATEGY_ENABLED === 'true'
    diagnostics.aiStrategyEnabled = aiStrategyEnabled
    diagnostics.aiStrategyProvider = 'none'
    diagnostics.aiStrategyFallback = 'deterministic'

    if (aiStrategyEnabled) {
      // Probe for available providers
      try {
        const { ProviderChain } = await import('../src/ai/providers/ProviderChain.mjs')
        const chain = new ProviderChain()
        if (chain.providers.length > 0) {
          diagnostics.aiStrategyProvider = chain.name
          diagnostics.aiStrategyFallback = 'enabled'
          console.log(`[PREFLIGHT] AI strategy: ENABLED — provider: ${chain.name}`)
        } else {
          diagnostics.aiStrategyProvider = 'none'
          console.log('[PREFLIGHT] AI strategy: ENABLED but no providers — will use deterministic fallback')
        }
      } catch (e) {
        diagnostics.aiStrategyProvider = `error: ${e.message}`
        console.log(`[PREFLIGHT] AI strategy: ENABLED but provider init failed: ${e.message}`)
      }
    } else {
      console.log('[PREFLIGHT] AI strategy: DISABLED — deterministic mode')
    }

    // ─── Print diagnostic ──────────────────────────────────────────────────
    ProductionPreflight._print(diagnostics, effectiveProduction)

    return { ok: errors.length === 0, diagnostics, errors }
  },

  // ─── _print ─────────────────────────────────────────────────────────────
  _print(d, effectiveProduction) {
    const lines = [
      '┌─────────────────────────────────────────┐',
      '│  C2PA Production Preflight               │',
      '├─────────────────────────────────────────┤',
      `│  Environment:          ${(d.environment || '').padEnd(19)}│`,
      `│  C2PA enabled:         ${String(d.c2paEnabled).padEnd(19)}│`,
      `│  C2PA required:        ${String(d.c2paRequired).padEnd(19)}│`,
      `│  Certificate:          ${d.certificate.padEnd(19)}│`,
      `│  Certificate type:     ${d.certificateType.padEnd(19)}│`,
      `│  Certificate expiry:   ${d.certificateExpiry.padEnd(19)}│`,
      `│  Certificate fingerprint: ${d.certificateFingerprint.slice(0, 16).padEnd(16)}│`,
      `│  Trust chain:          ${d.trustChain.padEnd(19)}│`,
      '├─────────────────────────────────────────┤',
      `│  AI strategy:          ${String(d.aiStrategyEnabled).padEnd(19)}│`,
      `│  AI provider:          ${String(d.aiStrategyProvider).slice(0, 19).padEnd(19)}│`,
      `│  AI fallback:          ${String(d.aiStrategyFallback).padEnd(19)}│`,
      '└─────────────────────────────────────────┘',
    ]
    const prefix = effectiveProduction ? '[PREFLIGHT]' : '[PREFLIGHT-DEV]'
    for (const line of lines) console.log(`${prefix} ${line}`)
  },

})
