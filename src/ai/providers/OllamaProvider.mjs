import { AIProvider } from './AIProvider.mjs'

export class OllamaProvider extends AIProvider {
  constructor(options = {}) {
    super()
    this.baseUrl = options.baseUrl || process.env.OLLAMA_URL || 'http://localhost:11434'
    this.model = options.model || process.env.OLLAMA_MODEL || 'qwen3-coder:30b'
    this.timeout = options.timeout || 60000
  }

  get name() {
    return `Ollama (${this.model})`
  }

  get supportedFeatures() {
    return ['chat', 'local']
  }

  buildPrompt(messages) {
    const systemMsg = messages.find(m => m.role === 'system')
    const userMsgs = messages.filter(m => m.role === 'user' || m.role === 'assistant')
    const parts = []
    if (systemMsg) parts.push(`System: ${systemMsg.content}`)
    for (const m of userMsgs) {
      parts.push(`${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content}`)
    }
    parts.push('Assistant:')
    return parts.join('\n\n')
  }

  async generate(messages, options = {}) {
    const prompt = this.buildPrompt(messages)

    try {
      const res = await fetch(`${this.baseUrl}/api/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: options.model || this.model,
          prompt,
          stream: false,
          options: {
            temperature: options.temperature ?? 0.7,
            num_predict: options.maxTokens || 4096,
          },
        }),
        signal: AbortSignal.timeout(options.timeout || this.timeout),
      })

      if (!res.ok) {
        throw new Error(`Ollama API error (${res.status}): ${res.statusText}`)
      }

      const data = await res.json()
      const content = data.response
      if (!content) throw new Error('Ollama returned empty response')

      if (options.responseFormat === 'json' || options.json) {
        try { return JSON.parse(content) }
        catch { return content }
      }

      return content
    } catch (e) {
      throw new Error(`Ollama generate failed: ${e.message}`)
    }
  }
}
