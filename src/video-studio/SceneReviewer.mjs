export class SceneReviewer {
  review(scenes) {
    return scenes.map((s, i) => ({
      id: s.id || i + 1,
      index: i,
      type: s.type,
      duration: s.duration || 3,
      start: s.start || 0,
      end: s.end || 3,
      issues: this.findIssues(s, i, scenes),
      score: this.scoreScene(s),
      narration: s.narration || '',
      caption: s.caption || '',
      camera: s.camera || 'static',
      transition: s.transition || 'cut',
      emotion: s.emotion || 'neutral',
    }))
  }

  findIssues(scene, i, all) {
    const issues = []
    const dur = scene.duration || 3
    if (dur > 6) issues.push({ type: 'warning', message: `Scene ${i+1} is ${dur.toFixed(1)}s — aim for 2-5s per scene` })
    if (dur < 1.5) issues.push({ type: 'warning', message: `Scene ${i+1} is too short (${dur.toFixed(1)}s)` })
    if (!scene.narration && scene.type !== 'close') issues.push({ type: 'info', message: `Scene ${i+1} has no narration` })
    if (!scene.visual?.prompt && scene.type !== 'close') issues.push({ type: 'info', message: `Scene ${i+1} has no visual prompt` })
    if (scene.camera === 'static' || !scene.camera) issues.push({ type: 'info', message: `Scene ${i+1} has no camera movement` })
    if (i > 0 && all[i-1]?.transition === scene.transition) issues.push({ type: 'info', message: `Scene ${i} and ${i+1} use same transition` })
    return issues
  }

  scoreScene(scene) {
    let score = 70
    if (scene.narration) score += 10
    if (scene.visual?.prompt) score += 10
    if (scene.camera && scene.camera !== 'static') score += 5
    if (scene.transition && scene.transition !== 'cut') score += 5
    return Math.min(100, score)
  }
}
