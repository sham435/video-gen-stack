import { AIQualityScorer } from '../quality/AIQualityScorer.mjs'
import { RetentionPredictor } from '../quality/RetentionPredictor.mjs'
import { ImprovementEngine } from '../quality/ImprovementEngine.mjs'

export class ScoreEngine {
  constructor() {
    this.scorer = new AIQualityScorer()
    this.predictor = new RetentionPredictor()
    this.improver = new ImprovementEngine()
  }

  rate(scenes, technical, category, duration) {
    const quality = this.scorer.score(scenes, technical, duration)
    const retention = this.predictor.predict(scenes, category)
    const suggestions = this.improver.suggest(quality, scenes, technical)
    const publish = this.improver.shouldPublish(quality)
    const brandScore = this.brandConsistency(scenes)
    const audioScore = this.audioQuality(scenes)
    const finalScore = Math.round((quality.overall + retention.score + brandScore + audioScore) / 4)

    return {
      scores: {
        technical: technical?.technicalScore || 0,
        story: quality.story,
        visual: quality.visual,
        audio: audioScore,
        retention: retention.score,
        brand: brandScore,
        overall: finalScore,
      },
      quality,
      retention,
      suggestions,
      publish,
    }
  }

  brandConsistency(scenes) {
    let score = 85
    const close = scenes.find(s => s.type === 'close')
    if (!close) score -= 20
    if (scenes.length < 4) score -= 10
    return Math.min(100, score)
  }

  audioQuality(scenes) {
    let score = 80
    const hasNarration = scenes.some(s => s.narration?.length > 10)
    if (!hasNarration) score -= 30
    const sfx = scenes.some(s => s.sfx && s.sfx !== 'none')
    if (sfx) score += 10
    return Math.min(100, score)
  }
}
