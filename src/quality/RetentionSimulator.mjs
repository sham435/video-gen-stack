// Viewer Retention Simulator — the third feedback dimension.
//
// Predicts whether a viewer will stay until the end by simulating attention
// decay second-by-second across the timeline. Each scene contributes a
// hazard rate based on production signals (hook strength, motion, caption
// density, visual relevance, judge friction, emotion arc, pacing).
//
// Output: predicted completion rate, average watch seconds, drop zones
// (where viewers actually leave), and an optimize() pass that applies safe
// deterministic fixes — duration trims + hook caption promotion — so the
// pipeline asks not just "is this scene correct?" but "will a viewer stay?"
const BASE_HAZARD = 0.008 // per-second baseline (≈20% watch a 30s short)
const SCENE_TYPE_HAZARD = { hook: 1.0, fact: 1.15, reveal: 0.75, explanation: 1.25, reaction: 0.95, close: 0.6 }
const EMOTION_HAZARD = { shock: 0.7, excitement: 0.8, tension: 0.9, awe: 0.9, curiosity: 1.0, neutral: 1.15 }

export class RetentionSimulator {
  constructor(options = {}) {
    this.memory = options.memory || null
    this.viewers = options.viewers || 100
    this.completionThreshold = options.threshold || 55
  }

  _sceneHazard(scene, ctx) {
    const typeMul = SCENE_TYPE_HAZARD[scene.type] ?? 1.1
    const emotionMul = EMOTION_HAZARD[scene.emotion] ?? 1.1

    // Pacing — long scenes bleed attention
    const dur = scene.duration || 3
    const durMul = dur > 4 ? 1 + 0.12 * (dur - 4) : 1

    // Motion clarity — the retention plan promises a change every ~2.5s
    const hasMotion = scene.retentionPlan || (scene.camera && scene.camera !== 'static')
    const motionMul = hasMotion ? 0.75 : 1.45

    // Readability — too much text loses the eye
    const capLen = (scene.caption || '').length
    const captionMul = capLen > 60 ? 1.5 : capLen >= 5 ? 0.92 : 1.0
    const emphasisCount = Array.isArray(scene.textManifest?.emphasis) ? scene.textManifest.emphasis.length : 0
    const emphasisMul = emphasisCount > 3 ? 1.1 : 1.0

    // Visual relevance — unrelated visuals confuse, viewers leave
    const rel = scene.visualRelevanceScore
    const relevanceMul = rel == null ? 1.1 : rel < 55 ? 1.3 : 1.0

    // Judge friction — unresolved issues tax attention
    const issues = scene.judge?.issues || []
    const judgeMul = issues.length ? 1 + 0.12 * issues.length : 1
    const unrelatedMul = issues.includes('visual_unrelated') ? 1.25 : 1

    // Hook strength — the first 3 seconds decide everything
    let hookMul = 1
    if (scene.type === 'hook') {
      const h = scene.hookScore
      hookMul = h >= 85 ? 0.5 : h == null ? 1.2 : h < 60 ? 2.2 : 1.2
    }

    return BASE_HAZARD * typeMul * emotionMul * durMul * motionMul * captionMul * emphasisMul * relevanceMul * judgeMul * unrelatedMul * hookMul
  }

  // Second-by-second simulation across the full timeline (floats internally
  // so low hazard rates don't quantize into phantom drop zones)
  simulate(scenes) {
    const curve = []
    let survivors = this.viewers
    let cursor = 0
    for (const scene of scenes) {
      const dur = Math.max(1, Math.round(scene.duration || 3))
      const hz = this._sceneHazard(scene, {})
      for (let t = 0; t < dur; t++) {
        survivors = Math.max(0, survivors * (1 - hz))
        curve.push({ second: cursor + t, sceneId: scene.id, survivors })
      }
      cursor += dur
    }
    return curve
  }

