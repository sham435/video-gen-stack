// Retention Director — plans a visual/motion/audio/information change every 2-3 seconds
// so viewers never see a static frame. Returns per-scene pacing cues.
const CHANGE_INTERVAL = 2.5

export class RetentionDirector {
  plan(scenes) {
    return (scenes || []).map((scene, i) => {
      const duration = scene.duration || 3
      const changes = []
      let t = 0
      let changeType = 0
      const effectPool = ['camera_push', 'CGI_reveal', 'data_animation', 'particle_burst', 'zoom_pulse', 'light_sweep']
      while (t < duration) {
        changes.push({
          at: Math.round(Math.min(t, duration) * 10) / 10,
          effect: effectPool[(changeType + i) % effectPool.length],
          type: ['visual', 'motion', 'information'][changeType % 3],
        })
        t += CHANGE_INTERVAL
        changeType++
      }
      return {
        sceneId: scene.id || i + 1,
        duration,
        changeAt: changes.map(c => c.at),
        plan: changes,
      }
    })
  }

  static get CHANGE_INTERVAL() { return CHANGE_INTERVAL }
}
