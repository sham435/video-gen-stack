export class ProviderChain {
  constructor(providers) {
    this.providers = Array.isArray(providers) ? providers : [providers].filter(Boolean)
    this._lastError = null
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

  async generate(messages, options = {}) {
    let lastError = null

    for (let i = 0; i < this.providers.length; i++) {
      const provider = this.providers[i]
      try {
        const result = await provider.generate(messages, options)
        this._lastError = null
        return result
      } catch (e) {
        lastError = e
        this._lastError = e
        if (i < this.providers.length - 1) {
          console.warn(`[ProviderChain] ${provider.name} failed (${i + 1}/${this.providers.length}), falling back: ${e.message}`)
        }
      }
    }

    throw new Error(`All ${this.providers.length} providers failed. Last error: ${lastError?.message}`)
  }
}
