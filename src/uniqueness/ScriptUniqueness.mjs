// ScriptUniqueness — ensures narration scripts are not reused.
//
// At 48/day, deterministic script generation will produce identical
// scripts for similar articles. This checker hashes the full narration
// text and rejects it if it matches any recent published script.
//
// Policy: exact hash match within the rolling window = REJECT.
// At 48/day, even similar scripts must diverge. The LLM/retry layer
// must regenerate if this fires.

export class ScriptUniqueness {
  constructor(registry) {
    this.registry = registry
  }

  /**
   * Validate a script for uniqueness.
   *
   * @param {string} narrationText — full narration script text
   * @param {object} context — { articleHash, jobId, title }
   * @returns {{ pass: boolean, hash: string, reason: string|null, duplicateOf: object|null }}
   */
  validate(narrationText, context = {}) {
    const hash = this.registry.constructor.hash(narrationText)

    if (!hash || hash === this.registry.constructor.hash('')) {
      return { pass: false, hash, reason: 'EMPTY_SCRIPT', duplicateOf: null }
    }

    const duplicateOf = this.registry.state.scripts[hash] || null
    const isDup = this.registry.isScriptDuplicate(hash)

    if (isDup) {
      return {
        pass: false,
        hash,
        reason: `SCRIPT_DUPLICATE: hash=${hash} previously used (${duplicateOf?.usageCount || 0}x)`,
        duplicateOf,
      }
    }

    return { pass: true, hash, reason: null, duplicateOf: null }
  }

  /**
   * Record a validated script as used (call after PUBLISH succeeds).
   */
  record(narrationText, context = {}) {
    const hash = this.registry.constructor.hash(narrationText)
    this.registry.recordScript(hash, context)
    return hash
  }
}
