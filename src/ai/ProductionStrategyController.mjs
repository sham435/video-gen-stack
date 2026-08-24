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
//   AI recommendation → CategoryProductionProfile → global defaults → quarantine
//
// Consumes:
//   - Article/topic
//   - NicheDecision (from NicheResolver, resolve-once)
//   - CategoryProductionProfile (frozen registry + ProfileOptimizer overrides)
//   - PerformanceMemory (historical analytics per niche/hook/thumbnail)
//   - ResourceGovernor (quota state per provider)
//   - AssetRegistry (recent asset usage for diversity)
//
// Produces:
//   - ProductionPlan (immutable strategy object)
//   - Decision trace (why this plan was selected)

import { getProfile } from '../production/CategoryProductionProfiles.mjs'
import { resolveNicheSync } from '../pipeline/NicheResolver.mjs'
import crypto from 'node:crypto'

const CONFIDENCE_THRESHOLD = 0.60
const MIN_SAMPLES_FOR_LEARNING = 3

export class ProductionStrategyController {
  constructor(options = {}) {
    this.performanceMemory = options.performanceMemory || null
    this.profileOptimizer = options.profileOptimizer || null
    this.resourceGovernor = options.resourceGovernor || null
    this.assetRegistry = options.assetRegistry || null
    this.now = options.now || (() => Date.now())
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

    // ── 4. Strategy decisions (each with fallback chain) ──
    const hookStrategy = this._selectHookStrategy(profile, memorySignals)
    const sceneStrategy = this._selectSceneStrategy(profile, memorySignals)
    const visualStrategy = this._selectVisualStrategy(profile, memorySignals, article)
    const musicStrategy = this._selectMusicStrategy(profile, memorySignals)
    const thumbnailStrategy = this._selectThumbnailStrategy(profile, memorySignals)
    const providerPreferences = this._selectProviderPreferences()
    const qualityTargets = this._selectQualityTargets(profile, memorySignals)
    const diversityConstraints = this._selectDiversityConstraints()

    const plan = {
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
      reasoning: this._buildReasoning(niche, profile, memorySignals, {
        hookStrategy, sceneStrategy, visualStrategy, musicStrategy, thumbnailStrategy,
      }),
      confidence: this._computeConfidence(niche, memorySignals),
      memorySignals: memorySignals.summary,
      rejectedStrategies: memorySignals.rejected,
      createdAt: new Date().toISOString(),
      planDurationMs: this.now() - startTime,
    }

    return Object.freeze(plan)
  }

  /**
   * Record production outcome for future learning.
   * Feeds results back into PerformanceMemory.
   *
   * @param {ProductionPlan} plan — the plan that was executed
   * @param {object} outcome — { videoId, analytics, success, errors }
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

  // ── Strategy selectors (each follows fallback chain) ─────────────────

  /**
   * Hook strategy: how to open the video.
   * Fallback: profile.hookStyle → 'breaking'
   */
  _selectHookStrategy(profile, memorySignals) {
    const profileStyle = profile.hookStyle || 'breaking'

    // If memory shows a better-performing hook style for this niche, consider it
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

  /**
   * Scene strategy: pacing, density, count.
   * Fallback: profile.visualDensity → 'medium'
   */
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

  /**
   * Visual strategy: image search, selection, diversity.
   * Fallback: profile.preferredVisuals → ['newsroom', 'technology']
   */
  _selectVisualStrategy(profile, memorySignals, article) {
    const preferredVisuals = profile.preferredVisuals || ['newsroom', 'technology']

    // Enrich with article-specific keywords
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

  /**
   * Music strategy: track selection, uniqueness.
   * Fallback: category-based mood matching.
   */
  _selectMusicStrategy(profile, memorySignals) {
    const tone = profile.tone || 'authoritative'
    const moodMap = {
      excited: 'energetic',
      analytical: 'ambient',
      authoritative: 'cinematic',
    }
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

  /**
   * Thumbnail strategy: layout, text, diversity.
   * Fallback: profile.coverStyle → 'breaking'
   */
  _selectThumbnailStrategy(profile, memorySignals) {
    const coverStyle = profile.coverStyle || 'breaking'
    const hookStyle = profile.hookStyle || 'breaking'

    // If memory shows a better thumbnail style, consider it
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

  /**
   * Provider preferences: which AI/rendering providers to use.
   * Consults ResourceGovernor for quota state.
   */
  _selectProviderPreferences() {
    const preferences = {
      ai: 'auto',
      rendering: 'local',
      tts: 'auto',
      imageSearch: 'auto',
    }

    if (this.resourceGovernor) {
      try {
        const govStatus = this.resourceGovernor.statusAll()
        // If primary provider is quota-limited, prefer fallback
        if (govStatus?.gemini?.remaining?.daily <= 0) {
          preferences.ai = 'ollama'
        }
        if (govStatus?.elevenlabs?.remaining?.daily <= 0) {
          preferences.tts = 'fallback'
        }
      } catch { /* governor unavailable — use defaults */ }
    }

    return { ...preferences, source: 'governor_aware', confidence: 0.70 }
  }

  /**
   * Quality targets: minimum thresholds for passing gates.
   */
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

  /**
   * Diversity constraints: how to prevent repetition.
   */
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
      // Niche performance stats
      const nicheStats = this.performanceMemory.nicheStats()
      if (nicheStats[nicheKey]) {
        signals.nichePerformance = nicheStats[nicheKey]
        signals.summary.push(`niche ${nicheKey}: grade=${nicheStats[nicheKey].grade} samples=${nicheStats[nicheKey].sampleCount}`)
      }

      // Hook style performance
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

      // Thumbnail style performance
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

      // Recent topics for dedup
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

  _buildReasoning(niche, profile, memorySignals, strategies) {
    const parts = []
    parts.push(`niche=${niche.key} (source=${niche.source}, confidence=${niche.confidence})`)
    parts.push(`profile.hookStyle=${profile.hookStyle} → strategy=${strategies.hookStrategy.style} (${strategies.hookStrategy.source})`)
    parts.push(`profile.coverStyle=${profile.coverStyle} → thumbnail=${strategies.thumbnailStrategy.layout} (${strategies.thumbnailStrategy.source})`)

    if (memorySignals.summary.length) {
      parts.push(`memory: ${memorySignals.summary.join('; ')}`)
    }

    return parts.join(' | ')
  }

  _computeConfidence(niche, memorySignals) {
    let base = niche.confidence || 0.70

    // Boost if memory has good data
    if (memorySignals.nichePerformance?.sufficientData) {
      base = Math.min(0.95, base + 0.10)
    }

    // Reduce if memory signals conflict
    if (memorySignals.rejected.length > 0) {
      base = Math.max(0.40, base - 0.05 * memorySignals.rejected.length)
    }

    return Number(base.toFixed(3))
  }
}

// ── Helpers ──────────────────────────────────────────────────────────

function niche_confidence(profile, memorySignals) {
  if (memorySignals.nichePerformance?.sufficientData) return 0.85
  return 0.75
}

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
