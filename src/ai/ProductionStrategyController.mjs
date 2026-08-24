// ProductionStrategyController — the strategic brain of autonomous production.
//
// Architecture rule:
//   AI = PLAN / OPTIMIZE / SELECT / LEARN
//   Deterministic code = VALIDATE / ENFORCE / EXECUTE / VERIFY
//
// The controller produces a ProductionPlan — a structured set of strategy
// decisions that downstream deterministic stages consume. It never executes
// production directly.
//
// Fallback chain:
//   AI recommendation → validated AI → memory optimization → CategoryProductionProfile → global defaults
//
// Consumes:
//   - Article/topic
//   - NicheDecision (from NicheResolver, resolve-once)
//   - CategoryProductionProfile (frozen registry + ProfileOptimizer overrides)
//   - PerformanceMemory (historical analytics per niche/hook/thumbnail)
//   - ResourceGovernor (quota state per provider)
//   - AssetRegistry (recent asset usage for diversity)
//   - AiStrategyLayer (optional — LLM-based strategy via ProviderChain)
//
// Produces:
//   - ProductionPlan (immutable strategy object)
//   - Decision trace (structured record of why this plan was selected)

import { getProfile } from '../production/CategoryProductionProfiles.mjs'
import { resolveNicheSync } from '../pipeline/NicheResolver.mjs'
import { StrategyValidator } from './StrategyValidator.mjs'
import { StrategyContextBuilder } from './StrategyContextBuilder.mjs'

const CONFIDENCE_THRESHOLD = 0.60
const MIN_SAMPLES_FOR_LEARNING = 3

// Fields that AI recommendations can modify
const AI_MODIFIABLE_FIELDS = new Set([
  'hookStrategy.style',
  'thumbnailStrategy.layout',
  'sceneStrategy.density',
  'sceneStrategy.motion',
  'musicStrategy.mood',
  'musicStrategy.tone',
  'visualStrategy.composition',
  'visualStrategy.searchQuery',
])

export class ProductionStrategyController {
  constructor(options = {}) {
    this.performanceMemory = options.performanceMemory || null
    this.profileOptimizer = options.profileOptimizer || null
    this.resourceGovernor = options.resourceGovernor || null
    this.assetRegistry = options.assetRegistry || null
    this.aiLayer = options.aiLayer || null
    this.now = options.now || (() => Date.now())
    this._decisionTrace = null
  }

