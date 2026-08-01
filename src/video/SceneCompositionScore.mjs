// Scene composition scoring — validates text layout, safe zones, readability
const THRESHOLD = 85

export class SceneCompositionScore {
  score(scene) {
    const checks = {}
    // 1. Duplicate text check — emphasis word vs caption
    const focus = (scene.caption_focus || '').replace(/[^a-zA-Z0-9]/g, '').toUpperCase()
    const captionWords = (scene.caption || '').split(' ').map(w => w.replace(/[^a-zA-Z0-9]/g, '').toUpperCase())
    checks.duplicateText = focus ? !captionWords.includes(focus) : true

    // 2. Caption presence — fact/retention scenes must have captions
    checks.hasCaption = !['hook', 'brand_close'].includes(scene.type) ? !!(scene.caption || scene.narration) : true

    // 3. Has visual — scenes should have an image or gradient
    checks.hasVisual = !!(scene.image || scene.images?.length)

    // 4. Readability proxy — caption length reasonable
    const captionLen = (scene.caption || '').length
    checks.readable = captionLen >= 5 && captionLen <= 200

    // 5. Camera plan present
    checks.hasCamera = !!scene.camera

    const passed = Object.values(checks).filter(Boolean).length
    const score = Math.round((passed / Object.keys(checks).length) * 100)

    return {
      overall: score,
      passed: score >= THRESHOLD,
      threshold: THRESHOLD,
      checks,
      reason: score >= THRESHOLD ? 'composition OK' : `composition ${score} below ${THRESHOLD}: ${Object.entries(checks).filter(([,v]) => !v).map(([k]) => k).join(', ')}`,
    }
  }
}
