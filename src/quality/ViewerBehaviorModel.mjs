// Viewer Behavior Model — calibrated attention-decision model.
//
// Converts scene production signals into confidence-weighted drop risks and
// hazard rates, calibrated by ProductionMemory performance patterns
// (retentionImpact). The hazard drives the RetentionSimulator's survival
// curve; the risks drive recommendations (shorten / reorder / strengthen).
//
// Calibration: when a risk type has been observed repeatedly in memory
// (e.g. slow_information_delivery with retentionImpact: -12), the hazard
// multiplies by (1 + impact/100) and confidence rises with frequency —
// the model learns from real viewer behavior instead of priors only.
const BASE_HAZARD = 0.008 // per-second baseline (≈20% watch a 30s short)
const SCENE_TYPE_HAZARD = { hook: 1.0, fact: 1.15, reveal: 0.75, explanation: 1.25, reaction: 0.95, close: 0.6 }
const EMOTION_HAZARD = { shock: 0.7, excitement: 0.8, tension: 0.9, awe: 0.9, curiosity: 1.0, neutral: 1.15 }

export class ViewerBehaviorModel {
  constructor(options = {}) {
    this.memory = options.memory || null
  }

  _patternConfidence(rule) {
    const p = this.memory?.lookup(rule)
    if (!p?.frequency) return { factor: 1, frequency: 0 }
    // Negative retentionImpact (bad pattern) → hazard UP; positive → hazard DOWN
    return { factor: 1 - (p.retentionImpact || 0) / 100, frequency: p.frequency }
  }

  // Per-scene hazard rate for the survival simulation, memory-calibrated
  hazard(scene) {
    const typeMul = SCENE_TYPE_HAZARD[scene.type] ?? 1.1
    const emotionMul = EMOTION_HAZARD[scene.emotion] ?? 1.1

    const dur = scene.duration || 3
    const durMul = dur > 4 ? 1 + 0.12 * (dur - 4) : 1

    const hasMotion = scene.retentionPlan || (scene.camera && scene.camera !== 'static')
    const motionMul = hasMotion ? 0.75 : 1.45

    const capLen = (scene.caption || '').length
    const captionMul = capLen > 60 ? 1.5 : capLen >= 5 ? 0.92 : 1.0
    const emphasisCount = Array.isArray(scene.textManifest?.emphasis) ? scene.textManifest.emphasis.length : 0
    const emphasisMul = emphasisCount > 3 ? 1.1 : 1.0

    const rel = scene.visualRelevanceScore
    const relevanceMul = rel == null ? 1.1 : rel < 55 ? 1.3 : 1.0

    const issues = scene.judge?.issues || []
    const judgeMul = issues.length ? 1 + 0.12 * issues.length : 1

    let hookMul = 1
    if (scene.type === 'hook') {
      const h = scene.hookScore
      hookMul = h >= 85 ? 0.5 : h == null ? 1.2 : h < 60 ? 2.2 : 1.2
    }

    let hazard = BASE_HAZARD * typeMul * emotionMul * durMul * motionMul * captionMul * emphasisMul * relevanceMul * judgeMul * hookMul

    // Memory calibration — known performance patterns shift the hazard
    for (const risk of this.risks(scene)) {
      const { factor } = this._patternConfidence(risk.type)
      if (factor !== 1) hazard *= factor
    }
    return hazard
  }

  // Confidence-weighted drop risks for a scene
  risks(scene) {
    const risks = []
    const dur = scene.duration || 3
    const issues = scene.judge?.issues || []

    // Opening — the first 3 seconds decide everything
    if (scene.type === 'hook') {
      const h = scene.hookScore
      if (h == null) risks.push({ type: 'hook_unmeasured', confidence: 0.35, detail: 'no hook score available' })
      else if (h < 60) risks.push({ type: 'slow_hook_open', confidence: 0.6 + (60 - h) / 100, detail: `hook strength ${h}/100` })
    }

    // Pacing drag — long scenes bleed attention
    if (dur > 4) {
      risks.push({ type: 'scene_drag', confidence: Math.min(0.9, 0.35 + (dur - 4) * 0.15), detail: `${dur}s duration exceeds 4s attention span` })
    }

    // Visual novelty — static frames lose the eye
    const hasMotion = scene.retentionPlan || (scene.camera && scene.camera !== 'static')
    if (!hasMotion) risks.push({ type: 'visual_repetition', confidence: 0.7, detail: 'no motion plan — identical frame for the whole scene' })

    // Information density — too much text to read
    const capLen = (scene.caption || '').length
    if (capLen > 60) risks.push({ type: 'text_overload', confidence: 0.75, detail: `${capLen}-char caption exceeds reading budget` })

    // Visual mismatch
    const rel = scene.visualRelevanceScore
    if (rel != null && rel < 55) risks.push({ type: 'visual_mismatch', confidence: 0.65, detail: `visual relevance ${rel}/100` })

    // Judge friction
    if (issues.length) risks.push({ type: 'judge_friction', confidence: Math.min(0.95, 0.6 + issues.length * 0.1), detail: `unresolved: ${issues.slice(0, 2).join(', ')}` })

    // Emotional curve — flat neutral facts plateau
    if (scene.emotion === 'neutral' && scene.type === 'fact') risks.push({ type: 'emotion_plateau', confidence: 0.4, detail: 'neutral fact — no emotional lift' })

    // Transitions — abrupt cut signals
    if (scene.id > 1 && !scene.transition) risks.push({ type: 'abrupt_transition', confidence: 0.3, detail: 'no transition planned into scene' })

    // Post-hook information delivery — key facts buried behind exposition
    if (scene.id === 2 && scene.type === 'explanation') risks.push({ type: 'slow_information_delivery', confidence: 0.7, detail: 'exposition directly after hook delays the key fact' })

    // Memory calibration: known patterns boost confidence with frequency
    return risks.map(r => {
      const { frequency } = this._patternConfidence(r.type)
      const calibrated = Math.min(0.97, r.confidence + frequency * 0.01)
      return { ...r, confidence: Math.round(calibrated * 100) / 100 }
    })
  }

  // Structured recommendations from the highest-confidence risks
  recommendations(scene, risk) {
    const type = risk.risk || risk.type
    switch (type) {
      case 'scene_drag': return { action: 'shorten_scene', scene: scene.id, seconds: Math.min(2.5, Math.round((scene.duration - 3) * 10) / 10) }
      case 'visual_repetition': return { action: 'add_motion', scene: scene.id, seconds: null }
      case 'text_overload': return { action: 'truncate_caption', scene: scene.id, seconds: null }
      case 'slow_information_delivery': return { action: 'move_key_fact_forward', scene: scene.id, seconds: null }
      case 'slow_hook_open': return { action: 'strengthen_hook', scene: scene.id, seconds: null }
      case 'visual_mismatch': return { action: 'replace_visual', scene: scene.id, seconds: null }
      case 'judge_friction': return { action: 'fix_scene_issues', scene: scene.id, seconds: null }
      default: return { action: 'monitor', scene: scene.id, seconds: null }
    }
  }
}
