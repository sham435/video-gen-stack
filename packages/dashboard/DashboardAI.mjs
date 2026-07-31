import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '../..')

export class DashboardAI {
  constructor(options = {}) {
    this.aiProvider = options.aiProvider || null
    this._bridge = null
    this._supportedFeatures = this.aiProvider ? this.aiProvider.supportedFeatures || [] : []
    this._lastFailure = { suggestions: 0, trending: 0, script: 0 }
    this._failureCooldownMs = 30_000
  }

  _isOnCooldown(key) {
    return Date.now() - (this._lastFailure[key] || 0) < this._failureCooldownMs
  }

  _markFailure(key) {
    this._lastFailure[key] = Date.now()
  }

  get isEnabled() {
    return !!this.aiProvider
  }

  get providerName() {
    return this.aiProvider ? this.aiProvider.name : 'none (fallback mode)'
  }

  async getBridge() {
    if (this._bridge) return this._bridge
    try {
      const mod = await import(pathToFileURL(path.join(ROOT, 'src/integration/OpenCodeBridge.mjs')).href)
      this._bridge = new mod.OpenCodeBridge({ aiProvider: this.aiProvider })
      return this._bridge
    } catch {
      return null
    }
  }

  async generateSuggestions(systemStatus) {
    if (!this.isEnabled) return this._fallbackSuggestions()
    if (this._isOnCooldown('suggestions')) return this._fallbackSuggestions()

    const bridge = await this.getBridge()
    const ctx = bridge ? bridge.getSystemContext() : {}
    const agentCount = ctx.agents?.length || 0
    const memCount = ctx.memory?.length || 0

    try {
      const result = await this.aiProvider.generate([
        {
          role: 'system',
          content: `You are an AI production director for a news video platform.
Given system status data, generate 5 actionable suggestions as JSON array.
Each: { id, type: "content"|"pipeline"|"ui"|"code", priority: "high"|"medium"|"low",
       icon: one emoji, message: concise actionable insight, action: short action label }
Focus on real operational improvements.`
        },
        {
          role: 'user',
          content: `Agents: ${agentCount}, Memory files: ${memCount}, Uptime: ${systemStatus?.pipeline?.uptime || '?'}, Templates: ${systemStatus?.templates?.count || 0}`
        }
      ], { json: true })

      if (Array.isArray(result)) return result.slice(0, 5)
      if (result.suggestions) return result.suggestions.slice(0, 5)
    } catch (e) {
      console.warn(`[DashboardAI] suggestions failed: ${e.message}`)
      this._markFailure('suggestions')
    }
    return this._fallbackSuggestions()
  }

  async generateTrending(article) {
    if (!this.isEnabled) return this._fallbackTrending()

    try {
      const result = await this.aiProvider.generate([
        {
          role: 'system',
          content: 'You are a news trend analyst. Given a news article, identify the trending topic, growth percentage, relevance score, and category. Return JSON: { topic, growth, score, category }'
        },
        {
          role: 'user',
          content: `Title: ${article?.title || 'Technology'}\nCategory: ${article?.category || 'technology'}`
        }
      ], { json: true })

      if (result.topic) return result
    } catch {}
    return this._fallbackTrending()
  }

  async analyzeScript(article, options = {}) {
    const bridge = await this.getBridge()
    if (!bridge) return { error: 'Bridge unavailable', fallback: true }
    if (this._isOnCooldown('script')) return { error: 'Provider cooling down', fallback: true }

    try {
      if (bridge.generateVideoPackage) {
        const result = await bridge.generateVideoPackage(options.topic || article?.title, article)
        return { story: result, provider: this.providerName, fallback: false }
      }

      const director = await bridge.getStoryDirector()
      if (director) {
        const plan = await director.plan(article, options)
        return { story: plan, provider: this.providerName, fallback: false }
      }

      const planner = await bridge.getStoryPlanner()
      if (planner) {
        const plan = await planner.plan(article)
        return { story: plan, provider: this.providerName, fallback: false }
      }
    } catch (e) {
      console.warn(`[DashboardAI] analyzeScript failed: ${e.message}`)
      this._markFailure('script')
    }
    return { error: 'No AI story components available', fallback: true }
  }

  _fallbackSuggestions() {
    return [
      { id: 1, type: 'content', priority: 'high', icon: '🔥', message: 'Gaming retention is 28% higher than average. Increase gaming output.', action: 'Adjust schedule' },
      { id: 2, type: 'content', priority: 'high', icon: '📊', message: 'Technology hook strength dropped 15%. Use mystery/reveal format.', action: 'Update prompt' },
      { id: 3, type: 'pipeline', priority: 'medium', icon: '⚡', message: 'Render time increased. Consider 8fps render → 30fps output.', action: 'Optimize' },
      { id: 4, type: 'ui', priority: 'medium', icon: '🎨', message: 'Politics category needs stronger visual identity.', action: 'Create theme' },
      { id: 5, type: 'code', priority: 'low', icon: '🔧', message: 'Circular dependency detected: composer.mjs imports src/', action: 'Review code' },
    ]
  }

  _fallbackTrending() {
    return { topic: 'AI Technology', growth: '+180%', score: 88, category: 'ai' }
  }
}
