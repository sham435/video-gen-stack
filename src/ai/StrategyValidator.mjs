// StrategyValidator — deterministic validation of ProductionPlan fields.
//
// AI is advisory. This validator is authoritative.
// Hard constraints are derived from the existing repository where possible:
//   - scene count bounds match renderer support
//   - hook styles match CategoryProductionProfiles + ProfileOptimizer
//   - thumbnail layouts match CoverComposer / ThumbnailFactory families
//   - providers match the existing ProviderChain registry
//   - quality thresholds are system policy (AI must not lower them)
//   - diversity constraints are bounded to prevent extreme values
//
// Returns { valid, errors, warnings, plan } — plan is the validated
// (possibly trimmed) plan. If valid=false, plan MUST NOT enter ProductionJob.

const VALID_HOOK_STYLES = ['breaking', 'reveal', 'curiosity', 'shock', 'data']
const VALID_THUMBNAIL_LAYOUTS = ['breaking', 'premium-tech', 'futuristic-tech', 'automotive-tech', 'bold', 'cinematic', 'data']
const VALID_DENSITY = ['low', 'medium', 'high']
const VALID_MOTION = ['smooth', 'dynamic', 'fast']
const VALID_MUSIC_MOODS = ['cinematic', 'energetic', 'ambient', 'tense', 'dramatic', 'neutral']
const VALID_MUSIC_TONES = ['excited', 'analytical', 'authoritative']
const VALID_SEARCH_COMPOSITIONS = ['wide', 'medium', 'close']
const VALID_AI_PROVIDERS = ['auto', 'gemini', 'ollama', 'openai', 'openrouter', 'zen']
const VALID_TTS_PROVIDERS = ['auto', 'elevenlabs', 'fallback']
const VALID_RENDER_PROVIDERS = ['local', 'cloud', 'auto']
const VALID_IMAGE_PROVIDERS = ['auto', 'pexels', 'unsplash']

// System quality policy — AI MUST NOT lower these
const SYSTEM_QUALITY_POLICY = Object.freeze({
  compositionScore: { min: 50, max: 100 },
  retentionHazardMax: { min: 0.005, max: 0.10 },
  hookScoreMin: { min: 30, max: 100 },
  sceneDiversityMin: { min: 0.1, max: 1.0 },
  thumbnailDiversityMin: { min: 0.1, max: 1.0 },
})

const CONFIDENCE_RANGE = { min: 0, max: 1 }

