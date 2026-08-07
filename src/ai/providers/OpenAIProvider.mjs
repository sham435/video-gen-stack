import { AIProvider } from './AIProvider.mjs'
import { withRetry } from './retry.mjs'

export class OpenAIProvider extends AIProvider {
  constructor(apiKey, options = {}) {
    super()
    this.apiKey = apiKey || process.env.OPENAI_API_KEY
    this.baseUrl = options.baseUrl || 'https://api.openai.com/v1'
    this.model = options.model || 'gpt-4o-mini'
    this.timeout = options.timeout || 30000
  }

  get name() {
    return `OpenAI (${this.model})`
  }

  get supportedFeatures() {
    return ['chat', 'json-mode', 'vision']
  }

  async generate(messages, options = {}) {
    const payload = {
      model: options.model || this.model,
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
          const err = new Error(`OpenAI API error (${r.status}): ${body.slice(0, 200)}`)
          err.status = r.status
          throw err
        }
        return r
      }, options)

      const data = await res.json()
      const content = data.choices?.[0]?.message?.content
      if (!content) throw new Error('OpenAI returned empty response')

      if (options.responseFormat === 'json' || options.json) {
        try { return JSON.parse(content) }
        catch { return content }
      }

      return content
    } catch (e) {
      throw new Error(`OpenAI generate failed: ${e.message}`)
    }
  }
}
