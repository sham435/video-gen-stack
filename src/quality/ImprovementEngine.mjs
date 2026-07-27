export class ImprovementEngine {
  suggest(score, scenes, technical) {
    const suggestions = []

    if (score.hook < 70) {
      suggestions.push({
        area: 'hook',
        priority: 'high',
        message: 'First 3 seconds need more impact. Try: mystery/reveal format, camera shake, breaking red banner.',
        action: 'Regenerate hook scene with stronger emotional trigger',
      })
    }

    if (score.story < 70) {
      suggestions.push({
        area: 'story',
        priority: 'high',
        message: `Story needs more structure. Currently ${scenes.length} scenes, aim for 5-7 with hook → facts → explanation → retention → close.`,
        action: 'Add missing scene types to template',
      })
    }

    if (score.visual < 70) {
      suggestions.push({
        area: 'visual',
        priority: 'medium',
        message: 'Every scene needs its own visual asset. Replace shared/gradient backgrounds with per-scene images.',
        action: 'Enable per-scene visual generation',
      })
    }

    if (score.voice < 60) {
      suggestions.push({
        area: 'voice',
        priority: 'medium',
        message: 'Voiceover pacing issue. Target 120-180 words per minute for optimal retention.',
        action: 'Reduce narration text or increase scene duration',
      })
    }

    if (score.retention < 60) {
      suggestions.push({
        area: 'retention',
        priority: 'high',
        message: 'Predicted retention below threshold. Shorten total duration and increase visual pace.',
        action: 'Set max duration to 35s and minimum 5 scenes',
      })
    }

    if (technical) {
      if (technical.blackFrames?.count > 0) {
        suggestions.push({
          area: 'technical',
          priority: 'critical',
          message: `${technical.blackFrames.count} black frames detected. Video may have rendering errors.`,
          action: 'Re-render with frame validation',
        })
      }
      if (technical.resolution && !technical.resolution.valid) {
        suggestions.push({
          area: 'technical',
          priority: 'critical',
          message: `Wrong resolution: ${technical.resolution.width}x${technical.resolution.height}, expected 1080x1920.`,
          action: 'Check render settings',
        })
      }
    }

    return suggestions
  }

  shouldPublish(score) {
    if (score.overall >= 80) return { decision: 'publish', reason: 'High quality score' }
    if (score.overall >= 60) return { decision: 'improve', reason: `Score ${score.overall}/100 — improvements recommended` }
    return { decision: 'reject', reason: `Score ${score.overall}/100 — below minimum threshold` }
  }
}
