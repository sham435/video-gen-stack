import { AIProvider } from './AIProvider.mjs'

const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions'

export class OpenRouterProvider extends AIProvider {
  constructor(apiKey, options = {}) {
    super()
    this.apiKey = apiKey || process.env.OPENROUTER_API_KEY
    this.model = options.model || process.env.LLM_MODEL || 'openrouter/auto'
    this.referer = options.referer || 'https://github.com/sham435/video-gen-stack'
    this.timeout = options.timeout || 30000
  }

  get name() {
    return `OpenRouter (${this.model})`
  }

  get supportedFeatures() {
    return ['chat', 'json-mode']
  }

  async generate(messages, options = {}) {
    const payload = {
      model: options.model || this.model,
      messages,
      temperature: options.temperature ?? 0.7,
      max_tokens: options.maxTokens || 4096,
      stream: false,
    }

    if (options.responseFormat === 'json' || options.json) {
      payload.response_format = { type: 'json_object' }
    }

    try {
      const res = await fetch(OPENROUTER_URL, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
          'HTTP-Referer': this.referer,
        },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(options.timeout || this.timeout),
      })

      if (!res.ok) {
        throw new Error(`OpenRouter API error (${res.status}): ${res.statusText}`)
      }

      const data = await res.json()
      const content = data.choices?.[0]?.message?.content
      if (!content) throw new Error('OpenRouter returned empty response')

      if (options.responseFormat === 'json' || options.json) {
        try { return JSON.parse(content) }
        catch { return content }
      }

      return content
    } catch (e) {
      throw new Error(`OpenRouter generate failed: ${e.message}`)
    }
  }
}
