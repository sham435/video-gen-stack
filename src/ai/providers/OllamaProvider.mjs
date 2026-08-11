import { AIProvider } from './AIProvider.mjs'
import { withRetry, ProviderError } from './retry.mjs'

export class OllamaProvider extends AIProvider {
  constructor(options = {}) {
    super()
    this.baseUrl = options.baseUrl || process.env.OLLAMA_URL || 'http://localhost:11434'
    this.model = options.model || process.env.OLLAMA_MODEL || 'qwen2.5-coder:7b'
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
    const model = options.model || this.model

    try {
      const res = await withRetry(async () => {
        const r = await fetch(`${this.baseUrl}/api/generate`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model,
            prompt,
            stream: false,
            options: {
              temperature: options.temperature ?? 0.7,
              num_predict: options.maxTokens || 4096,
            },
          }),
          signal: AbortSignal.timeout(options.timeout || this.timeout),
        })

        if (!r.ok) {
          const err = new Error(`Ollama API error (${r.status}): ${r.statusText}`)
          err.status = r.status
          // Ollama returns 404 when the model is not installed.
          if (r.status === 404) err.code = 'MODEL_NOT_FOUND'
          throw err
        }
        return r
      }, options)

      const data = await res.json()
      const content = data.response
      if (!content) {
        throw new ProviderError('Ollama returned empty response', { code: 'INVALID_RESPONSE', provider: 'Ollama', model })
      }

      if (options.responseFormat === 'json' || options.json) {
        try { return JSON.parse(content) }
        catch { return content }
      }

      return content
    } catch (e) {
      // Clear diagnostic when the default/requested model is unavailable.
      if (e.status === 404 || e.code === 'MODEL_NOT_FOUND') {
        e.message = `Ollama model "${model}" not found. Run: ollama pull ${model}`
        e.code = 'MODEL_NOT_FOUND'
      }
      if (e instanceof ProviderError) throw e
      throw new ProviderError(`Ollama generate failed: ${e.message}`, {
        provider: 'Ollama', model,
        status: e.status ?? undefined, code: e.code ?? undefined, cause: e,
      })
    }
  }
}