  /**
   * Produce a complete ProductionPlan for a given article.
   *
   * @param {object} article — { title, description, category, imageUrl, publishedAt }
   * @param {object} opts — { existingNicheDecision, jobId }
   * @returns {ProductionPlan}
   */
  async planProduction(article, opts = {}) {
    const jobId = opts.jobId || `job-${Date.now()}`
    const startTime = this.now()

    // ── 1. Niche resolution (resolve-once invariant) ──
    const niche = opts.existingNicheDecision || resolveNicheSync(
      `${article.title || ''} ${article.description || ''}`,
      article.category
    )

    // ── 2. Profile selection with learned overrides ──
    const canonicalProfile = getProfile(niche.key)
    const profile = this.profileOptimizer
      ? this.profileOptimizer.getProfileWithOverrides(niche.key, canonicalProfile)
      : canonicalProfile

    // ── 3. Performance signals from memory ──
    const memorySignals = this._gatherMemorySignals(niche.key, profile)

    // ── 4. Base strategy decisions (deterministic fallback chain) ──
    const hookStrategy = this._selectHookStrategy(profile, memorySignals)
    const sceneStrategy = this._selectSceneStrategy(profile, memorySignals)
    const visualStrategy = this._selectVisualStrategy(profile, memorySignals, article)
    const musicStrategy = this._selectMusicStrategy(profile, memorySignals)
    const thumbnailStrategy = this._selectThumbnailStrategy(profile, memorySignals)
    const providerPreferences = this._selectProviderPreferences()
    const qualityTargets = this._selectQualityTargets(profile, memorySignals)
    const diversityConstraints = this._selectDiversityConstraints()

    // ── 5. AI optimization (if available) ──
    let plan = {
      jobId,
      niche: { key: niche.key, source: niche.source, confidence: niche.confidence },
      profile: { ...profile },
      hookStrategy,
      sceneStrategy,
      visualStrategy,
      musicStrategy,
      thumbnailStrategy,
      providerPreferences,
      qualityTargets,
      diversityConstraints,
      reasoning: '',
      confidence: 0,
      memorySignals: memorySignals.summary,
      rejectedStrategies: memorySignals.rejected,
      createdAt: new Date().toISOString(),
      planDurationMs: 0,
    }

    const decision = {
      source: memorySignals.bestHookStyle || memorySignals.bestThumbnailStyle ? 'memory_optimized' : 'profile',
      aiCalled: false,
      aiProvider: null,
      aiLatencyMs: 0,
      recommendationsReceived: 0,
      recommendationsAccepted: 0,
      recommendationsRejected: 0,
      rejectionReasons: [],
      fallbackUsed: false,
      validationPassed: true,
    }

    if (this.aiLayer && typeof this.aiLayer.optimize === 'function') {
      decision.aiCalled = true
      try {
        const context = StrategyContextBuilder.build({
          article,
          nicheDecision: niche,
          profile: canonicalProfile,
          performanceMemory: this.performanceMemory,
          assetRegistry: this.assetRegistry,
          resourceGovernor: this.resourceGovernor,
          currentVideoId: opts.currentVideoId || null,
        })

        const aiResult = await this.aiLayer.optimize(context)

        decision.aiProvider = aiResult.provider
        decision.aiLatencyMs = aiResult.latencyMs
        decision.recommendationsReceived = aiResult.recommendations.length

        if (aiResult.recommendations.length > 0) {
          // Apply valid AI recommendations to base strategy
          const { accepted, rejected } = this._applyRecommendations(plan, aiResult.recommendations)
          decision.recommendationsAccepted = accepted.length
          decision.recommendationsRejected = rejected.length
          decision.rejectionReasons = rejected.map(r => r.error || `rejected: ${r.rec?.field}`)

          if (accepted.length > 0) {
            decision.source = 'ai_optimized'
          }
        }

        if (aiResult.error) {
          decision.fallbackUsed = true
          decision.rejectionReasons.push(`ai_error: ${aiResult.error}`)
        }
      } catch (e) {
        decision.fallbackUsed = true
        decision.rejectionReasons.push(`ai_exception: ${e.message}`)
      }
    }

    // ── 6. Validate final plan ──
    const validation = StrategyValidator.validate(plan)
    if (!validation.valid) {
      // If AI changed anything and validation fails, strip AI changes
      if (decision.recommendationsAccepted > 0) {
        // Rebuild plan from deterministic base
        plan = this._rebuildDeterministicPlan(jobId, niche, profile, memorySignals, article)
        decision.recommendationsAccepted = 0
        decision.rejectionReasons.push('ai_recommendations_invalid: stripped and reverted to deterministic plan')
        decision.source = memorySignals.bestHookStyle || memorySignals.bestThumbnailStyle ? 'memory_optimized' : 'profile'

        // Re-validate the deterministic plan
        const revalidation = StrategyValidator.validate(plan)
        decision.validationPassed = revalidation.valid
        if (!revalidation.valid) {
          decision.fallbackUsed = true
        }
      } else {
        decision.validationPassed = false
        decision.fallbackUsed = true
      }
    }

    // ── 7. Finalize plan ──
    plan.reasoning = this._buildReasoning(niche, profile, memorySignals, {
      hookStrategy: plan.hookStrategy,
      sceneStrategy: plan.sceneStrategy,
      visualStrategy: plan.visualStrategy,
      musicStrategy: plan.musicStrategy,
      thumbnailStrategy: plan.thumbnailStrategy,
    }, decision)
    plan.confidence = this._computeConfidence(niche, memorySignals, decision)
    plan.planDurationMs = this.now() - startTime

    // Store decision trace for ProductionTrace
    this._decisionTrace = { ...decision, confidence: plan.confidence, memorySignals: memorySignals.summary }

    return Object.freeze(plan)
  }

  /**
   * Get the structured decision trace from the last planProduction() call.
   * @returns {object|null}
   */
  getDecisionTrace() {
    return this._decisionTrace
  }

