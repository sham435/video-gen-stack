import { ViewerBehaviorModel } from './ViewerBehaviorModel.mjs'

// Viewer Retention Simulator — the third feedback dimension.
//
// Predicts whether a viewer will stay until the end by simulating attention
// decay second-by-second across the timeline, using the calibrated
// ViewerBehaviorModel hazard rates. Outputs retention score, aggregate drop
// zones, confidence-weighted per-scene drop risks, and structured
// recommendations. optimize() applies safe deterministic fixes — duration
// trims, key-fact promotion (reorder), hook caption strengthening — and
// learns the performance patterns into ProductionMemory.
export class RetentionSimulator {
  constructor(options = {}) {
    this.memory = options.memory || null
    this.viewers = options.viewers || 100
    this.completionThreshold = options.threshold || 55
    this.model = new ViewerBehaviorModel({ memory: this.memory })
  }

  // Second-by-second simulation across the full timeline (floats internally
  // so low hazard rates don't quantize into phantom drop zones)
  simulate(scenes) {
    const curve = []
    let survivors = this.viewers
    let cursor = 0
    for (const scene of scenes) {
      const dur = Math.max(1, Math.round(scene.duration || 3))
      const hz = this.model.hazard(scene)
      for (let t = 0; t < dur; t++) {
        survivors = Math.max(0, survivors * (1 - hz))
        curve.push({ second: cursor + t, sceneId: scene.id, survivors })
      }
      cursor += dur
    }
    return curve
  }

  evaluate(scenes) {
    if (!scenes?.length) return { retentionScore: 0, completionRate: 0, avgWatch: 0, curve: [], dropZones: [], dropRisks: [], recommendations: [] }
    const curve = this.simulate(scenes)
    const total = curve.length
    const final = curve.length ? curve[curve.length - 1].survivors : 0
    const completion = Math.round((final / this.viewers) * 100)
    const avgWatch = total ? curve.reduce((s, p) => s + p.survivors, 0) / this.viewers : 0
    const retentionScore = Math.round((0.6 * completion) + (0.4 * (avgWatch / Math.max(1, total)) * 100))

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

    // Confidence-weighted drop risks, best first. All risks are collected,
    // sorted by confidence, then deduped to at most 2 per scene so the list
    // stays diverse and low-confidence structural risks can still surface
    // once memory calibration boosts them.
    const all = scenes.flatMap(s => this.model.risks(s).map(r => ({ scene: s.id, risk: r.type, confidence: r.confidence, detail: r.detail })))
    all.sort((a, b) => b.confidence - a.confidence)
    const perSceneCount = new Map()
    const dropRisks = []
    for (const r of all) {
      const n = perSceneCount.get(r.scene) || 0
      if (n >= 3) continue
      perSceneCount.set(r.scene, n + 1)
      dropRisks.push(r)
      if (dropRisks.length >= 8) break
    }

    // Structured recommendations from the highest-confidence risks
    const recommendations = []
    const seen = new Set()
    for (const r of [...dropRisks, ...scenes.flatMap(s => this.model.risks(s).map(x => ({ scene: s.id, risk: x.type, confidence: x.confidence }))).sort((a, b) => b.confidence - a.confidence)]) {
      const scene = scenes.find(s => s.id === r.scene)
      const rec = this.model.recommendations(scene, r)
      if (rec.action !== 'monitor' && !seen.has(rec.action + r.scene)) {
        recommendations.push(rec)
        seen.add(rec.action + r.scene)
      }
      if (recommendations.length >= 5) break
    }

    return { retentionScore, completionRate: completion, avgWatch: Math.round(avgWatch * 10) / 10, curve, dropZones, dropRisks, recommendations }
  }

  _zoneReason(scene, dropped) {
    if (scene.type === 'hook') return 'hook too weak — early drop-off'
    if ((scene.duration || 3) > 4) return 'scene too long'
    if (!scene.retentionPlan && scene.camera === 'static') return 'static motion — no visual change'
    if (scene.judge?.issues?.length) return `judge friction: ${scene.judge.issues[0]}`
    if (scene.visualRelevanceScore != null && scene.visualRelevanceScore < 55) return 'weak visual relevance'
    return 'mid-roll attention decay'
  }

  // Safe deterministic optimization from structured recommendations.
  // Returns the list of applied changes; mutates scenes in place.
  optimize(scenes, result) {
    const changes = []
    if (!scenes?.length) return { changes }

    for (const rec of result.recommendations || []) {
      const scene = scenes.find(s => s.id === rec.scene)
      if (!scene) continue
      switch (rec.action) {
        case 'shorten_scene': {
          const before = scene.duration
          scene.duration = Math.max(3, Math.round((before - (rec.seconds || 1.5)) * 10) / 10)
          if (scene.duration < before) changes.push(`trimmed scene ${rec.scene} ${before}s → ${scene.duration}s`)
          break
        }
        case 'move_key_fact_forward': {
          // Bring a fact/reaction scene ahead of post-hook exposition (safe swap)
          if (scenes[0]?.type === 'hook' && scenes[1]?.type === 'explanation' && ['fact', 'reaction'].includes(scenes[2]?.type)) {
            const idx1 = scenes.indexOf(scenes[1])
            const idx2 = scenes.indexOf(scenes[2])
            ;[scenes[idx1], scenes[idx2]] = [scenes[idx2], scenes[idx1]]
            changes.push(`reordered: key fact (scene ${scenes[idx1].id}) moved before exposition (scene ${scenes[idx2].id})`)
          }
          break
        }
        case 'strengthen_hook': {
          const hook = scenes.find(s => s.type === 'hook')
          const next = scenes[1]
          if (hook && (!hook.caption || hook.captionHidden) && (next?.caption || '').length >= 8) {
            hook.caption = next.caption.slice(0, 38)
            hook.captionHidden = false
            next.caption = ''
            next.captionHidden = true
            changes.push(`promoted scene 2 caption to hook: "${hook.caption.slice(0, 30)}"`)
          }
          break
        }
        case 'truncate_caption': {
          if ((scene.caption || '').length > 38) {
            scene.caption = scene.caption.slice(0, 38)
            changes.push(`truncated scene ${rec.scene} caption to 38 chars`)
          }
          break
        }
        // replace_visual / add_motion / fix_scene_issues are handled by the
        // judge + semantic ranker; here they are advisory only.
      }
    }

    // Learn performance patterns: each risk on a touched scene becomes a
    // calibrated rule (negative retentionImpact, smoothed over frequency)
    if (changes.length && this.memory) {
      const touchedScenes = new Set()
      for (const c of changes) {
        const m = c.match(/scene (\d+)/)
        if (m) touchedScenes.add(Number(m[1]))
      }
      for (const r of result.dropRisks || []) {
        if (touchedScenes.has(r.scene)) {
          this.memory.learn(r.risk, { status: 'detected', introducedIn: 'V4', preventedBy: null, retentionImpact: -5 })
        }
      }
      this.memory.learn('retention_low', { status: 'resolved', introducedIn: 'V4', preventedBy: 'RetentionSimulator', preferredFix: changes.join('; ') })
    }
    return { changes }
  }
}
