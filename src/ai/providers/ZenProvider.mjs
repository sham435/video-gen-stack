import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { AIProvider } from './AIProvider.mjs'
import { withRetry, ProviderError } from './retry.mjs'
import { classifyModelUnavailable } from './modelHealth.mjs'
import { LiveModelCatalog } from './LiveModelCatalog.mjs'

const ZEN_MODELS = {
  'deepseek-v4-flash-free': 'deepseek-v4-flash-free',
  'big-pickle': 'big-pickle',
  'minimax-m3-free': 'minimax-m3-free',
  'mimo-v2.5-free': 'mimo-v2.5-free',
  'nemotron-3-ultra-free': 'nemotron-3-ultra-free',
  'north-mini-code-free': 'north-mini-code-free',
  'qwen3.6-plus-free': 'qwen3.6-plus-free',
}

function readZenConfig() {
  try {
    const candidates = [
      path.join(os.homedir(), '.config/opencode/opencode.json'),
    ]
    for (const f of candidates) {
      if (fs.existsSync(f)) {
        const cfg = JSON.parse(fs.readFileSync(f, 'utf-8'))
        const key = cfg.provider?.zen?.options?.apiKey
        if (key) return key
      }
    }
  } catch { /* ignore */ }
  return null
}

export class ZenProvider extends AIProvider {
  constructor(apiKey, options = {}) {
    super()
    this.apiKey = apiKey || process.env.ZEN_API_KEY || readZenConfig()
    this.baseUrl = options.baseUrl || process.env.ZEN_BASE_URL || 'https://opencode.ai/zen/v1'
    this.model = options.model || process.env.ZEN_MODEL || 'deepseek-v4-flash-free'
    this.timeout = options.timeout || 60000
    // Bounded model-rotation budget: initial + this many fallback models.
    this.maxModelFallbacks = options.maxModelFallbacks ?? 3
    // Zen model registry is the repository's existing model list (ZEN_MODELS).
    // The catalog uses a live /models fetch with registry merge — surfaces newly
    // added free models without manual updates. big-pickle is a FREE OpenCode
    // Zen model whose id carries no free marker, so it is declared via knownFree
    // (free-tier member; survives the FOSS registry gate).
    this.catalog = options.catalog || new LiveModelCatalog({
      name: 'zen',
      catalogUrl: `${this.baseUrl}/models`,
      registry: Object.keys(ZEN_MODELS),
      apiKey: this.apiKey,
      mergeRegistry: true,
      preferFree: options.preferFree !== false, // free tier first; FOSS fallback; never paid-proprietary
      registryFossOnly: true,                    // curated ZEN_MODELS restricted to FOSS subset
      knownFree: options.knownFree?.length ? options.knownFree : ['big-pickle'],
      preferredFirst: options.preferredModels?.length ? options.preferredModels : [this.model],
      healthFilePath: options.healthFilePath !== undefined ? options.healthFilePath : 'data/zen-model-health.json',
    })
    this._lastModel = this.model
  }

  get name() {
    return `Zen (${this.model})`
  }

  get supportedFeatures() {
    return ['chat', 'json-mode', 'free']
  }

  get lastModel() {
    return this._lastModel
  }

  async generate(messages, options = {}) {
    if (!this.apiKey) throw new Error('ZEN_API_KEY not set (zen provider key)')

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
        console.warn(`[PROVIDER_FALLBACK] failed_provider=Zen failed_model=${startModel} status=? reason=PERSISTED_DEAD replacement_provider=Zen replacement_model=${current} fallback_attempt=0 remaining_eligible=?`)
      }
    }

    for (let attempt = 0; attempt <= this.maxModelFallbacks; attempt++) {
      try {
        const result = await this._requestOnce(messages, options, current)
        this._lastModel = current
        return result
      } catch (e) {
        const unavailable = e?.modelUnavailable === true
        if (unavailable) {
          this.catalog.markDead(current, e.modelUnavailableReason || 'MODEL_UNAVAILABLE', e.status)
          const remaining = await this.catalog.availableModels(tried)
          const next = remaining[0] ?? null
          console.warn(
            `[PROVIDER_FALLBACK] failed_provider=Zen failed_model=${current} status=${e.status ?? '?'} reason=${e.modelUnavailableReason ?? 'MODEL_UNAVAILABLE'} replacement_provider=Zen replacement_model=${next ?? 'none'} fallback_attempt=${attempt + 1} remaining_eligible=${remaining.length}`
          )
          if (!next) {
            const err = new ProviderError(
              `Zen: no eligible free model remains after ${attempt + 1} attempt(s) (last: ${current})`,
              { provider: 'Zen', model: current, status: e.status ?? undefined, code: 'MODEL_EXHAUSTED', cause: e, retriable: false }
            )
            throw err
          }
          tried.add(current)
          current = next
          this._lastModel = next
          continue
        }
        if (e instanceof ProviderError) throw e
        const model = current
        throw new ProviderError(`Zen generate failed: ${e.message}`, {
          provider: 'Zen', model,
          status: e.status ?? undefined, code: e.code ?? undefined, cause: e,
        })
      }
    }

    const err = new ProviderError(
      `Zen: exceeded model fallback budget (${this.maxModelFallbacks + 1} attempts)`,
      { provider: 'Zen', model: current, code: 'MODEL_EXHAUSTED', retriable: false }
    )
    throw err
  }

  async _requestOnce(messages, options, model) {
    const payload = {
      model,
      messages,
      temperature: options.temperature ?? 0.7,
      max_tokens: options.maxTokens || 4096,
    }

    if (options.responseFormat === 'json' || options.json) {
      payload.response_format = { type: 'json_object' }
    }

    try {
      const res = await withRetry(async () => {
        const r = await fetch(`${this.baseUrl}/chat/completions`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${this.apiKey}`,
            'Content-Type': 'application/json',
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
            const err = new ProviderError(
              `Zen model unavailable (${dead.reason}): ${bodyText.slice(0, 240) || r.statusText}`,
              {
                provider: 'Zen', model,
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
          const err = new Error(`Zen API error (${r.status}): ${bodyText.slice(0, 200)}`)
          err.status = r.status
          throw err
        }
        return r
      }, options)

      const data = await res.json()
      const content = data.choices?.[0]?.message?.content
      if (!content) {
        throw new ProviderError('Zen returned empty response', { code: 'INVALID_RESPONSE', provider: 'Zen', model })
      }

      if (options.responseFormat === 'json' || options.json) {
        try { return JSON.parse(content) }
        catch { return content }
      }

      return content
    } catch (e) {
      if (e instanceof ProviderError) throw e
      throw new ProviderError(`Zen generate failed: ${e.message}`, {
        provider: 'Zen', model,
        status: e.status ?? undefined, code: e.code ?? undefined, cause: e,
      })
    }
  }
}