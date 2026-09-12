// QuoteLineAgent — line-4 generator for the "Shelter in Rain" engagement-quote
// format. Sibling of CreativeDirectorAgent.mjs: same provider-chain pattern
// (resolveProviders → ProviderChain incl. OpenCode Zen big-pickle), same
// parseStructured validation, same graceful fallback — but for a single
// variable closing line instead of a per-scene brief.
//
// Uniqueness: reuses the EXISTING narration dedup gate (ScriptUniqueness +
// AssetRegistry, PR #192) — no new store. Previously generated line-4 values
// are recorded through the same ledger, so cross-video repeats are rejected
// (exact hash + semantic similarity) exactly like narration. Only the VARIABLE
// line is checked/recorded: lines 1–3 are constants by design, so comparing
// the full script would false-positive forever.
//
// Fail closed: the provider chain is the PRIMARY path — it includes the
// working OpenCode Zen big-pickle route (existing resolveProviders
// abstraction). The deterministic seed-pool is a LAST-RESORT fail-safe used
// ONLY when every backend genuinely fails (dead/rate-limited) or no provider
// is configured. If no unique line can be produced, the agent throws rather
// than reuse a duplicate.

import { ScriptUniqueness } from '../../uniqueness/ScriptUniqueness.mjs'
import { parseStructured } from '../../ai/parseStructured.mjs'

// ── Spec-fixed lines 1–3 (constant across every video in this format) ──

export const QUOTE_LINES_FIXED = [
  'The power of never giving up.',
  'Have you ever built shelter in rain?',
  'Comment your story.',
]

const LINE4_SCHEMA = { line4: 'string' }

// Deterministic LAST-RESORT pool (only when the chain genuinely fails — every
// backend dead or rate-limited, or no provider configured). Seeded by jobId so
// reruns of the same job do not silently change content; uniqueness is still
// enforced against the registry before acceptance.
export const FALLBACK_POOL = [
  "What's the one thing you refuse to quit?",
  'Where do you find shelter when the storm hits?',
  'What would you build if nobody was watching?',
  'Tell me: what kept you going?',
  'What does your shelter look like?',
  'What did you hold on to in the hardest rain?',
  'Who taught you to keep going?',
  'What is the strongest thing you built in the rain?',
  'What would you tell your past self today?',
  'What keeps your hope dry when it pours?',
]

function seededPick(pool, seed) {
  let h = 0x811c9dc5
  for (let i = 0; i < String(seed).length; i++) {
    h ^= String(seed).charCodeAt(i)
    h = (h * 0x01000193) >>> 0
  }
  return pool[h % pool.length]
}

export class QuoteLineAgent {
  /**
   * @param {object|null} provider   ProviderChain (or any {generate}) — null disables LLM.
   * @param {import('../../uniqueness/AssetRegistry.mjs').AssetRegistry} registry  shared narration/asset ledger.
   */
  constructor(provider, registry) {
    this.provider = provider
    this.scriptCheck = registry ? new ScriptUniqueness(registry) : null
    this._rejected = []
  }

  get fixedLines() {
    return [...QUOTE_LINES_FIXED]
  }

  /**
   * Produce a unique line 4.
   * @param {object} opts {excludeJobId, topic, attempts}
   * @returns {Promise<{line4:string, source:'llm'|'fallback', tries:number}>}
   */
  async generate({ excludeJobId = null, topic = 'shelter and resilience', attempts = 4 } = {}) {
    if (this.provider) {
      let llmProducedCandidates = false
      for (let i = 0; i < attempts; i++) {
        let line4 = null
        try {
          line4 = await this._askLlm({ topic, previousRejected: this._rejected })
        } catch (err) {
          // A dead/rate-limited provider chain must not kill the video — the
          // chain already tried every backend (it throws once they ALL fail).
          console.warn(`[QuoteLineAgent] LLM unavailable (${err?.message?.slice(0, 120)}); using deterministic pool`)
          break
        }
        if (!line4) continue
        llmProducedCandidates = true
        const verdict = this._check(line4, excludeJobId)
        if (verdict.pass) {
          return { line4: verdict.text, source: 'llm', tries: i + 1 }
        }
        this._rejected.push(line4)
      }
      if (llmProducedCandidates) {
        console.warn(`[QuoteLineAgent] LLM produced ${attempts} non-unique lines; falling back to seed pool`)
      }
    }

    // Deterministic pool fallback — still uniqueness-enforced.
    const seen = new Set()
    for (let i = 0; i < FALLBACK_POOL.length; i++) {
      const candidate = seededPick(FALLBACK_POOL, `${excludeJobId || 'quote'}|${i}`)
      if (seen.has(candidate)) continue
      seen.add(candidate)
      const verdict = this._check(candidate, excludeJobId)
      if (verdict.pass) {
        return { line4: verdict.text, source: 'fallback', tries: attempts + 1 }
      }
    }

    // Fail closed — never ship a duplicate line.
    throw new Error(`QuoteLineAgent: no unique line-4 available (${this._rejected.length} rejected as duplicates)`)
  }

  /**
   * Record an accepted line-4 into the shared narration ledger (post-publish).
   */
  record(line4, { jobId, videoId, title } = {}) {
    if (!this.scriptCheck) return null
    return this.scriptCheck.record(line4, { jobId, videoId, title, scriptText: line4 })
  }

  // ── Internal ──────────────────────────────────────────────────────────

  _check(line4, excludeJobId) {
    const text = String(line4 || '').trim().replace(/\s+/g, ' ')
    if (!text) return { pass: false, text: null }
    if (!this.scriptCheck) return { pass: true, text }
    const verdict = this.scriptCheck.validate(text, { excludeJobId, title: 'quote-line-4' })
    return verdict.pass ? { pass: true, text } : { pass: false, text: null, reason: verdict.reason }
  }

  async _askLlm({ topic, previousRejected }) {
    const prompt = this._buildPrompt({ topic, previousRejected })
    const raw = await this.provider.generate([{ role: 'user', content: prompt }], { json: true })
    const parsed = await parseStructured(raw, {
      schema: LINE4_SCHEMA,
      attempts: 1,
      generate: async (p) => this.provider.generate([{ role: 'user', content: p }], { json: true }),
      correct: (detail) =>
        `Your closing-line output had JSON errors. Fix these and return ONLY valid JSON: ${detail.errors ? detail.errors.join('; ') : detail.raw || 'invalid structure'}`,
    })
    return String(parsed?.line4 || '').trim().replace(/\s+/g, ' ')
  }

  _buildPrompt({ topic, previousRejected }) {
    const rejected = previousRejected.length
      ? `\nThese candidate lines were rejected as duplicates of previous videos — write something different:\n${previousRejected.map(l => `  - "${l}"`).join('\n')}`
      : ''
    return [
      'You write ONE short closing line for a comment-bait engagement video.',
      '',
      'The video already shows these three lines (do NOT repeat or rewrite them):',
      '  1. "The power of never giving up."',
      '  2. "Have you ever built shelter in rain?"',
      '  3. "Comment your story."',
      '',
      'Task — write line 4, a NEW closing line that:',
      '- is short (no more than 12 words)',
      '- is motivational, second-person ("you")',
      '- invites a comment: asks a question or prompts the viewer to share their story',
      '- matches the same register as lines 1-3',
      `- theme: ${topic || 'shelter and resilience'}`,
      rejected,
      '',
      'Return ONLY valid JSON: {"line4": "..."}',
    ].join('\n')
  }
}