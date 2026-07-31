import { AIProvider } from './AIProvider.mjs'

export class GeminiProvider extends AIProvider {
  constructor(apiKey, options = {}) {
    super()
    this.apiKey = apiKey || process.env.GEMINI_API_KEY
    this.model = options.model || 'gemini-2.0-flash'
    this.timeout = options.timeout || 30000
  }

  get name() {
    return `Gemini (${this.model})`
  }

  get supportedFeatures() {
    return ['chat', 'json-mode', 'free-tier']
  }

  buildContents(messages) {
    const parts = []
    for (const m of messages) {
      if (m.role === 'system') {
        parts.push({ role: 'user', parts: [{ text: `System instruction: ${m.content}` }] })
        parts.push({ role: 'model', parts: [{ text: 'Understood.' }] })
      } else if (m.role === 'user') {
        parts.push({ role: 'user', parts: [{ text: m.content }] })
      } else if (m.role === 'assistant') {
        parts.push({ role: 'model', parts: [{ text: m.content }] })
      }
    }
    return parts
  }

  async generate(messages, options = {}) {
    if (!this.apiKey) throw new Error('GEMINI_API_KEY not set')

    const contents = this.buildContents(messages)
    const model = options.model || this.model
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${this.apiKey}`

    const payload = {
      contents,
      generationConfig: {
        temperature: options.temperature ?? 0.7,
        maxOutputTokens: options.maxTokens || 4096,
      },
    }

    if (options.responseFormat === 'json' || options.json) {
      payload.generationConfig.response_mime_type = 'application/json'
    }

    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(options.timeout || this.timeout),
      })

      if (!res.ok) {
        const err = await res.text()
        throw new Error(`Gemini API error (${res.status}): ${err.slice(0, 200)}`)
      }

      const data = await res.json()
      const content = data.candidates?.[0]?.content?.parts?.[0]?.text
      if (!content) throw new Error('Gemini returned empty response')

      if (options.responseFormat === 'json' || options.json) {
        try { return JSON.parse(content) }
        catch { return content }
      }

      return content
    } catch (e) {
      throw new Error(`Gemini generate failed: ${e.message}`)
    }
  }
}