  /**
   * Record production outcome for future learning.
   * Feeds results back into PerformanceMemory.
   */
  recordOutcome(plan, outcome) {
    if (!this.performanceMemory || !outcome?.videoId) return

    try {
      const observation = {
        videoId: outcome.videoId,
        articleId: plan.jobId,
        niche: plan.niche.key,
        publishedAt: new Date().toISOString(),
        hookStyle: plan.hookStrategy.style,
        thumbnailStyle: plan.thumbnailStrategy.layout,
        musicTrack: outcome.musicTrack || null,
        analytics: outcome.analytics || {},
        planConfidence: plan.confidence,
        success: outcome.success !== false,
      }
      this.performanceMemory.record(observation)
    } catch (e) {
      console.log(`[STRATEGY] recordOutcome failed (non-fatal): ${e.message}`)
    }
  }

  // ── AI recommendation application ──────────────────────────────────

  _applyRecommendations(plan, recommendations) {
    const accepted = []
    const rejected = []

    for (const rec of recommendations) {
      if (!AI_MODIFIABLE_FIELDS.has(rec.field)) {
        rejected.push({ rec, error: `field ${rec.field} not modifiable by AI` })
        continue
      }

      // Apply the recommendation
      const applied = this._applySingleRecommendation(plan, rec)
      if (applied) {
        accepted.push(rec)
      } else {
        rejected.push({ rec, error: `failed to apply ${rec.field}=${rec.suggestedValue}` })
      }
    }

    return { accepted, rejected }
  }

  _applySingleRecommendation(plan, rec) {
    const parts = rec.field.split('.')
    if (parts.length !== 2) return false

    const [section, key] = parts
    if (!plan[section] || typeof plan[section] !== 'object') return false

    plan[section] = { ...plan[section] }
    plan[section][key] = rec.suggestedValue
    plan[section].source = 'ai_optimized'
    plan[section].reason = `ai: ${rec.reason}`
    plan[section].confidence = rec.confidence

    return true
  }

  // ── Rebuild deterministic plan (strip all AI changes) ───────────────

  _rebuildDeterministicPlan(jobId, niche, profile, memorySignals, article) {
    return {
      jobId,
      niche: { key: niche.key, source: niche.source, confidence: niche.confidence },
      profile: { ...profile },
      hookStrategy: this._selectHookStrategy(profile, memorySignals),
      sceneStrategy: this._selectSceneStrategy(profile, memorySignals),
      visualStrategy: this._selectVisualStrategy(profile, memorySignals, article),
      musicStrategy: this._selectMusicStrategy(profile, memorySignals),
      thumbnailStrategy: this._selectThumbnailStrategy(profile, memorySignals),
      providerPreferences: this._selectProviderPreferences(),
      qualityTargets: this._selectQualityTargets(profile, memorySignals),
      diversityConstraints: this._selectDiversityConstraints(),
      reasoning: '',
      confidence: 0,
      memorySignals: memorySignals.summary,
      rejectedStrategies: memorySignals.rejected,
      createdAt: new Date().toISOString(),
      planDurationMs: 0,
    }
  }

  // ── Strategy selectors (each follows fallback chain) ─────────────────

  _selectHookStrategy(profile, memorySignals) {
    const profileStyle = profile.hookStyle || 'breaking'

    if (memorySignals.bestHookStyle && memorySignals.bestHookStyle !== profileStyle) {
      if (memorySignals.hookConfidence >= CONFIDENCE_THRESHOLD) {
        return {
          style: memorySignals.bestHookStyle,
          source: 'memory_optimized',
          reason: `memory shows ${memorySignals.bestHookStyle} outperforms ${profileStyle} for ${memorySignals.niche}`,
          confidence: memorySignals.hookConfidence,
        }
      }
    }

    return {
      style: profileStyle,
      source: 'profile',
      reason: `niche profile specifies ${profileStyle}`,
      confidence: 0.80,
    }
  }

  _selectSceneStrategy(profile, memorySignals) {
    const density = profile.visualDensity || 'medium'
    const motion = profile.motion || 'smooth'
    const sceneCount = density === 'high' ? 7 : density === 'low' ? 5 : 6
    const avgDuration = density === 'high' ? 3.5 : density === 'low' ? 5.0 : 4.0

    return {
      density,
      motion,
      sceneCount,
      avgDurationSec: avgDuration,
      totalDurationSec: sceneCount * avgDuration,
      source: 'profile',
      reason: `density=${density} motion=${motion} → ${sceneCount} scenes × ${avgDuration}s`,
      confidence: 0.85,
    }
  }