  evaluate(scenes) {
    if (!scenes?.length) return { score: 0, completionRate: 0, avgWatch: 0, curve: [], dropZones: [], recommendations: [] }
    const curve = this.simulate(scenes)
    const total = curve.length
    const final = curve.length ? curve[curve.length - 1].survivors : 0
    const completion = Math.round((final / this.viewers) * 100)
    const avgWatch = total ? curve.reduce((s, p) => s + p.survivors, 0) / this.viewers : 0
    const score = Math.round((0.6 * completion) + (0.4 * (avgWatch / Math.max(1, total)) * 100))

    // Drop zones — scenes that lose a disproportionate share of viewers.
    // startSurvivors = the viewers entering the scene (previous point).
    const perScene = new Map()
    let prev = this.viewers
    for (const p of curve) {
      const e = perScene.get(p.sceneId)
      if (!e) perScene.set(p.sceneId, { startSurvivors: prev, endSurvivors: p.survivors, firstSecond: p.second })
      else e.endSurvivors = Math.min(e.endSurvivors, p.survivors)
      prev = p.survivors
    }
    const totalDrop = this.viewers - final
    const minDropped = Math.max(3, Math.round(this.viewers * 0.02))
    const dropZones = []
    for (const [sceneId, e] of perScene) {
      const dropped = e.startSurvivors - e.endSurvivors
      const share = totalDrop > 0 ? dropped / totalDrop : 0
      const scene = scenes.find(s => s.id === sceneId)
      if (dropped >= minDropped && share > 0.22) {
        dropZones.push({ sceneId, second: e.firstSecond, dropped: Math.round(dropped), share: Math.round(share * 100), reason: scene ? this._zoneReason(scene, dropped) : 'unexplained' })
      }
    }
    dropZones.sort((a, b) => b.share - a.share)

    const recommendations = this._recommendations(scenes, { completion, avgWatch, total, dropZones })
    return { score, completionRate: completion, avgWatch: Math.round(avgWatch * 10) / 10, curve, dropZones, recommendations }
  }

  _zoneReason(scene, dropped) {
    if (scene.type === 'hook') return 'hook too weak — early drop-off'
    if ((scene.duration || 3) > 4) return 'scene too long'
    if (!scene.retentionPlan && scene.camera === 'static') return 'static motion — no visual change'
    if (scene.judge?.issues?.length) return `judge friction: ${scene.judge.issues[0]}`
    if (scene.visualRelevanceScore != null && scene.visualRelevanceScore < 55) return 'weak visual relevance'
    return 'mid-roll attention decay'
  }

  _recommendations(scenes, r) {
    const recs = []
    const total = r.total
    if (total && r.avgWatch / total < 0.5) {
      recs.push('hook_too_weak: promote the strongest keyword into scene 1 caption')
    }
    for (const z of r.dropZones) {
      const scene = scenes.find(s => s.id === z.sceneId)
      if (!scene) continue
      if ((scene.duration || 3) > 4) recs.push(`shorten_scene_${z.sceneId}: ${z.reason}`)
      else if (!scene.retentionPlan && scene.camera === 'static') recs.push(`add_motion_scene_${z.sceneId}: ${z.reason}`)
      else recs.push(`fix_scene_${z.sceneId}: ${z.reason}`)
    }
    if (r.completion < this.completionThreshold && recs.length === 0) recs.push('tighten overall pacing')
    return recs
  }

  // Safe deterministic optimization: duration trims + hook caption promotion.
  // Returns the list of applied changes; mutates scenes in place.
  optimize(scenes, result) {
    const changes = []
    if (!scenes?.length) return { changes }

    for (const z of result.dropZones || []) {
      const scene = scenes.find(s => s.id === z.sceneId)
      if (!scene) continue
      if ((scene.duration || 3) > 4) {
        const before = scene.duration
        scene.duration = 3.0
        changes.push(`trimmed scene ${z.sceneId} ${before}s → 3s`)
      }
    }

    // Hook promotion: if completion is low and the hook caption is missing,
    // lift the strongest caption from scene 2 into the opening (display-only)
    if (result.completionRate < this.completionThreshold && scenes.length > 1) {
      const hook = scenes.find(s => s.type === 'hook')
      const next = scenes[1]
      if (hook && (!hook.caption || hook.captionHidden) && (next?.caption || '').length >= 8) {
        hook.caption = next.caption.slice(0, 38)
        hook.captionHidden = false
        next.caption = ''
        next.captionHidden = true
        changes.push(`promoted scene 2 caption to hook: "${hook.caption.slice(0, 30)}"`)
      }
    }

    if (changes.length && this.memory) {
      this.memory.learn('retention_low', { status: 'resolved', introducedIn: 'V4', preventedBy: 'RetentionSimulator', preferredFix: changes.join('; ') })
    }
    return { changes }
  }
}
