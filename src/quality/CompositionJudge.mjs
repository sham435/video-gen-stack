import { ProductionMemory } from '../pipeline/ProductionMemory.mjs'

// AI Composition Judge — evaluates overall production quality per scene.
//
// Unlike deterministic validators, this critiques the assembled scene:
// text overlap, safe zones, visual relevance, hook strength, readability,
// motion clarity. It scores each scene, lists issues, recommends an action,
// and — when ProductionMemory holds a known fix for a pattern — applies the
// remediation automatically so the pipeline stops producing that class of
// error.
//
// AI is best-effort: if the provider chain fails (quota, network), the
// judge degrades to a pure deterministic signal score. Never breaks the
// pipeline. Disable AI with COMPOSITION_JUDGE_AI=0.
export class CompositionJudge {
  constructor(options = {}) {
    this.threshold = options.threshold || 70
    this.memory = options.memory || null
    this.aiEnabled = options.aiEnabled !== false && process.env.COMPOSITION_JUDGE_AI !== '0'
    this.timeoutMs = options.timeoutMs || 25000
    this._chain = null
    // Known pattern → remediation applied directly to the scene object
    this.REMEDIATIONS = {
      caption_too_long: { fix: 'truncate_caption', apply: (sc, memory) => { sc.caption = String(sc.caption || '').slice(0, 38) } },
      emphasis_overload: { fix: 'reduce_emphasis', apply: (sc) => { if (Array.isArray(sc.textManifest?.emphasis)) sc.textManifest.emphasis = sc.textManifest.emphasis.slice(0, 2) } },
      caption_overlap: { fix: 'hide_caption', apply: (sc) => { sc.caption = ''; sc.captionHidden = true } },
    }
  }

  async _getChain() {
    if (this._chain) return this._chain
    const { ZenProvider } = await import('./providers/ZenProvider.mjs')
    const { OpenRouterProvider } = await import('./providers/OpenRouterProvider.mjs')
    const { OpenAIProvider } = await import('./providers/OpenAIProvider.mjs')
    const { GeminiProvider } = await import('./providers/GeminiProvider.mjs')
    const { OllamaProvider } = await import('./providers/OllamaProvider.mjs')
    const { ProviderChain } = await import('./providers/ProviderChain.mjs')

    const openaiKey = process.env.OPENAI_API_KEY || ''
    const openrouterKey = process.env.OPENROUTER_API_KEY || ''
    const isOpenRouterKey = (k) => k.startsWith('sk-or-v1')

    const providers = []
    try {
      const zen = new ZenProvider()
      if (zen.apiKey) providers.push(zen)
    } catch { /* skip */ }
    if (openrouterKey) providers.push(new OpenRouterProvider(openrouterKey))
    else if (isOpenRouterKey(openaiKey)) providers.push(new OpenRouterProvider(openaiKey))
    if (openaiKey && !isOpenRouterKey(openaiKey)) providers.push(new OpenAIProvider(openaiKey))
    if (process.env.GEMINI_API_KEY) providers.push(new GeminiProvider(process.env.GEMINI_API_KEY))
    try {
      const ollama = new OllamaProvider()
      const probe = await fetch(`${ollama.baseUrl}/api/tags`, { signal: AbortSignal.timeout(1200) })
      if (probe.ok) providers.push(ollama)
    } catch { /* skip */ }

    this._chain = providers.length ? new ProviderChain(providers) : null
    return this._chain
  }

  // Deterministic per-scene signals — the AI sees these, not raw scene objects
  _signals(scene) {
    const caption = scene.caption || ''
    const emphasis = Array.isArray(scene.textManifest?.emphasis) ? scene.textManifest.emphasis : []
    return {
      id: scene.id,
      type: scene.type,
      duration: scene.duration || scene.end - scene.start || 3,
      caption: caption.slice(0, 60),
      captionLen: caption.length,
      emphasisCount: emphasis.length,
      visualRelevance: scene.visualRelevanceScore ?? null,
      hookScore: scene.hookScore ?? null,
      hasVisual: !!(scene.image || scene.images?.length),
      cameraMotion: scene.camera || 'static',
      compositionFailed: scene.compositionScore ? scene.compositionScore.failed : [],
      motionClarity: scene.cameraPlan?.motion ? 'dynamic' : 'static',
    }
  }

