// StrategyContextBuilder — assembles a safe, explicit context bundle for AI strategy.
//
// Architecture rule:
//   Build a SAFE context object from EXPLICITLY SELECTED fields.
//   Never pass secrets, API keys, OAuth tokens, private certificates,
//   or credentials to the AI model.
//
// Do not serialize a giant object and redact after the fact.
// Every field in the output is intentionally chosen.

export class StrategyContextBuilder {
  /**
   * Build a context bundle for AI strategy optimization.
   *
   * @param {object} inputs
   * @param {object} inputs.article — the article being produced
   * @param {object} inputs.nicheDecision — { key, source, confidence }
   * @param {object} inputs.profile — CategoryProductionProfile
   * @param {object} [inputs.performanceMemory] — PerformanceMemory instance
   * @param {object} [inputs.assetRegistry] — AssetRegistry instance
   * @param {object} [inputs.resourceGovernor] — ResourceGovernor instance
   * @param {string} [inputs.currentVideoId] — current content id
   * @returns {object} safe context bundle
   */
  static build(inputs) {
    const ctx = {
      article: StrategyContextBuilder._safeArticle(inputs.article),
      niche: StrategyContextBuilder._safeNiche(inputs.nicheDecision),
      profile: StrategyContextBuilder._safeProfile(inputs.profile),
      productionHistory: StrategyContextBuilder._safeProductionHistory(inputs.performanceMemory),
      assetState: StrategyContextBuilder._safeAssetState(inputs.assetRegistry),
      quotaState: StrategyContextBuilder._safeQuotaState(inputs.resourceGovernor),
      timestamp: new Date().toISOString(),
    }

    return ctx
  }

  static _safeArticle(article) {
    if (!article || typeof article !== 'object') return null
    return {
      title: String(article.title || '').slice(0, 200),
      description: String(article.description || '').slice(0, 500),
      category: String(article.category || ''),
      source: String(article.source || ''),
    }
  }

  static _safeNiche(decision) {
    if (!decision || typeof decision !== 'object') return null
    return {
      key: String(decision.key || ''),
      source: String(decision.source || ''),
      confidence: typeof decision.confidence === 'number' ? decision.confidence : 0,
    }
  }

  static _safeProfile(profile) {
    if (!profile || typeof profile !== 'object') return null
    return {
      hookStyle: String(profile.hookStyle || ''),
      coverStyle: String(profile.coverStyle || ''),
      visualDensity: String(profile.visualDensity || ''),
      motion: String(profile.motion || ''),
      tone: String(profile.tone || ''),
      preferredVisuals: Array.isArray(profile.preferredVisuals) ? [...profile.preferredVisuals] : [],
    }
  }

  static _safeProductionHistory(memory) {
    if (!memory || typeof memory !== 'object') {
      return { available: false, summary: 'performance memory not available' }
    }

    try {
      const result = { available: true }

      // Niche stats
      const nicheStats = typeof memory.nicheStats === 'function' ? memory.nicheStats() : null
      if (nicheStats && typeof nicheStats === 'object') {
        result.nichePerformance = {}
        for (const [niche, stats] of Object.entries(nicheStats)) {
          result.nichePerformance[niche] = {
            grade: stats.grade || 'N/A',
            sampleCount: stats.sampleCount || 0,
            avgCtr: stats.avgCtr,
            avgRetention: stats.avgRetention,
          }
        }
      }

      // Hook stats
      const hookStats = typeof memory.hookStats === 'function' ? memory.hookStats() : null
      if (hookStats && typeof hookStats === 'object') {
        result.hookPerformance = {}
        for (const [style, stats] of Object.entries(hookStats)) {
          result.hookPerformance[style] = {
            grade: stats.grade || 'N/A',
            sampleCount: stats.sampleCount || 0,
            avgRetention: stats.avgRetention,
          }
        }
      }

      // Thumbnail stats
      const thumbStats = typeof memory.thumbnailStats === 'function' ? memory.thumbnailStats() : null
      if (thumbStats && typeof thumbStats === 'object') {
        result.thumbnailPerformance = {}
        for (const [style, stats] of Object.entries(thumbStats)) {
          result.thumbnailPerformance[style] = {
            grade: stats.grade || 'N/A',
            sampleCount: stats.sampleCount || 0,
            avgCtr: stats.avgCtr,
          }
        }
      }

      // Recent observations (last 10 — no full objects, just summary fields)
      const recent = typeof memory.recent === 'function' ? memory.recent(10) : []
      result.recentVideos = (Array.isArray(recent) ? recent : []).map(obs => ({
        niche: obs.niche || null,
        hookStyle: obs.hookStyle || null,
        thumbnailStyle: obs.thumbnailStyle || null,
        success: obs.success !== false,
        views: obs.analytics?.views || 0,
        retention: obs.analytics?.avgPercentViewed || 0,
      }))

      return result
    } catch (e) {
      return { available: false, summary: `memory read failed: ${e.message}` }
    }
  }

  static _safeAssetState(registry) {
    if (!registry || typeof registry !== 'object') {
      return { available: false }
    }

    try {
      if (typeof registry.getStats === 'function') {
        return { available: true, ...registry.getStats() }
      }
      return { available: false }
    } catch {
      return { available: false }
    }
  }

  static _safeQuotaState(governor) {
    if (!governor || typeof governor !== 'object') {
      return { available: false }
    }

    try {
      if (typeof governor.statusAll === 'function') {
        const status = governor.statusAll()
        if (!status || typeof status !== 'object') return { available: false }

        // Extract only quota-relevant fields — no tokens, no secrets
        const safe = {}
        for (const [provider, info] of Object.entries(status)) {
          if (typeof info !== 'object' || !info) continue
          safe[provider] = {
            daily: info.budget?.daily ?? null,
            dailyUsed: info.dailyUsed ?? null,
            monthly: info.budget?.monthly ?? null,
            monthlyUsed: info.monthlyUsed ?? null,
          }
        }
        return { available: true, providers: safe }
      }
      return { available: false }
    } catch {
      return { available: false }
    }
  }

  /**
   * Serialize context to JSON for LLM prompt.
   * @param {object} context — from build()
   * @returns {string}
   */
  static serialize(context) {
    return JSON.stringify(context, null, 2)
  }
}