  _selectVisualStrategy(profile, memorySignals, article) {
    const preferredVisuals = profile.preferredVisuals || ['newsroom', 'technology']
    const articleKeywords = extractKeywords(article.title || '')
    const searchQuery = [...preferredVisuals.slice(0, 2), ...articleKeywords.slice(0, 2)].join(' ')

    return {
      searchQuery,
      preferredVisuals: [...preferredVisuals],
      diversityRequired: true,
      maxSimilarImages: 1,
      source: 'profile',
      reason: `preferred visuals: ${preferredVisuals.join(', ')}`,
      confidence: 0.80,
    }
  }

  _selectMusicStrategy(profile, memorySignals) {
    const tone = profile.tone || 'authoritative'
    const moodMap = { excited: 'energetic', analytical: 'ambient', authoritative: 'cinematic' }
    const mood = moodMap[tone] || 'cinematic'

    return {
      mood,
      tone,
      uniquenessRequired: true,
      fallbackTrack: 'default-cinematic',
      source: 'profile',
      reason: `tone=${tone} → mood=${mood}`,
      confidence: 0.85,
    }
  }

  _selectThumbnailStrategy(profile, memorySignals) {
    const coverStyle = profile.coverStyle || 'breaking'
    const hookStyle = profile.hookStyle || 'breaking'

    if (memorySignals.bestThumbnailStyle && memorySignals.thumbConfidence >= CONFIDENCE_THRESHOLD) {
      return {
        layout: memorySignals.bestThumbnailStyle,
        textStrategy: hookStyle,
        diversityRequired: true,
        minCandidates: 3,
        source: 'memory_optimized',
        reason: `memory shows ${memorySignals.bestThumbnailStyle} outperforms ${coverStyle}`,
        confidence: memorySignals.thumbConfidence,
      }
    }

    return {
      layout: coverStyle,
      textStrategy: hookStyle,
      diversityRequired: true,
      minCandidates: 3,
      source: 'profile',
      reason: `coverStyle=${coverStyle} hookStyle=${hookStyle}`,
      confidence: 0.80,
    }
  }

  _selectProviderPreferences() {
    const preferences = { ai: 'auto', rendering: 'local', tts: 'auto', imageSearch: 'auto' }

    if (this.resourceGovernor) {
      try {
        const govStatus = this.resourceGovernor.statusAll()
        if (govStatus?.gemini?.remaining?.daily <= 0) preferences.ai = 'ollama'
        if (govStatus?.elevenlabs?.remaining?.daily <= 0) preferences.tts = 'fallback'
      } catch { /* governor unavailable — use defaults */ }
    }

    return { ...preferences, source: 'governor_aware', confidence: 0.70 }
  }

  _selectQualityTargets(profile, memorySignals) {
    return {
      compositionScore: 70,
      retentionHazardMax: 0.02,
      hookScoreMin: 60,
      sceneDiversityMin: 0.5,
      thumbnailDiversityMin: 0.3,
      source: 'defaults',
      confidence: 0.90,
    }
  }

  _selectDiversityConstraints() {
    return {
      imageReuseWindow: 50,
      musicReuseWindow: 50,
      thumbnailReuseWindow: 50,
      scriptSimilarityMax: 0.80,
      sceneImageSimilarityMax: 0.85,
      source: 'defaults',
      confidence: 0.95,
    }
  }

  // ── Memory signal gathering ──────────────────────────────────────────

