// Hook Analyzer — evaluates the opening scene for Shorts retention.
// Opening must show the story fast: no long intro, strong keyword, visual matches headline.
export class HookAnalyzer {
  analyze(scene, article) {
    const checks = {}
    const issues = []
    let score = 60

    // Story appears in first scene
    checks.storyPresent = !!scene?.narration || !!scene?.caption || !!article?.title
    if (!checks.storyPresent) issues.push('No story text in opening')

    // Strong keyword shown immediately
    checks.strongKeyword = !!(scene?.caption_focus || scene?.focus || scene?.keyword)
    if (!checks.strongKeyword) issues.push('No emphasis keyword in hook scene')

    // Short opening — narration not too long
    const narrationLen = (scene?.narration || '').length
    checks.shortIntro = narrationLen > 0 && narrationLen < 80
    if (narrationLen >= 80) issues.push(`Hook narration too long (${narrationLen} chars)`)

    // First visual supports the headline
    checks.visualSupports = !!(scene?.image || scene?.images?.length)
    if (!checks.visualSupports) issues.push('Hook scene has no visual')

    // First spoken sentence matches the on-screen hook keyword
    const narration = (scene?.narration || '').toLowerCase()
    const focus = (scene?.caption_focus || '').toLowerCase()
    checks.textMatches = !focus || narration.includes(focus)
    if (focus && !narration.includes(focus)) issues.push('Spoken text does not mention the hook keyword')

    const passed = Object.values(checks).filter(Boolean).length
    score = Math.round(60 + (passed / Object.keys(checks).length) * 40)

    return {
      hookScore: score,
      passed: score >= 85,
      checks,
      issues,
      recommendation: score < 85
        ? (issues.find(i => i.includes('keyword')) ? 'Move primary emphasis to Scene 1' : 'Tighten the opening — show the story within 2s')
        : 'Opening is strong',
    }
  }
}
