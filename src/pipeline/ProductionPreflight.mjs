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
import path from 'node:path'
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
    diagnostics.aiStrategy = { enabled: aiStrategyEnabled, provider: 'none', fallback: 'deterministic', status: 'DEGRADED' }

    if (aiStrategyEnabled) {
      try {
        const { buildProviders } = await import('../src/ai/providers/resolveProviders.mjs')
        const { ProviderChain } = await import('../src/ai/providers/ProviderChain.mjs')
        const providers = buildProviders()
        const chain = new ProviderChain(providers)
        if (chain.providers.length > 0) {
          diagnostics.aiStrategy.provider = chain.name
          diagnostics.aiStrategy.fallback = 'enabled'
          diagnostics.aiStrategy.status = 'READY'
          console.log(`[PREFLIGHT] AI strategy: ENABLED — provider: ${chain.name}`)
        } else {
          diagnostics.aiStrategy.status = 'DEGRADED'
          console.log('[PREFLIGHT] AI strategy: ENABLED but no providers — will use deterministic fallback')
        }
      } catch (e) {
        diagnostics.aiStrategy.provider = `error: ${e.message}`
        diagnostics.aiStrategy.status = 'DEGRADED'
        console.log(`[PREFLIGHT] AI strategy: ENABLED but provider init failed: ${e.message}`)
      }
    } else {
      diagnostics.aiStrategy.status = 'READY'
      console.log('[PREFLIGHT] AI strategy: DISABLED — deterministic mode')
    }

    // ─── YouTube checks ──────────────────────────────────────────────────
    diagnostics.youtube = {
      token: !!process.env.YOUTUBE_REFRESH_TOKEN,
      clientId: !!process.env.YOUTUBE_CLIENT_ID,
      clientSecret: !!process.env.YOUTUBE_CLIENT_SECRET,
      status: process.env.YOUTUBE_REFRESH_TOKEN ? 'READY' : 'BLOCKED',
    }
    if (!process.env.YOUTUBE_REFRESH_TOKEN) {
      errors.push('YOUTUBE_REFRESH_TOKEN not set — cannot publish')
    }

    // ─── Provider checks ─────────────────────────────────────────────────
    diagnostics.providers = {
      elevenlabs: !!process.env.ELEVENLABS_API_KEY ? 'configured' : 'missing',
      gemini: !!process.env.GEMINI_API_KEY ? 'configured' : 'missing',
      openai: !!process.env.OPENAI_API_KEY ? 'configured' : 'missing',
      openrouter: !!process.env.OPENROUTER_API_KEY ? 'configured' : 'missing',
      ollama: 'local',
      newsapi: !!process.env.NEWSAPI_KEY ? 'configured' : 'missing',
      pexels: !!process.env.PEXELS_API_KEY ? 'configured' : 'missing',
    }
    const activeProviders = Object.values(diagnostics.providers).filter(v => v === 'configured' || v === 'local').length
    diagnostics.providers.status = activeProviders >= 2 ? 'READY' : activeProviders >= 1 ? 'DEGRADED' : 'BLOCKED'

    // ─── Storage / asset registry ────────────────────────────────────────
    const outDir = process.env.OUT_DIR || 'output'
    diagnostics.storage = {
      outDir,
      exists: fs.existsSync(outDir),
      assetRegistry: fs.existsSync(path.join(outDir, '.asset-registry.json')),
      status: fs.existsSync(outDir) ? 'READY' : 'DEGRADED',
    }

    // ─── Experiment framework ────────────────────────────────────────────
    diagnostics.experiment = {
      enabled: process.env.AI_EXPERIMENT_ENABLED === 'true',
      status: 'READY',
    }

    // ─── Scheduler ───────────────────────────────────────────────────────
    diagnostics.scheduler = {
      dailyTarget: Number(process.env.DAILY_TARGET) || 48,
      maxConcurrency: Number(process.env.MAX_CONCURRENCY) || 2,
      status: 'READY',
    }

    // ─── Compute overall readiness ───────────────────────────────────────
    const allStatuses = [
      diagnostics.aiStrategy?.status,
      diagnostics.youtube?.status,
      diagnostics.providers?.status,
      diagnostics.storage?.status,
    ]
    if (allStatuses.includes('BLOCKED')) {
      diagnostics.overallStatus = 'BLOCKED'
    } else if (allStatuses.includes('DEGRADED')) {
      diagnostics.overallStatus = 'DEGRADED'
    } else {
      diagnostics.overallStatus = 'READY'
    }

    // ─── Print diagnostic ──────────────────────────────────────────────────
    ProductionPreflight._print(diagnostics, effectiveProduction)

    return { ok: errors.length === 0, diagnostics, errors }
  },

  // ─── _print ─────────────────────────────────────────────────────────────
  _print(d, effectiveProduction) {
    const ai = d.aiStrategy || {}
    const yt = d.youtube || {}
    const pr = d.providers || {}
    const st = d.storage || {}
    const exp = d.experiment || {}
    const sc = d.scheduler || {}
    const lines = [
      '┌─────────────────────────────────────────────────────┐',
      '│  NEWS-MONSTER Production Preflight                   │',
      '├─────────────────────────────────────────────────────┤',
      `│  Overall:    ${(d.overallStatus || 'UNKNOWN').padEnd(39)}│`,
      '├─────────────────────────────────────────────────────┤',
      `│  Environment:     ${(d.environment || '').padEnd(34)}│`,
      `│  C2PA enabled:    ${String(d.c2paEnabled).padEnd(34)}│`,
      `│  C2PA required:   ${String(d.c2paRequired).padEnd(34)}│`,
      `│  Certificate:     ${(d.certificate || '').padEnd(34)}│`,
      `│  Certificate type:${(d.certificateType || '').padEnd(34)}│`,
      `│  Trust chain:     ${(d.trustChain || '').padEnd(34)}│`,
      '├─────────────────────────────────────────────────────┤',
      `│  AI strategy:     ${((ai.enabled ? 'ENABLED' : 'DISABLED')).padEnd(34)}│`,
      `│  AI provider:     ${(ai.provider || 'none').slice(0, 34).padEnd(34)}│`,
      `│  AI status:       ${(ai.status || 'UNKNOWN').padEnd(34)}│`,
      '├─────────────────────────────────────────────────────┤',
      `│  YouTube:         ${(yt.status || 'UNKNOWN').padEnd(34)}│`,
      `│  Providers:       ${(pr.status || 'UNKNOWN').padEnd(34)}│`,
      `│  Storage:         ${(st.status || 'UNKNOWN').padEnd(34)}│`,
      `│  Experiment:      ${(exp.enabled ? 'ENABLED' : 'DISABLED').padEnd(34)}│`,
      `│  Scheduler:       ${`target=${sc.dailyTarget || 48}`.padEnd(34)}│`,
      '└─────────────────────────────────────────────────────┘',
    ]
    const prefix = effectiveProduction ? '[PREFLIGHT]' : '[PREFLIGHT-DEV]'
    for (const line of lines) console.log(`${prefix} ${line}`)
  },

})
