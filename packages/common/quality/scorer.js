export class QualityScorer {
  score(storyboard, videoPath) {
    const validation = storyboard.validate ? storyboard.validate(storyboard) : { score: 100, issues: [] }

    const scores = {
      visual: this.visualScore(storyboard),
      audio: 85, // Conservative estimate (actual check needs ffprobe)
      text: this.textScore(storyboard),
      brand: this.brandScore(storyboard),
    }

    const total = Math.round(Object.values(scores).reduce((a, b) => a + b, 0) / Object.values(scores).length)

    return {
      scores,
      total,
      passed: total >= 75,
      issues: validation.issues,
      published: total >= 75 ? 'APPROVED' : 'REJECTED',
    }
  }

  visualScore(storyboard) {
    let score = 100
    const themes = storyboard.scenes?.map(s => s.theme) || []
    const uniqueThemes = new Set(themes)

    if (uniqueThemes.size === 0) score -= 30
    if (storyboard.scenes?.length < 3) score -= 15
    if (storyboard.scenes?.length > 8) score -= 5

    return Math.max(0, score)
  }

  textScore(storyboard) {
    let score = 100

    for (const scene of storyboard.scenes || []) {
      const headline = scene.headline || ''
      if (headline.length < 15) score -= 10
      if (headline.length > 150) score -= 5
      // Check for clickbait
      const clickbait = ['shocking', 'you won\'t believe', 'mind blowing', 'incredible']
      if (clickbait.some(w => headline.toLowerCase().includes(w))) {
        score -= 20
      }
    }

    return Math.max(0, score)
  }

  brandScore(storyboard) {
    let score = 100
    const brand = storyboard.brand

    if (!brand?.channelName) score -= 30
    if (!brand?.logoText) score -= 20

    for (const scene of storyboard.scenes || []) {
      if (scene.brand?.channelName !== brand?.channelName) {
        score -= 10
      }
    }

    return Math.max(0, score)
  }
}
