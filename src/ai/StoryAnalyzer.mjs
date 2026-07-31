const EMOTION_INTENSITY = {
  shock: 0.9,
  tension: 0.8,
  awe: 0.7,
  excitement: 0.6,
  curiosity: 0.5,
  neutral: 0.3,
}

const SCENE_PACING = {
  hook: 0.3,
  fact: 0.5,
  reveal: 0.4,
  explanation: 0.25,
  reaction: 0.35,
  close: 0.2,
}

const EMOTION_TEMP = {
  shock: 0.1,
  tension: 0.15,
  awe: 0.7,
  excitement: 0.6,
  curiosity: 0.5,
  neutral: 0.5,
}

const ZOOM_TARGET = {
  hook: 'close',
  fact: 'medium',
  reveal: 'extreme_close',
  explanation: 'wide',
  reaction: 'medium',
  close: 'wide',
}

export class EmotionalArcAnalyzer {
  analyze(scenes, article) {
    return scenes.map((scene) => {
      const emotion = scene.emotion || 'neutral'
      const intensity = EMOTION_INTENSITY[emotion] || 0.5
      return {
        intensity,
        pacing: SCENE_PACING[scene.type] || 0.35,
        colorTemperature: EMOTION_TEMP[emotion] || 0.5,
        zoomTarget: ZOOM_TARGET[scene.type] || 'medium',
        revealTiming: this.getRevealTiming(emotion, intensity),
        visualDensity: intensity > 0.6 ? 'high' : intensity > 0.4 ? 'medium' : 'low',
      }
    })
  }

  getRevealTiming(emotion, intensity) {
    const timings = {
      shock: 0.15,
      awe: 0.3,
      curiosity: 0.25,
      tension: 0.4,
      excitement: 0.2,
      neutral: 0.5,
    }
    return timings[emotion] || 0.3
  }
}

const MOTION_PROFILES = {
  high: {
    zoomAmount: 1.04,
    parallaxOffset: 25,
    shakeIntensity: 0.6,
    lightSweep: true,
    particleIntensity: 0.7,
    depthBlur: 0.3,
  },
  medium: {
    zoomAmount: 1.025,
    parallaxOffset: 15,
    shakeIntensity: 0.3,
    lightSweep: false,
    particleIntensity: 0.35,
    depthBlur: 0.15,
  },
  low: {
    zoomAmount: 1.01,
    parallaxOffset: 5,
    shakeIntensity: 0,
    lightSweep: false,
    particleIntensity: 0.1,
    depthBlur: 0,
  },
}

export class MotionPlanner {
  enrich(scenes, emotionalArc) {
    scenes.forEach((scene, i) => {
      const arc = emotionalArc[i]
      const profile = this.getProfile(arc)
      scene.motion = {
        ...profile,
        pausePoints: this.findPausePoints(scene, arc),
        zoomSmoothness: arc.pacing > 0.4 ? 0.3 : 0.6,
      }
    })
  }

  getProfile(arc) {
    if (arc.intensity > 0.6) return { ...MOTION_PROFILES.high }
    if (arc.intensity > 0.4) return { ...MOTION_PROFILES.medium }
    return { ...MOTION_PROFILES.low }
  }

  findPausePoints(scene, arc) {
    const points = []
    if (arc.revealTiming > 0 && arc.revealTiming < 1) {
      points.push(arc.revealTiming)
    }
    if (scene.type === 'fact' || scene.type === 'reveal') {
      points.push(0.5)
    }
    return [...new Set(points)].sort()
  }
}

export class TransitionPlanner {
  enrich(scenes, emotionalArc) {
    for (let i = 1; i < scenes.length; i++) {
      const prev = emotionalArc[i - 1]
      const curr = emotionalArc[i]
      const diff = Math.abs(curr.intensity - prev.intensity)
      const type = this.select(scenes[i].type, curr.intensity, diff, prev)
      scenes[i].transitionIn = {
        type,
        duration: this.getDuration(diff, type),
        intensity: Math.min(1, diff * 1.5),
      }
    }
  }

  select(type, intensity, diff, prevArc) {
    if (diff > 0.5) return 'glitch'
    if (intensity > 0.7 && type === 'hook') return 'flash'
    if (type === 'explanation' || type === 'close') return 'zoom_blur'
    if (type === 'reaction' && prevArc.intensity > 0.6) return 'light_leak'
    if (type === 'reveal') return 'glitch'
    return 'crossfade'
  }

  getDuration(diff, type) {
    if (type === 'glitch') return 0.15 + diff * 0.2
    if (type === 'flash') return 0.1
    if (type === 'zoom_blur') return 0.25 + diff * 0.15
    if (type === 'light_leak') return 0.3 + diff * 0.2
    return 0.2 + diff * 0.2
  }
}