  _gatherMemorySignals(nicheKey, profile) {
    const signals = {
      niche: nicheKey,
      bestHookStyle: null,
      hookConfidence: 0,
      bestThumbnailStyle: null,
      thumbConfidence: 0,
      nichePerformance: null,
      recentTopics: [],
      rejected: [],
      summary: [],
    }

    if (!this.performanceMemory) {
      signals.summary.push('no performance memory available')
      return signals
    }

    try {
      const nicheStats = this.performanceMemory.nicheStats()
      if (nicheStats[nicheKey]) {
        signals.nichePerformance = nicheStats[nicheKey]
        signals.summary.push(`niche ${nicheKey}: grade=${nicheStats[nicheKey].grade} samples=${nicheStats[nicheKey].sampleCount}`)
      }

      const hookStats = this.performanceMemory.hookStats()
      let bestHook = null
      let bestHookGrade = 'F'
      for (const [style, stats] of Object.entries(hookStats)) {
        if (stats.sampleCount >= MIN_SAMPLES_FOR_LEARNING && _gradeBetter(stats.grade, bestHookGrade)) {
          bestHook = style
          bestHookGrade = stats.grade
        }
      }
      if (bestHook && bestHook !== profile.hookStyle) {
        signals.bestHookStyle = bestHook
        signals.hookConfidence = hookStats[bestHook].sampleCount >= 5 ? 0.75 : 0.60
        signals.summary.push(`hook optimization: ${bestHook} (${bestHookGrade}) > ${profile.hookStyle}`)
      }

      const thumbStats = this.performanceMemory.thumbnailStats()
      let bestThumb = null
      let bestThumbGrade = 'F'
      for (const [style, stats] of Object.entries(thumbStats)) {
        if (stats.sampleCount >= MIN_SAMPLES_FOR_LEARNING && _gradeBetter(stats.grade, bestThumbGrade)) {
          bestThumb = style
          bestThumbGrade = stats.grade
        }
      }
      if (bestThumb && bestThumb !== profile.coverStyle) {
        signals.bestThumbnailStyle = bestThumb
        signals.thumbConfidence = thumbStats[bestThumb].sampleCount >= 5 ? 0.75 : 0.60
        signals.summary.push(`thumbnail optimization: ${bestThumb} (${bestThumbGrade}) > ${profile.coverStyle}`)
      }

      const recent = this.performanceMemory.recent(20)
      signals.recentTopics = recent.map(r => r.articleId).filter(Boolean)

      if (signals.summary.length === 0) {
        signals.summary.push('insufficient data for optimization — using profile defaults')
      }
    } catch (e) {
      signals.summary.push(`memory read failed: ${e.message}`)
    }

    return signals
  }

  // ── Reasoning + confidence ───────────────────────────────────────────

  _buildReasoning(niche, profile, memorySignals, strategies, decision) {
    const parts = []
    parts.push(`niche=${niche.key} (source=${niche.source}, confidence=${niche.confidence})`)
    parts.push(`profile.hookStyle=${profile.hookStyle} → strategy=${strategies.hookStrategy.style} (${strategies.hookStrategy.source})`)
    parts.push(`profile.coverStyle=${profile.coverStyle} → thumbnail=${strategies.thumbnailStrategy.layout} (${strategies.thumbnailStrategy.source})`)

    if (decision?.aiCalled) {
      parts.push(`ai: ${decision.recommendationsAccepted}/${decision.recommendationsReceived} accepted (provider=${decision.aiProvider}, latency=${decision.aiLatencyMs}ms)`)
    }

    if (memorySignals.summary.length) {
      parts.push(`memory: ${memorySignals.summary.join('; ')}`)
    }

    return parts.join(' | ')
  }

  _computeConfidence(niche, memorySignals, decision) {
    let base = niche.confidence || 0.70

    if (memorySignals.nichePerformance?.sufficientData) {
      base = Math.min(0.95, base + 0.10)
    }

    if (memorySignals.rejected.length > 0) {
      base = Math.max(0.40, base - 0.05 * memorySignals.rejected.length)
    }

    // Boost slightly if AI optimization was accepted
    if (decision?.recommendationsAccepted > 0 && decision?.validationPassed) {
      base = Math.min(0.95, base + 0.05)
    }

    return Number(base.toFixed(3))
  }
}

// ── Helpers ──────────────────────────────────────────────────────────

function _gradeBetter(gradeA, gradeB) {
  const order = { A: 0, B: 1, C: 2, D: 3, F: 4 }
  return (order[gradeA] ?? 4) < (order[gradeB] ?? 4)
}

function extractKeywords(text) {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, '')
    .split(/\s+/)
    .filter(w => w.length > 3)
    .slice(0, 5)
}
