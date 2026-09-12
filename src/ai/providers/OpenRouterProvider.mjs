import { AIProvider } from './AIProvider.mjs'
import { withRetry, ProviderError } from './retry.mjs'
import { classifyModelUnavailable } from './modelHealth.mjs'
import { LiveModelCatalog } from './LiveModelCatalog.mjs'

const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions'
const OPENROUTER_MODELS_URL = 'https://openrouter.ai/api/v1/models'

export class OpenRouterProvider extends AIProvider {
  constructor(apiKey, options = {}) {
    super()
    this.apiKey = apiKey || process.env.OPENROUTER_API_KEY
    this.model = options.model || process.env.LLM_MODEL || 'google/gemma-4-26b-a4b-it:free'
    this.referer = options.referer || 'https://github.com/sham435/video-gen-stack'
    this.timeout = options.timeout || 60000
    // Bounded model-rotation budget: initial + this many fallback models.
    this.maxModelFallbacks = options.maxModelFallbacks ?? 3
    // Live free-model catalog: queries OpenRouter /models, filters free,
    // excludes dead models, ranks preferred (project default) first.
    this.catalog = options.catalog || new LiveModelCatalog({
      name: 'openrouter',
      catalogUrl: OPENROUTER_MODELS_URL,
      apiKey: this.apiKey,
      preferFree: options.preferFree !== false, // free tier first; FOSS fallback; never paid-proprietary
      preferredFirst: options.preferredModels?.length ? options.preferredModels : [this.model],
      healthFilePath: options.healthFilePath !== undefined ? options.healthFilePath : 'data/openrouter-model-health.json',
      // Registry only used as fallback when live catalog fetch fails (never
      // hard-codes a single dead fallback model).
      bootstrap: options.bootstrapModels,
    })
    this._lastModel = this.model
  }

  get name() {
    return `OpenRouter (${this.model})`
  }

  get supportedFeatures() {
    return ['chat', 'json-mode']
  }

  // Rotating model name used by the most recent successful attempt (or last
  // attempted model). Diagnostics only.
  get lastModel() {
    return this._lastModel
  }

  async generate(messages, options = {}) {
    const startModel = options.model || this.model
    this._lastModel = startModel
    // Seed tried with the initial model so it is never re-selected after failure.
    const tried = new Set([startModel])
    // Skip a known-dead configured default (persisted from a prior run within
    // TTL) — do not blindly retry the same dead model across executions.
    let current = startModel
    if (this.catalog.isDead(current)) {
      current = (await this.catalog.availableModels(tried))[0] ?? current
      if (current !== startModel) {
        console.warn(`[PROVIDER_FALLBACK] failed_provider=OpenRouter failed_model=${startModel} status=? reason=PERSISTED_DEAD replacement_provider=OpenRouter replacement_model=${current} fallback_attempt=0 remaining_eligible=?`)
      }
    }

    // The reward / retry budget: initial attempt + at most maxModelFallbacks
    // model rotations. Bounded — never an infinite fallback loop.
    for (let attempt = 0; attempt <= this.maxModelFallbacks; attempt++) {
      try {
        const result = await this._requestOnce(messages, options, current)
        this._lastModel = current
        return result
      } catch (e) {
        const unavailable = e?.modelUnavailable === true
        if (unavailable) {
          // Genuine dead-model 400/404 — mark unavailable and rotate.
          this.catalog.markDead(current, e.modelUnavailableReason || 'MODEL_UNAVAILABLE', e.status)
          tried.add(current)
          const remaining = await this.catalog.availableModels(tried)
          const next = remaining[0] ?? null
          console.warn(
            `[PROVIDER_FALLBACK] failed_provider=OpenRouter failed_model=${current} status=${e.status ?? '?'} reason=${e.modelUnavailableReason ?? 'MODEL_UNAVAILABLE'} replacement_provider=OpenRouter replacement_model=${next ?? 'none'} fallback_attempt=${attempt + 1} remaining_eligible=${remaining.length}`
          )
          if (!next) {
            // Deterministic provider-exhausted failure — no eligible model remains.
            const err = new ProviderError(
              `OpenRouter: no eligible free model remains after ${attempt + 1} attempt(s) (last: ${current})`,
              { provider: 'OpenRouter', model: current, status: e.status ?? undefined, code: 'MODEL_EXHAUSTED', cause: e, retriable: false }
            )
            throw err
          }
          current = next
          this._lastModel = next
          continue
        }
        // NOT a dead-model error (auth, malformed request, transient, contract
        // violation, …) — preserve existing classification and propagate.
        if (e instanceof ProviderError) throw e
        const model = current
        throw new ProviderError(`OpenRouter generate failed: ${e.message}`, {
          provider: 'OpenRouter', model,
          status: e.status ?? undefined, code: e.code ?? undefined, cause: e,
        })
      }
    }

    const err = new ProviderError(
      `OpenRouter: exceeded model fallback budget (${this.maxModelFallbacks + 1} attempts)`,
      { provider: 'OpenRouter', model: current, code: 'MODEL_EXHAUSTED', retriable: false }
    )
    throw err
  }

