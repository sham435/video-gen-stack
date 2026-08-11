import { classifyError } from './retry.mjs'

export class ProviderChain {
  constructor(providers) {
    this.providers = Array.isArray(providers) ? providers : [providers].filter(Boolean)
    this._lastError = null
    this._failures = []
  }

  get name() {
    return this.providers.map(p => p.name).join(' → ')
  }

  get supportedFeatures() {
    const all = new Set()
    for (const p of this.providers) {
      for (const f of p.supportedFeatures) all.add(f)
    }
    return [...all]
  }

  get lastError() {
    return this._lastError
  }

  // Per-provider classified failures from the most recent generate() call.
  get failures() {
    return this._failures
  }

  async generate(messages, options = {}) {
    const failures = []

    for (let i = 0; i < this.providers.length; i++) {
      const provider = this.providers[i]
      try {
        const result = await provider.generate(messages, options)
        this._lastError = null
        this._failures = []
        return result
      } catch (e) {
        // Classify with the provider's name/model even if the throw didn't
        // carry them — fallback order and error class stay in the diagnostics.
        const error = classifyError(e, { provider: provider.name })
        failures.push(error)
        this._lastError = e
        if (i < this.providers.length - 1) {
          console.warn(`[ProviderChain] ${provider.name} failed (${i + 1}/${this.providers.length}) — class=${error.class} retryable=${error.retryable}, falling back: ${error.message}`)
        }
      }
    }

    this._failures = failures

    const last = failures[failures.length - 1] || null
    const detail = failures.map(f => `${f.provider}:${f.class}${f.status ? `(${f.status})` : ''} — ${f.message}`).join(' | ')
    const err = new Error(`All ${this.providers.length} providers failed. ${detail}`)
    err.providerFailures = failures
    err.class = last?.class ?? 'UNKNOWN'
    err.code = last?.code || 'ALL_PROVIDERS_FAILED'
    throw err
  }
}