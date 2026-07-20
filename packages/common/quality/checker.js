export class QualityChecker {
  async check(article, script) {
    const headline = article.title || ''
    const issues = []
    let score = 100

    // 1. Headline length (40-70 chars ideal)
    if (headline.length < 20) { score -= 15; issues.push('headline too short') }
    if (headline.length > 120) { score -= 10; issues.push('headline too long') }
    if (headline.length >= 40 && headline.length <= 70) score += 5

    // 2. No offensive language (simple check)
    const offensive = ['fuck', 'shit', 'damn', 'ass', 'kill', 'hate']
    if (offensive.some(w => headline.toLowerCase().includes(w))) {
      score -= 50; issues.push('offensive language detected')
    }

    // 3. Has source
    if (!article.source?.name) { score -= 10; issues.push('no source') }

    // 4. Has description
    if (!article.description || article.description.length < 20) {
      score -= 10; issues.push('no or short description')
    }

    // 5. Script quality
    if (script) {
      if (script.length < 200) { score -= 10; issues.push('script too short') }
      if (script.length > 5000) { score -= 5; issues.push('script too long') }
    }

    return {
      score: Math.max(0, Math.min(100, score)),
      passed: score >= 70,
      issues,
      details: {
        headlineLength: headline.length,
        hasSource: !!article.source?.name,
        hasDescription: !!(article.description?.length > 20),
        scriptLength: script?.length || 0,
      },
    }
  }
}