export class StrategyValidator {
  /**
   * Validate a ProductionPlan or partial strategy object.
   *
   * @param {object} plan — ProductionPlan or strategy subset
   * @param {object} opts — { strict: boolean }
   * @returns {{ valid: boolean, errors: string[], warnings: string[], plan: object }}
   */
  static validate(plan, opts = {}) {
    const strict = opts.strict !== false
    const errors = []
    const warnings = []

    if (!plan || typeof plan !== 'object') {
      return { valid: false, errors: ['plan is not an object'], warnings: [], plan: null }
    }

    // ── sceneStrategy ──
    if (plan.sceneStrategy) {
      const s = plan.sceneStrategy
      if (typeof s !== 'object') {
        errors.push('sceneStrategy must be an object')
      } else {
        if (typeof s.sceneCount !== 'number' || !Number.isFinite(s.sceneCount)) {
          errors.push('sceneStrategy.sceneCount must be a finite number')
        } else if (s.sceneCount < 5 || s.sceneCount > 10) {
          errors.push(`sceneStrategy.sceneCount=${s.sceneCount} outside supported range [5, 10]`)
        }
        if (s.density && !VALID_DENSITY.includes(s.density)) {
          errors.push(`sceneStrategy.density="${s.density}" not in [${VALID_DENSITY}]`)
        }
        if (s.motion && !VALID_MOTION.includes(s.motion)) {
          errors.push(`sceneStrategy.motion="${s.motion}" not in [${VALID_MOTION}]`)
        }
        if (s.avgDurationSec != null) {
          if (typeof s.avgDurationSec !== 'number' || !Number.isFinite(s.avgDurationSec)) {
            errors.push('sceneStrategy.avgDurationSec must be a finite number')
          } else if (s.avgDurationSec < 2 || s.avgDurationSec > 8) {
            errors.push(`sceneStrategy.avgDurationSec=${s.avgDurationSec} outside range [2, 8]`)
          }
        }
      }
    }

    // ── hookStrategy ──
    if (plan.hookStrategy) {
      const h = plan.hookStrategy
      if (typeof h !== 'object') {
        errors.push('hookStrategy must be an object')
      } else {
        if (!VALID_HOOK_STYLES.includes(h.style)) {
          errors.push(`hookStrategy.style="${h.style}" not in [${VALID_HOOK_STYLES}]`)
        }
      }
    }

    // ── visualStrategy ──
    if (plan.visualStrategy) {
      const v = plan.visualStrategy
      if (typeof v !== 'object') {
        errors.push('visualStrategy must be an object')
      } else {
        if (typeof v.searchQuery !== 'string' || v.searchQuery.length === 0) {
          errors.push('visualStrategy.searchQuery must be a non-empty string')
        }
        if (v.composition && !VALID_SEARCH_COMPOSITIONS.includes(v.composition)) {
          errors.push(`visualStrategy.composition="${v.composition}" not in [${VALID_SEARCH_COMPOSITIONS}]`)
        }
      }
    }

    // ── thumbnailStrategy ──
    if (plan.thumbnailStrategy) {
      const t = plan.thumbnailStrategy
      if (typeof t !== 'object') {
        errors.push('thumbnailStrategy must be an object')
      } else {
        if (!VALID_THUMBNAIL_LAYOUTS.includes(t.layout)) {
          errors.push(`thumbnailStrategy.layout="${t.layout}" not in [${VALID_THUMBNAIL_LAYOUTS}]`)
        }
      }
    }

    // ── musicStrategy ──
    if (plan.musicStrategy) {
      const m = plan.musicStrategy
      if (typeof m !== 'object') {
        errors.push('musicStrategy must be an object')
      } else {
        if (m.mood && !VALID_MUSIC_MOODS.includes(m.mood)) {
          errors.push(`musicStrategy.mood="${m.mood}" not in [${VALID_MUSIC_MOODS}]`)
        }
      }
    }

    // ── providerPreferences ──
    if (plan.providerPreferences) {
      const p = plan.providerPreferences
      if (typeof p !== 'object') {
        errors.push('providerPreferences must be an object')
      } else {
        if (p.ai && !VALID_AI_PROVIDERS.includes(p.ai)) {
          errors.push(`providerPreferences.ai="${p.ai}" not in [${VALID_AI_PROVIDERS}]`)
        }
        if (p.tts && !VALID_TTS_PROVIDERS.includes(p.tts)) {
          errors.push(`providerPreferences.tts="${p.tts}" not in [${VALID_TTS_PROVIDERS}]`)
        }
        if (p.rendering && !VALID_RENDER_PROVIDERS.includes(p.rendering)) {
          errors.push(`providerPreferences.rendering="${p.rendering}" not in [${VALID_RENDER_PROVIDERS}]`)
        }
        if (p.imageSearch && !VALID_IMAGE_PROVIDERS.includes(p.imageSearch)) {
          errors.push(`providerPreferences.imageSearch="${p.imageSearch}" not in [${VALID_IMAGE_PROVIDERS}]`)
        }
      }
    }

    // ── qualityTargets — system policy, AI must not lower below minimum ──
    if (plan.qualityTargets) {
      const q = plan.qualityTargets
      if (typeof q !== 'object') {
        errors.push('qualityTargets must be an object')
      } else {
        for (const [field, bounds] of Object.entries(SYSTEM_QUALITY_POLICY)) {
          if (q[field] != null) {
            if (typeof q[field] !== 'number' || !Number.isFinite(q[field])) {
              errors.push(`qualityTargets.${field} must be a finite number`)
            } else if (q[field] < bounds.min) {
              errors.push(`qualityTargets.${field}=${q[field]} below system minimum ${bounds.min} (AI must not lower mandatory quality thresholds)`)
            } else if (q[field] > bounds.max) {
              errors.push(`qualityTargets.${field}=${q[field]} above system maximum ${bounds.max}`)
            }
          }
        }
      }
    }

    // ── diversityConstraints ──
    if (plan.diversityConstraints) {
      const d = plan.diversityConstraints
      if (typeof d !== 'object') {
        errors.push('diversityConstraints must be an object')
      } else {
        if (d.imageReuseWindow != null && (typeof d.imageReuseWindow !== 'number' || d.imageReuseWindow < 10 || d.imageReuseWindow > 200)) {
          errors.push(`diversityConstraints.imageReuseWindow=${d.imageReuseWindow} outside range [10, 200]`)
        }
        if (d.musicReuseWindow != null && (typeof d.musicReuseWindow !== 'number' || d.musicReuseWindow < 10 || d.musicReuseWindow > 200)) {
          errors.push(`diversityConstraints.musicReuseWindow=${d.musicReuseWindow} outside range [10, 200]`)
        }
        if (d.thumbnailReuseWindow != null && (typeof d.thumbnailReuseWindow !== 'number' || d.thumbnailReuseWindow < 10 || d.thumbnailReuseWindow > 200)) {
          errors.push(`diversityConstraints.thumbnailReuseWindow=${d.thumbnailReuseWindow} outside range [10, 200]`)
        }
        if (d.scriptSimilarityMax != null && (typeof d.scriptSimilarityMax !== 'number' || d.scriptSimilarityMax <= 0 || d.scriptSimilarityMax > 1)) {
          errors.push(`diversityConstraints.scriptSimilarityMax=${d.scriptSimilarityMax} outside range (0, 1]`)
        }
        if (d.sceneImageSimilarityMax != null && (typeof d.sceneImageSimilarityMax !== 'number' || d.sceneImageSimilarityMax <= 0 || d.sceneImageSimilarityMax > 1)) {
          errors.push(`diversityConstraints.sceneImageSimilarityMax=${d.sceneImageSimilarityMax} outside range (0, 1]`)
        }
      }
    }

    // ── confidence ──
    if (plan.confidence != null) {
      if (typeof plan.confidence !== 'number' || !Number.isFinite(plan.confidence)) {
        errors.push('confidence must be a finite number')
      } else if (plan.confidence < CONFIDENCE_RANGE.min || plan.confidence > CONFIDENCE_RANGE.max) {
        errors.push(`confidence=${plan.confidence} outside range [${CONFIDENCE_RANGE.min}, ${CONFIDENCE_RANGE.max}]`)
      }
    }

    // ── niche (required) ──
    if (plan.niche) {
      if (typeof plan.niche !== 'object' || !plan.niche.key) {
        errors.push('niche must be an object with a key field')
      }
    }

    // ── cross-field consistency ──
    if (plan.sceneStrategy && plan.sceneStrategy.sceneCount && plan.sceneStrategy.avgDurationSec) {
      const total = plan.sceneStrategy.sceneCount * plan.sceneStrategy.avgDurationSec
      if (total < 20 || total > 80) {
        warnings.push(`totalDuration=${total.toFixed(1)}s outside typical range [20, 80] — may produce unusual video length`)
      }
    }

    return {
      valid: errors.length === 0,
      errors,
      warnings,
      plan,
    }
  }

