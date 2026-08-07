import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { AIProvider } from './AIProvider.mjs'
import { withRetry } from './retry.mjs'

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
  }

  get name() {
    return `Zen (${this.model})`
  }

  get supportedFeatures() {
    return ['chat', 'json-mode', 'free']
  }

  async generate(messages, options = {}) {
    if (!this.apiKey) throw new Error('ZEN_API_KEY not set (zen provider key)')

    const model = options.model || this.model
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
          const body = await r.text()
          const err = new Error(`Zen API error (${r.status}): ${body.slice(0, 200)}`)
          err.status = r.status
          throw err
        }
        return r
      }, options)

      const data = await res.json()
      const content = data.choices?.[0]?.message?.content
      if (!content) throw new Error('Zen returned empty response')

      if (options.responseFormat === 'json' || options.json) {
        try { return JSON.parse(content) }
        catch { return content }
      }

      return content
    } catch (e) {
      throw new Error(`Zen generate failed: ${e.message}`)
    }
  }
}
