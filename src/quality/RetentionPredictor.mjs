const PATTERNS = {
  high: { hookTypes: ['mystery', 'shock', 'curiosity'], durations: [25, 35], minScenes: 5, maxScenes: 7 },
  medium: { hookTypes: ['fact', 'announcement'], durations: [20, 45], minScenes: 3, maxScenes: 6 },
  low: { hookTypes: ['summary', 'intro'], durations: [15, 60], minScenes: 2, maxScenes: 4 },
}

export class RetentionPredictor {
  predict(scenes, category) {
    const hookType = scenes[0]?.emotion || 'fact'
    const sceneCount = scenes.length
    const totalDuration = scenes.reduce((s, s2) => s + (s2.duration || 3), 0)
    const avgSceneDur = totalDuration / Math.max(1, sceneCount)

    let score = 60

    if (avgSceneDur >= 2 && avgSceneDur <= 4) score += 15
    else if (avgSceneDur > 5) score -= 10

    if (sceneCount >= 5 && sceneCount <= 7) score += 10
    else if (sceneCount < 3) score -= 15

    if (totalDuration >= 25 && totalDuration <= 40) score += 10
    else if (totalDuration > 50) score -= 10

    if (['shock', 'curiosity', 'mystery'].includes(hookType)) score += 15
    else if (hookType === 'tension') score += 5

    const categoryBonus = { gaming: 8, ai: 5, technology: 3, sports: 5, politics: -5 }
    score += categoryBonus[category] || 0

    score = Math.max(10, Math.min(99, score))

    const label = score >= 75 ? 'HIGH' : score >= 50 ? 'MEDIUM' : 'LOW'
    return { score, label, avgSceneDuration: Math.round(avgSceneDur * 10) / 10, totalDuration, sceneCount }
  }
}
