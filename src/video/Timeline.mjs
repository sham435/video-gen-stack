export class Timeline {
  constructor(scenes, fps = 30) {
    this.scenes = scenes
    this.fps = fps
    this.totalFrames = this.calculateTotalFrames()
    this.currentFrame = 0
  }

  calculateTotalFrames() {
    const lastScene = this.scenes[this.scenes.length - 1]
    return Math.ceil((lastScene.end) * this.fps)
  }

  getSceneForFrame(frameIndex) {
    const time = frameIndex / this.fps
    for (const scene of this.scenes) {
      if (time >= scene.start && time < scene.end) {
        const sceneDuration = scene.end - scene.start
        const progress = (time - scene.start) / sceneDuration
        return { scene, progress, time }
      }
    }
    return { scene: this.scenes[this.scenes.length - 1], progress: 1, time }
  }

  getActiveWordTimings(script, sceneDuration) {
    const words = script.split(' ')
    const perWord = sceneDuration / words.length
    return words.map((word, i) => ({
      word,
      start: i * perWord,
      end: (i + 1) * perWord + 0.05,
    }))
  }

  getActiveWordIndex(wordTimings, sceneTime) {
    for (let i = 0; i < wordTimings.length; i++) {
      if (sceneTime >= wordTimings[i].start && sceneTime <= wordTimings[i].end) return i
    }
    return -1
  }
}