  /**
   * Validate AI recommendations before applying to a plan.
   * Only validates the recommendation shape, not the full plan.
   *
   * @param {object[]} recommendations
   * @returns {{ valid: object[], invalid: object[] }}
   */
  static validateRecommendations(recommendations) {
    if (!Array.isArray(recommendations)) return { valid: [], invalid: [{ error: 'recommendations is not an array' }] }

    const valid = []
    const invalid = []

    for (const rec of recommendations) {
      if (!rec || typeof rec !== 'object') {
        invalid.push({ rec, error: 'recommendation is not an object' })
        continue
      }
      if (!rec.field || typeof rec.field !== 'string') {
        invalid.push({ rec, error: 'recommendation missing field' })
        continue
      }
      if (rec.suggestedValue === undefined || rec.suggestedValue === null) {
        invalid.push({ rec, error: `recommendation for ${rec.field} missing suggestedValue` })
        continue
      }
      if (rec.confidence != null && (typeof rec.confidence !== 'number' || rec.confidence < 0 || rec.confidence > 1)) {
        invalid.push({ rec, error: `recommendation for ${rec.field} has invalid confidence=${rec.confidence}` })
        continue
      }

      // Field-specific validation
      const fieldError = StrategyValidator._validateRecommendationField(rec)
      if (fieldError) {
        invalid.push({ rec, error: fieldError })
        continue
      }

      valid.push(rec)
    }

    return { valid, invalid }
  }

  static _validateRecommendationField(rec) {
    switch (rec.field) {
      case 'hookStrategy.style':
        if (!VALID_HOOK_STYLES.includes(rec.suggestedValue)) {
          return `hookStyle="${rec.suggestedValue}" not in [${VALID_HOOK_STYLES}]`
        }
        break
      case 'thumbnailStrategy.layout':
        if (!VALID_THUMBNAIL_LAYOUTS.includes(rec.suggestedValue)) {
          return `thumbnailLayout="${rec.suggestedValue}" not in [${VALID_THUMBNAIL_LAYOUTS}]`
        }
        break
      case 'sceneStrategy.density':
        if (!VALID_DENSITY.includes(rec.suggestedValue)) {
          return `density="${rec.suggestedValue}" not in [${VALID_DENSITY}]`
        }
        break
      case 'sceneStrategy.motion':
        if (!VALID_MOTION.includes(rec.suggestedValue)) {
          return `motion="${rec.suggestedValue}" not in [${VALID_MOTION}]`
        }
        break
      case 'musicStrategy.mood':
        if (!VALID_MUSIC_MOODS.includes(rec.suggestedValue)) {
          return `musicMood="${rec.suggestedValue}" not in [${VALID_MUSIC_MOODS}]`
        }
        break
      case 'musicStrategy.tone':
        if (!VALID_MUSIC_TONES.includes(rec.suggestedValue)) {
          return `musicTone="${rec.suggestedValue}" not in [${VALID_MUSIC_TONES}]`
        }
        break
      case 'visualStrategy.composition':
        if (!VALID_SEARCH_COMPOSITIONS.includes(rec.suggestedValue)) {
          return `composition="${rec.suggestedValue}" not in [${VALID_SEARCH_COMPOSITIONS}]`
        }
        break
      // Fields AI must NOT modify
      case 'qualityTargets.compositionScore':
      case 'qualityTargets.retentionHazardMax':
      case 'qualityTargets.hookScoreMin':
      case 'qualityTargets.sceneDiversityMin':
      case 'qualityTargets.thumbnailDiversityMin':
        return `AI must not modify system quality policy field ${rec.field}`
      case 'niche.key':
      case 'niche.source':
      case 'niche.confidence':
        return `AI must not override niche resolution field ${rec.field}`
    }
    return null
  }
}