  _deterministicScore(sig) {
    let score = 80
    const issues = []
    if (sig.captionLen > 40) { score -= 10; issues.push('caption_too_long') }
    if (sig.emphasisCount > 3) { score -= 8; issues.push('emphasis_overload') }
    if (sig.captionLen > 12 && sig.captionLen <= 40 && !sig.caption) score -= 5
    if (sig.visualRelevance != null && sig.visualRelevance < 55) { score -= 15; issues.push('visual_unrelated') }
    if (sig.type === 'hook' && sig.hookScore != null && sig.hookScore < 85) { score -= 15; issues.push('hook_weak') }
    if (!sig.hasVisual) { score -= 10; issues.push('missing_visual') }
    if (sig.duration < 1.5) { score -= 5; issues.push('scene_too_short') }
    if (sig.motionClarity === 'static' && sig.type === 'fact') { score -= 5; issues.push('static_motion') }
    if (Array.isArray(sig.compositionFailed) && sig.compositionFailed.includes('duplicateText')) { score -= 20; issues.push('duplicate_text') }
    if (sig.captionLen > 12 && sig.caption && sig.captionLen > 30) { score -= 3; issues.push('caption_overlap_risk') }
    return { score: Math.max(0, Math.min(99, score)), issues: [...new Set(issues)] }
  }

  async _aiCritique(signals, article) {
    const chain = await this._getChain()
    if (!chain) return null
    const result = await chain.generate([
      {
        role: 'system',
        content: `You are the AI Composition Judge for a vertical news Shorts pipeline. Evaluate ONE scene's overall production quality. Judge: text overlap, safe zone usage, face visibility, visual relevance to the headline, hook strength, readability, motion clarity, emphasis density.

Return strict JSON:
{
  "score": 0-99 integer,
  "issues": ["short issue codes like headline_over_face, caption_overlap, visual_unrelated, hook_weak, readability"],
  "recommendation": "regenerate_scene" | "accept" | "apply_fix"
}`,
      },
      {
        role: 'user',
        content: `Headline: ${article.title || ''}\nCategory: ${article.category || 'technology'}\nScene signals: ${JSON.stringify(signals)}`,
      },
    ], { json: true, timeout: this.timeoutMs })
    return typeof result?.score === 'number' ? result : null
  }

  // Memory-driven remediation: known pattern → apply preferred fix, learn.
  // Applied on first detection (deterministic safe fixes); memory keeps the
  // pattern + fix so the pipeline converges and stops producing the error.
  _remediate(scene, issues, score) {
    let appliedFix = null
    for (const issue of issues) {
      const rem = this.REMEDIATIONS[issue]
      if (!rem) continue
      if (this.memory) {
        const known = this.memory.lookup(issue)
        if (!known) {
          this.memory.learn(issue, { status: 'detected', introducedIn: 'V4', preventedBy: null, preferredFix: rem.fix })
        } else {
          this.memory.learn(issue, { status: 'resolved', introducedIn: 'V4', preventedBy: 'CompositionJudge', preferredFix: rem.fix })
        }
        rem.apply(scene, this.memory)
        appliedFix = rem.fix
      }
      break
    }
    if (appliedFix && this.memory) {
      this.memory.learn(appliedFix, { status: 'resolved', introducedIn: 'V4', preventedBy: 'CompositionJudge', preferredFix: null })
    }
    return appliedFix
  }

  async evaluate(scenes, article = {}) {
    const results = []
    const aiEnabled = this.aiEnabled
    for (const scene of scenes) {
      const sig = this._signals(scene)
      const det = this._deterministicScore(sig)

      let ai = null
      if (aiEnabled) {
        try { ai = await this._aiCritique(sig, article) } catch { ai = null }
      }

      let score = det.score
      let issues = det.issues
      let recommendation = score >= this.threshold ? 'accept' : 'regenerate_scene'
      if (ai) {
        score = Math.round((ai.score + det.score) / 2)
        issues = [...new Set([...det.issues, ...(Array.isArray(ai.issues) ? ai.issues : [])])]
        if (ai.recommendation === 'apply_fix' && score < this.threshold) recommendation = 'apply_fix'
        else if (ai.recommendation === 'regenerate_scene' && score < this.threshold) recommendation = 'regenerate_scene'
      }

      const appliedFix = this._remediate(scene, issues, score)
      if (appliedFix) recommendation = `applied:${appliedFix}`

      results.push({
        scene: scene.id,
        type: scene.type,
        score,
        issues,
        recommendation,
        appliedFix,
        passed: score >= this.threshold,
      })
    }

    const avg = results.length ? Math.round(results.reduce((s, r) => s + r.score, 0) / results.length) : 0
    const failed = results.filter(r => !r.passed)
    return { results, avg, failed, threshold: this.threshold, aiUsed: aiEnabled }
  }
}
