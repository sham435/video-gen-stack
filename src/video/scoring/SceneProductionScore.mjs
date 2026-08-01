// AI Production Score — weighted 100-pt score combining visual/motion/story/audio/brand/retention
const WEIGHTS = { visual: 25, motion: 20, story: 20, audio: 15, brand: 10, retention: 10 }
const THRESHOLD = 85

export class SceneProductionScore {
  score(scene) {
    const components = {}

    // Visual quality (25)
    let visual = 50
    if (scene.image || scene.images?.length) visual += 25
    if (scene.effects?.visualPipeline?.length) visual += 15
    if (scene.directorLayout) visual += 10
    components.visual = Math.min(100, visual)

    // Motion (20)
    let motion = 50
    if (scene.camera) motion += 25
    if (scene.cameraPlan?.motion) motion += 15
    if (scene.retentionPlan?.length) motion += 10
    components.motion = Math.min(100, motion)

    // Story impact (20)
    let story = 50
    if (scene.narration || scene.caption) story += 25
    if (scene.emotion) story += 15
    if (scene.type === 'hook' || scene.type === 'reveal') story += 10
    components.story = Math.min(100, story)

    // Audio immersion (15)
    let audio = 50
    if (scene.audioPipeline?.length || scene.effects?.audioPipeline?.length) audio += 30
    if (scene.music_cue) audio += 20
    components.audio = Math.min(100, audio)

    // Brand consistency (10)
    let brand = 50
    if (scene.category) brand += 25
    if (scene.colors) brand += 25
    components.brand = Math.min(100, brand)

    // Retention potential (10)
    let retention = 50
    if (scene.retentionPlan?.length) retention += 30
    if (scene.type === 'hook') retention += 20
    components.retention = Math.min(100, retention)

    const total = Math.round(Object.entries(components).reduce((s, [k, v]) => s + v * WEIGHTS[k], 0) / 100)
    const failed = Object.entries(components).filter(([, v]) => v < 70).map(([k]) => k)

    return {
      overall: total,
      threshold: THRESHOLD,
      passed: total >= THRESHOLD,
      weights: WEIGHTS,
      components,
      failed,
      reason: total >= THRESHOLD ? 'production ready' : `production score ${total} below ${THRESHOLD}: ${failed.join(', ')}`,
    }
  }
}