  async _requestOnce(messages, options, model) {
    const payload = {
      model,
      messages,
      temperature: options.temperature ?? 0.7,
      max_tokens: options.maxTokens || 4096,
      stream: false,
    }

    if (options.responseFormat === 'json' || options.json) {
      payload.response_format = { type: 'json_object' }
    }

    try {
      const res = await withRetry(async () => {
        const r = await fetch(OPENROUTER_URL, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${this.apiKey}`,
            'Content-Type': 'application/json',
            'HTTP-Referer': this.referer,
          },
          body: JSON.stringify(payload),
          signal: AbortSignal.timeout(options.timeout || this.timeout),
        })
        if (!r.ok) {
          const bodyText = await r.text().catch(() => '')
          let errorBody = null
          try { errorBody = JSON.parse(bodyText)?.error ?? JSON.parse(bodyText) } catch { /* non-JSON */ }
          const dead = classifyModelUnavailable(r.status, bodyText, errorBody)
          if (dead.isModelUnavailable) {
            // Model-level 400/404 (dead/unsupported/retired) — rotation eligible.
            const err = new ProviderError(
              `OpenRouter model unavailable (${dead.reason}): ${bodyText.slice(0, 240) || r.statusText}`,
              {
                provider: 'OpenRouter', model,
                status: r.status,
                code: errorBody?.code && typeof errorBody.code === 'string' && errorBody.code !== `${r.status}`
                  ? errorBody.code : 'MODEL_UNAVAILABLE',
                modelUnavailable: true,
                modelUnavailableReason: dead.reason,
                bodyText,
                errorBody,
                retriable: false,
              }
            )
            throw err
          }
          const err = new Error(`OpenRouter API error (${r.status}): ${r.statusText} ${bodyText.slice(0, 200)}`)
          err.status = r.status
          // Honor Retry-After header from rate-limited responses (429).
          const retryAfter = r.headers?.get('retry-after')
          if (retryAfter) {
            const secs = parseInt(retryAfter, 10)
            if (Number.isFinite(secs) && secs > 0) err.retryAfterMs = secs * 1000
          }
          throw err
        }
        return r
      }, options)

      const data = await res.json()
      const content = data.choices?.[0]?.message?.content
      if (!content) {
        throw new ProviderError('OpenRouter returned empty response', { code: 'INVALID_RESPONSE', provider: 'OpenRouter', model })
      }

      if (options.responseFormat === 'json' || options.json) {
        try { return JSON.parse(content) }
        catch { return content }
      }

      return content
    } catch (e) {
      if (e instanceof ProviderError) throw e
      throw new ProviderError(`OpenRouter generate failed: ${e.message}`, {
        provider: 'OpenRouter', model,
        status: e.status ?? undefined, code: e.code ?? undefined, cause: e,
      })
    }
  }
}