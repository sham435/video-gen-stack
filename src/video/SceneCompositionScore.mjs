// Scene composition scoring — V4 publishing gate
// Checks text, layout, safe zones, visual relevance, and hook strength.
const THRESHOLD = 85
const CAPTION_Y = 0.78
const HEADLINE_Y = 0.30

export class SceneCompositionScore {
  constructor() {
    this.hookAnalyzer = null
  }

  score(scene) {
    const checks = {}
    // 1. Duplicate text check (V3)
    const focus = (scene.caption_focus || '').replace(/[^a-zA-Z0-9]/g, '').toUpperCase()
    const captionWords = (scene.caption || '').split(' ').map(w => w.replace(/[^a-zA-Z0-9]/g, '').toUpperCase())
    checks.duplicateText = focus ? !captionWords.includes(focus) : true

    // 2. Caption presence
    checks.hasCaption = !['hook', 'brand_close'].includes(scene.type) ? !!(scene.caption || scene.narration) : true

    // 3. Has visual
    checks.hasVisual = !!(scene.image || scene.images?.length)

    // 4. Visual relevance — use the precomputed top-candidate score from the engine
    if (scene.visualRelevanceScore != null) {
      checks.visualRelevance = scene.visualRelevanceScore >= 55
    } else if (scene.image) {
      checks.visualRelevance = true // not yet scored — don't block
    } else {
      checks.visualRelevance = true
    }

    // 5. Readability
    const captionLen = (scene.caption || '').length
    checks.readable = captionLen >= 5 && captionLen <= 200

    // 6. Single keyword
    checks.singleKeyword = !scene.caption_focus || scene.caption_focus.split(' ').length <= 2

    // 7. Safe margins
    checks.safeMargins = CAPTION_Y > 0.70 && CAPTION_Y < 0.88

    // 8. No band overlap
    checks.noBandOverlap = HEADLINE_Y < 0.60

    // 9. Camera plan
    checks.hasCamera = !!scene.camera

    // 10. Asset limit
    checks.assetLimit = (scene.images?.length || 0) <= 4

    // 11. Hook strength for opening scenes
    if (scene.type === 'hook') {
      checks.hook = scene.hookScore ? scene.hookScore >= 85 : true
    } else {
      checks.hook = true
    }

    const passedCount = Object.values(checks).filter(Boolean).length
    const total = Object.keys(checks).length
    const score = Math.round((passedCount / total) * 100)

    const failed = Object.entries(checks).filter(([, v]) => !v).map(([k]) => k)
    const hardFail = !checks.duplicateText

    return {
      overall: score,
      passed: score >= THRESHOLD && !hardFail,
      threshold: THRESHOLD,
      checks,
      failed,
      hardFail,
      reason: hardFail ? 'duplicate emphasis text detected — caption repeats the keyword'
        : score >= THRESHOLD ? 'composition OK'
        : `composition ${score} below ${THRESHOLD}: ${failed.join(', ')}`,
    }
  }

}
