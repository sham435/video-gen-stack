// ProfileOptimizer — validated profile change layer.
//
// NEVER mutates CategoryProductionProfiles directly. Instead:
//
//   RecommendationEngine → Recommendation[]
//   ProfileOptimizer.validate(recommendation) → ValidatedChange | null
//   ProfileOptimizer.apply(change) → applies to override store
//
// The optimizer is the single gatekeeper between analytics-driven
// recommendations and the production profile registry. Every change
// must pass validation:
//   1. Confidence threshold (default ≥ 0.70)
//   2. Sample size sufficient (≥ 5 observations)
//   3. Change is within allowed bounds (no accent color changes, etc.)
//   4. Rate limiting: max 1 change per niche per 24h
//
// Profile overrides are stored in a separate file and merged at runtime.
// The canonical profiles in CategoryProductionProfiles.mjs remain frozen.

import fs from 'node:fs'
import path from 'node:path'

const DEFAULT_OVERRIDE_PATH = 'data/profile-overrides.json'
const MIN_CONFIDENCE = 0.70
const MIN_SAMPLES = 5
const COOLDOWN_MS = 24 * 60 * 60 * 1000 // 24 hours

// Fields that CAN be optimized (never touch accent or coverStyle)
const ALLOWED_FIELDS = new Set(['tone', 'hookStyle', 'visualDensity', 'motion'])

export class ProfileOptimizer {
  constructor({ overridePath = DEFAULT_OVERRIDE_PATH, memory = null, now = Date.now } = {}) {
    this.overridePath = overridePath
    this.memory = memory
    this.now = now
    this.overrides = this._load()
  }

  // ─── validate ───────────────────────────────────────────────────────────
  // Validate a recommendation. Returns ValidatedChange or null (rejected).
  validate(recommendation) {
    const { type, niche, field, suggestedValue, confidence, reason, action } = recommendation

    // 1. Only niche_profile changes go through this optimizer
    if (type !== 'niche_profile') return null

    // 2. Field must be in the allowed set
    if (!ALLOWED_FIELDS.has(field)) {
      return { ...recommendation, status: 'rejected', reason: `field "${field}" is not optimizable (allowed: ${[...ALLOWED_FIELDS].join(', ')})` }
    }

    // 3. Confidence threshold
    if (confidence < MIN_CONFIDENCE) {
      return { ...recommendation, status: 'rejected', reason: `confidence ${confidence.toFixed(2)} < ${MIN_CONFIDENCE} threshold` }
    }

    // 4. Sample size check
    if (this.memory) {
      const stats = this.memory.nicheStats()
      if (!stats[niche]?.sufficientData) {
        return { ...recommendation, status: 'rejected', reason: `insufficient data for ${niche} (need ${MIN_SAMPLES}+ videos)` }
      }
    }

    // 5. Rate limiting: max 1 change per niche per 24h
    const lastChange = this.overrides.changes.find(
      c => c.niche === niche && c.field === field
    )
    if (lastChange) {
      const elapsed = this.now() - new Date(lastChange.appliedAt).getTime()
      if (elapsed < COOLDOWN_MS) {
        const hoursLeft = Math.ceil((COOLDOWN_MS - elapsed) / (60 * 60 * 1000))
        return { ...recommendation, status: 'rejected', reason: `cooldown: ${hoursLeft}h remaining for ${niche}.${field}` }
      }
    }

    // 6. Validate the suggested value makes sense for the field
    if (!this._isValidValue(field, suggestedValue)) {
      return { ...recommendation, status: 'rejected', reason: `invalid value "${suggestedValue}" for field "${field}"` }
    }

    return {
      ...recommendation,
      status: 'validated',
      appliedAt: new Date(this.now()).toISOString(),
    }
  }

  // ─── apply ──────────────────────────────────────────────────────────────
  // Apply a validated change. Must be status='validated'.
  apply(validatedChange) {
    if (validatedChange.status !== 'validated') {
      throw new Error(`Cannot apply change with status "${validatedChange.status}"`)
    }

    const { niche, field, suggestedValue } = validatedChange
    const key = `${niche}.${field}`

    // Upsert the override
    this.overrides.profiles[niche] = this.overrides.profiles[niche] || {}
    this.overrides.profiles[niche][field] = suggestedValue

    // Record the change
    this.overrides.changes.push({
      niche,
      field,
      value: suggestedValue,
      confidence: validatedChange.confidence,
      reason: validatedChange.reason,
      appliedAt: validatedChange.appliedAt,
    })

    // Trim change history to last 100
    if (this.overrides.changes.length > 100) {
      this.overrides.changes = this.overrides.changes.slice(-100)
    }

    this._save()
    return { niche, field, value: suggestedValue, applied: true }
  }

  // ─── getOverride ────────────────────────────────────────────────────────
  // Get the current override for a niche.field, or null.
  getOverride(niche, field) {
    return this.overrides.profiles[niche]?.[field] || null
  }

  // ─── getProfileWithOverrides ────────────────────────────────────────────
  // Merge canonical profile with overrides. Returns a new object (never mutates the original).
  getProfileWithOverrides(niche, canonicalProfile) {
    const override = this.overrides.profiles[niche]
    if (!override || Object.keys(override).length === 0) return canonicalProfile
    return Object.freeze({ ...canonicalProfile, ...override })
  }

  // ─── recentChanges ──────────────────────────────────────────────────────
  recentChanges(n = 10) {
    return this.overrides.changes.slice(-n).reverse()
  }

  // ─── validateAll ────────────────────────────────────────────────────────
  // Validate all pending recommendations. Returns { validated, rejected }.
  validateAll(recommendations) {
    const validated = []
    const rejected = []
    for (const rec of recommendations) {
      const result = this.validate(rec)
      if (result?.status === 'validated') validated.push(result)
      else rejected.push(result || rec)
    }
    return { validated, rejected }
  }

  // ─── helpers ────────────────────────────────────────────────────────────
  _isValidValue(field, value) {
    if (value == null) return false
    const valid = {
      tone: ['excited', 'analytical', 'authoritative'],
      hookStyle: ['breaking', 'reveal', 'curiosity', 'shock', 'data'],
      visualDensity: ['low', 'medium', 'high'],
      motion: ['smooth', 'dynamic', 'fast'],
    }
    return valid[field]?.includes(value) || false
  }

  _load() {
    try {
      return JSON.parse(fs.readFileSync(this.overridePath, 'utf-8'))
    } catch {
      return { profiles: {}, changes: [] }
    }
  }

  _save() {
    try {
      fs.mkdirSync(path.dirname(this.overridePath), { recursive: true })
      fs.writeFileSync(this.overridePath, JSON.stringify(this.overrides, null, 2))
    } catch { /* non-fatal */ }
  }
}
