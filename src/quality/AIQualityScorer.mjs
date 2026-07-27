export class AIQualityScorer {
  score(scenes, technical, duration) {
    const hook = this.scoreHook(scenes)
    const story = this.scoreStory(scenes)
    const visual = this.scoreVisual(scenes)
    const voice = this.scoreVoice(scenes, duration)
    const retention = this.predictRetention(hook, story, visual, voice)
    const overall = Math.round((hook + story + visual + voice + retention) / 5)

    return {
      hook,
      story,
      visual,
      voice,
      retention,
      overall,
      details: this.explain(hook, story, visual, voice, retention),
    }
  }

  scoreHook(scenes) {
    const hook = scenes.find(s => s.type === 'hook')
    if (!hook) return 30
    let score = 80
    const text = (hook.narration || hook.caption || '').length
    if (text < 20) score += 10
    if (text > 80) score -= 10
    if (hook.duration >= 2 && hook.duration <= 3.5) score += 5
    if (hook.camera === 'push_in' || hook.camera === 'shake') score += 5
    return Math.min(100, score)
  }

  scoreStory(scenes) {
    if (!scenes || scenes.length < 3) return 40
    let score = 70
    if (scenes.length >= 5) score += 10
    if (scenes.length <= 7) score += 5
    const types = new Set(scenes.map(s => s.type))
    if (types.has('hook') && types.has('fact') && types.has('explanation') && types.has('close')) score += 10
    return Math.min(100, score)
  }

  scoreVisual(scenes) {
    if (!scenes || scenes.length === 0) return 30
    let score = 70
    const changes = scenes.filter(s => s.visual?.prompt || s.visual?.type !== 'gradient')
    if (changes.length === scenes.length) score += 10
    if (scenes.every(s => s.transition && s.transition !== 'cut')) score += 10
    if (scenes.some(s => s.camera && s.camera !== 'static')) score += 10
    return Math.min(100, score)
  }

  scoreVoice(scenes, duration) {
    const narrations = scenes.filter(s => s.narration?.trim())
    if (narrations.length === 0) return 30
    let score = 80
    const totalWords = narrations.reduce((sum, s) => sum + (s.narration || '').split(' ').length, 0)
    const wpm = duration > 0 ? totalWords / (duration / 60) : 0
    if (wpm >= 120 && wpm <= 180) score += 10
    if (wpm > 220) score -= 10
    return Math.min(100, score)
  }

  predictRetention(hook, story, visual, voice) {
    const avg = (hook + story + visual + voice) / 4
    if (avg >= 80) return 85
    if (avg >= 60) return 70
    return 50
  }

  explain(hook, story, visual, voice, retention) {
    const issues = []
    if (hook < 70) issues.push('Hook needs to be stronger — first 3 seconds must grab attention')
    if (story < 60) issues.push('Story structure needs more scenes (aim for 5-7)')
    if (visual < 60) issues.push('Add per-scene visuals and transitions')
    if (voice < 60) issues.push('Voiceover pacing should be 120-180 words per minute')
    if (retention < 60) issues.push('Predicted retention is low — consider shorter duration')
    return issues
  }
}
