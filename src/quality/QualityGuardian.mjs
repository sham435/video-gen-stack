import { TextConflictResolver } from '../pipeline/TextConflictResolver.mjs'
import { SafeZoneManager } from '../layout/SafeZoneManager.mjs'

// Quality Guardian — the publishing gate.
//
// Two-sided validation:
//   validate(scene)   pre-render deterministic checks (text intent level)
//   evaluate(frames)  post-render visual scoring from FrameVisionAnalyzer
//
// A scene must pass both sides before the video ships. Rejections are
// recorded into ProductionMemory so the same class of failure is prevented
// on the next story.
const READABILITY_MAX = 200

export class QualityGuardian {
  constructor(options = {}) {
    this.resolver = new TextConflictResolver()
    this.frameThreshold = options.frameThreshold || 85
  }

  // Pre-render checks — the gate the user sees in the V3 architecture
  validate(scene) {
    const manifest = scene.textManifest || { text_layers: [] }
    const layers = manifest.text_layers || []
    const emphasis = layers.find(x => x.type === 'emphasis')
    const caption = layers.find(x => x.type === 'caption')

    const duplicateText = !(emphasis && caption)
      ? true
      : !this.resolver.normalize(caption.text).split(' ').filter(Boolean)
          .some(w => this.resolver.normalize(emphasis.text).split(' ').filter(Boolean).includes(w))

    const collision = this._checkCollision(layers)
    const safeZone = this._checkSafeZones(layers)
    const readability = this._checkReadability(scene)

    const passed = duplicateText && collision && safeZone && readability.ok
    return {
      duplicateText,
      collision,
      safeZone,
      readability: readability.ok,
      readabilityScore: readability.score,
      passed,
      issues: [
        !duplicateText && 'duplicate_emphasis_text',
        !collision && 'text_collision',
        !safeZone && 'outside_safe_zone',
        !readability.ok && readability.reason,
      ].filter(Boolean),
    }
  }

  _checkCollision(layers) {
    for (let i = 0; i < layers.length; i++) {
      for (let j = i + 1; j < layers.length; j++) {
        const a = SafeZoneManager.zoneFor(layers[i].position)
        const b = SafeZoneManager.zoneFor(layers[j].position)
        if (a && b && SafeZoneManager.intersects(a, b) && layers[i].type !== 'source' && layers[j].type !== 'source') {
          return false
        }
      }
    }
    return true
  }

  _checkSafeZones(layers) {
    for (const layer of layers) {
      const rect = SafeZoneManager.zoneFor(layer.position)
      if (rect && !SafeZoneManager.validate(layer, rect).ok) return false
    }
    return true
  }

  _checkReadability(scene) {
    const caption = scene.caption || ''
    if (caption.length === 0) return { ok: true, score: 100 }
    const score = caption.length <= READABILITY_MAX ? 100 : Math.max(40, 100 - (caption.length - READABILITY_MAX) * 0.5)
    return {
      ok: caption.length >= 5 && caption.length <= READABILITY_MAX,
      score: Math.round(score),
      reason: caption.length > READABILITY_MAX ? 'caption_too_long' : caption.length < 5 ? 'caption_too_short' : null,
    }
  }

  // Post-render gate — consumes FrameVisionAnalyzer output
  evaluate(frameAnalysis) {
    const score = frameAnalysis?.overall ?? 0
    const passed = score >= this.frameThreshold
    return {
      score,
      threshold: this.frameThreshold,
      passed,
      decision: passed ? 'APPROVE' : 'REVIEW',
      checks: frameAnalysis?.scenes?.reduce((acc, s) => {
        acc[s.scene] = { score: s.score, ...s.checks }
        return acc
      }, {}) || {},
      issues: frameAnalysis?.failing?.map(f => `scene ${f.scene} ${f.score}/100`) || [],
    }
  }
}
