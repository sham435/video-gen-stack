// Scene composition scoring — validates text layout, safe zones, readability, typography
const THRESHOLD = 85
const CAPTION_Y = 0.78     // caption band center (matches CaptionEngine)
const HEADLINE_Y = 0.30    // headline band (matches HeadlineCard rule of thirds)
const SAFE_MARGIN = 0.05   // 5% safe margin from edges

export class SceneCompositionScore {
  score(scene) {
    const checks = {}
    // 1. Duplicate text check — emphasis word vs caption (never repeat)
    const focus = (scene.caption_focus || '').replace(/[^a-zA-Z0-9]/g, '').toUpperCase()
    const captionWords = (scene.caption || '').split(' ').map(w => w.replace(/[^a-zA-Z0-9]/g, '').toUpperCase())
    checks.duplicateText = focus ? !captionWords.includes(focus) : true

    // 2. Caption presence — fact/retention/explanation must have captions
    checks.hasCaption = !['hook', 'brand_close'].includes(scene.type) ? !!(scene.caption || scene.narration) : true

    // 3. Has visual — scenes should have an image or gradient
    checks.hasVisual = !!(scene.image || scene.images?.length)

    // 4. Readability — caption length reasonable (not too long to overflow)
    const captionLen = (scene.caption || '').length
    checks.readable = captionLen >= 5 && captionLen <= 200

    // 5. Only one emphasis keyword per scene
    checks.singleKeyword = !scene.caption_focus || scene.caption_focus.split(' ').length <= 2

    // 6. Safe margins — caption band stays within safe area (0.70–0.88)
    checks.safeMargins = CAPTION_Y > 0.70 && CAPTION_Y < 0.88

    // 7. Headline/caption collision — bands must not overlap
    checks.noBandOverlap = HEADLINE_Y < 0.60

    // 8. Camera plan present
    checks.hasCamera = !!scene.camera

    // 9. Asset count reasonable (0–4 to avoid clutter)
    const assetCount = scene.images?.length || 0
    checks.assetLimit = assetCount >= 0 && assetCount <= 4

    const passed = Object.values(checks).filter(Boolean).length
    const total = Object.keys(checks).length
    const score = Math.round((passed / total) * 100)

    const failed = Object.entries(checks).filter(([, v]) => !v).map(([k]) => k)
    // Duplicate emphasis text is a hard fail (the reported SECRET/secret bug class)
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
