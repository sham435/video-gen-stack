// AiStrategyLayer — LLM-based strategy optimization via existing ProviderChain.
//
// Architecture:
//   AiStrategyLayer
//        ↓
//   existing ProviderChain (Gemini, OpenAI, OpenRouter, Zen, Ollama)
//        ↓
//   StrategyRecommendation[]
//
// AI is advisory. Deterministic StrategyValidator has final say.
// AI failure never stops safe production.
//
// The layer:
// 1. Builds a prompt from StrategyContextBuilder output
// 2. Calls the provider chain (with timeout)
// 3. Parses structured JSON response
// 4. Validates response shape (schema + field allowlist)
// 5. Returns validated recommendations or empty array on failure

const STRATEGY_SYSTEM_PROMPT = `You are a production strategy advisor for a news video pipeline.
Given the article, niche, profile, and production history, recommend strategy adjustments.

RULES:
- Only recommend fields from the allowlist below.
- Each recommendation must have: field, suggestedValue, confidence (0-1), reason.
- Do NOT recommend changes to quality thresholds, niche resolution, or provider credentials.
- Do NOT lower mandatory quality gates.
- Base recommendations on data patterns, not speculation.
- If insufficient data, return empty recommendations.

ALLOWED FIELDS:
- hookStrategy.style: "breaking" | "reveal" | "curiosity" | "shock" | "data"
- thumbnailStrategy.layout: "breaking" | "premium-tech" | "futuristic-tech" | "automotive-tech" | "bold" | "cinematic" | "data"
- sceneStrategy.density: "low" | "medium" | "high"
- sceneStrategy.motion: "smooth" | "dynamic" | "fast"
- musicStrategy.mood: "cinematic" | "energetic" | "ambient" | "tense" | "dramatic" | "neutral"
- musicStrategy.tone: "excited" | "analytical" | "authoritative"
- visualStrategy.composition: "wide" | "medium" | "close"
- visualStrategy.searchQuery: string (enriched search query for image acquisition)

OUTPUT FORMAT (strict JSON):
{
  "recommendations": [
    {
      "field": "hookStrategy.style",
      "suggestedValue": "reveal",
      "confidence": 0.78,
      "reason": "reveal outperforms breaking for this niche based on historical retention data"
    }
  ]
}

If no improvements are warranted, return: { "recommendations": [] }`

const RECOMMENDATION_SCHEMA_FIELDS = new Set([
  'field',
  'suggestedValue',
  'confidence',
  'reason',
])

const ALLOWED_FIELDS = new Set([
  'hookStrategy.style',
  'thumbnailStrategy.layout',
  'sceneStrategy.density',
  'sceneStrategy.motion',
  'musicStrategy.mood',
  'musicStrategy.tone',
  'visualStrategy.composition',
  'visualStrategy.searchQuery',
])

export class AiStrategyLayer {
  /**
   * @param {object} opts
   * @param {object} [opts.providerChain] — ProviderChain instance (from existing providers)
   * @param {number} [opts.timeoutMs] — per-call timeout (default 15s)
   */
  constructor(opts = {}) {
    this.providerChain = opts.providerChain || null
    this.timeoutMs = opts.timeoutMs || 15000
  }

  get available() {
    return this.providerChain != null
  }

  /**
   * Request AI strategy recommendations.
   *
   * @param {object} context — from StrategyContextBuilder.build()
   * @returns {{ recommendations: object[], provider: string|null, latencyMs: number, error: string|null }}
   */
  async optimize(context) {
    if (!this.providerChain) {
      return { recommendations: [], provider: null, latencyMs: 0, error: 'no provider chain available' }
    }

    const start = Date.now()

    try {
      const messages = [
        { role: 'system', content: STRATEGY_SYSTEM_PROMPT },
        { role: 'user', content: `Production context:\n${JSON.stringify(context, null, 2)}` },
      ]

      const raw = await this.providerChain.generate(messages, {
        json: true,
        temperature: 0.4,
        maxTokens: 2048,
        timeout: this.timeoutMs,
      })

      const latencyMs = Date.now() - start
      const parsed = this._parseResponse(raw)

      if (!parsed) {
        return { recommendations: [], provider: this._providerName(), latencyMs, error: 'failed to parse AI response' }
      }

      const validated = this._validateRecommendations(parsed)
      return {
        recommendations: validated,
        provider: this._providerName(),
        latencyMs,
        error: null,
      }
    } catch (e) {
      const latencyMs = Date.now() - start
      return {
        recommendations: [],
        provider: this._providerName(),
        latencyMs,
        error: e.message || String(e),
      }
    }
  }

  _providerName() {
    try {
      return this.providerChain?.name || null
    } catch {
      return null
    }
  }

  _parseResponse(raw) {
    if (!raw) return null

    // If already an object (provider returned parsed JSON)
    if (typeof raw === 'object' && raw !== null) {
      return raw
    }

    // If string, try to parse JSON
    if (typeof raw === 'string') {
      // Extract JSON from possible markdown code fences
      const jsonMatch = raw.match(/```(?:json)?\s*([\s\S]*?)```/)
      const jsonStr = jsonMatch ? jsonMatch[1].trim() : raw.trim()

      try {
        return JSON.parse(jsonStr)
      } catch {
        // Try to find JSON object in the response
        const braceMatch = jsonStr.match(/\{[\s\S]*\}/)
        if (braceMatch) {
          try { return JSON.parse(braceMatch[0]) } catch { /* fall through */ }
        }
      }
    }

    return null
  }

  _validateRecommendations(parsed) {
    if (!parsed || typeof parsed !== 'object') return []
    if (!Array.isArray(parsed.recommendations)) return []

    const valid = []
    for (const rec of parsed.recommendations) {
      if (!rec || typeof rec !== 'object') continue

      // Check required fields exist with correct types
      let validShape = true
      for (const field of RECOMMENDATION_SCHEMA_FIELDS) {
        if (rec[field] === undefined || rec[field] === null) {
          validShape = false
          break
        }
      }
      if (!validShape) continue

      // Field must be in allowlist
      if (!ALLOWED_FIELDS.has(rec.field)) continue

      // Confidence must be 0-1
      if (typeof rec.confidence === 'number' && (rec.confidence < 0 || rec.confidence > 1)) continue

      // suggestedValue must be a string (for all current fields)
      if (typeof rec.suggestedValue !== 'string') continue

      valid.push({
        field: String(rec.field),
        suggestedValue: String(rec.suggestedValue),
        confidence: typeof rec.confidence === 'number' ? rec.confidence : 0.5,
        reason: String(rec.reason || '').slice(0, 300),
      })
    }

    return valid
  }
}
