import { execSync } from 'child_process'
import fs from 'fs'

export class PRReviewer {
  analyze() {
    const diff = this.getDiff()
    const files = this.getChangedFiles()
    const stats = this.getStats(files)
    const issues = this.findIssues(diff, files)
    const score = this.calcScore(issues, stats)

    return {
      score,
      files: files.length,
      additions: stats.additions,
      deletions: stats.deletions,
      issues,
      summary: this.summarize(score, stats, issues),
      labels: this.inferLabels(files),
      recommendation: score >= 80 ? 'Approve' : score >= 60 ? 'Approve after fixes' : 'Request changes',
    }
  }

  getDiff() {
    try { return execSync('git diff HEAD~1 -- . 2>/dev/null || git diff --cached', { cwd: process.cwd(), timeout: 5000 }).toString() } catch { return '' }
  }

  getChangedFiles() {
    try {
      const out = execSync('git diff --name-only HEAD~1 2>/dev/null || git diff --cached --name-only', { cwd: process.cwd(), timeout: 5000 }).toString().trim()
      return out ? out.split('\n').filter(Boolean) : []
    } catch { return [] }
  }

  getStats(files) {
    let additions = 0, deletions = 0
    for (const f of files) {
      try {
        const out = execSync(`git diff HEAD~1 -- "${f}" 2>/dev/null || git diff --cached -- "${f}"`, { cwd: process.cwd(), timeout: 3000 }).toString()
        for (const line of out.split('\n')) {
          if (line.startsWith('+') && !line.startsWith('+++')) additions++
          if (line.startsWith('-') && !line.startsWith('---')) deletions++
        }
      } catch {}
    }
    return { additions, deletions }
  }

  findIssues(diff, files) {
    const issues = []
    if (!diff) return issues

    if (/console\.log/.test(diff)) issues.push({ severity: 'low', message: 'Console.log statements present — remove before merge' })
    if (/TODO/i.test(diff)) issues.push({ severity: 'low', message: 'TODO comments found — address or track' })
    if (/execSync/.test(diff)) issues.push({ severity: 'medium', message: 'execSync blocks event loop — consider async alternative' })
    if (/\.only\(/.test(diff)) issues.push({ severity: 'high', message: 'Test .only() detected — will skip other tests' })
    if (/skip\(/.test(diff)) issues.push({ severity: 'low', message: 'Skipped tests found — enable before merge' })
    if (/api_key|secret|password|token/i.test(diff)) issues.push({ severity: 'critical', message: 'Potential secret leak in diff — check before commit' })
    if (/Math\.random\(\)/.test(diff)) issues.push({ severity: 'low', message: 'Math.random() used — not suitable for security contexts' })

    const hasTests = files.some(f => f.includes('test') || f.includes('spec'))
    if (!hasTests && files.length > 0) issues.push({ severity: 'medium', message: 'No test files changed — add tests for new code' })

    const hasDocs = files.some(f => f.includes('README') || f.includes('.md'))
    if (!hasDocs && files.some(f => f.endsWith('.mjs'))) issues.push({ severity: 'low', message: 'No documentation updated' })

    return issues
  }

  calcScore(issues, stats) {
    let score = 100
    for (const i of issues) {
      if (i.severity === 'critical') score -= 25
      if (i.severity === 'high') score -= 15
      if (i.severity === 'medium') score -= 8
      if (i.severity === 'low') score -= 3
    }
    if (stats.additions > 500) score -= 10
    if (stats.additions < 50 && stats.additions > 0) score += 5
    return Math.max(0, Math.min(100, score))
  }

  summarize(score, stats, issues) {
    const severity = score >= 80 ? '✅' : score >= 60 ? '⚠️' : '❌'
    const critical = issues.filter(i => i.severity === 'critical').length
    const high = issues.filter(i => i.severity === 'high').length
    const medium = issues.filter(i => i.severity === 'medium').length
    return `${severity} Score: ${score}/100 | +${stats.additions}/-${stats.deletions} lines | ${critical} critical, ${high} high, ${medium} medium issues`
  }

  inferLabels(files) {
    const labels = []
    if (files.some(f => f.startsWith('src/video/') || f.startsWith('src/visuals/'))) labels.push('video-engine')
    if (files.some(f => f.startsWith('src/ai/'))) labels.push('ai-engine')
    if (files.some(f => f.startsWith('src/audio/'))) labels.push('audio-engine')
    if (files.some(f => f.startsWith('src/quality/') || f.startsWith('src/video-studio/'))) labels.push('quality')
    if (files.some(f => f.startsWith('packages/dashboard/'))) labels.push('dashboard')
    if (files.some(f => f.startsWith('.github/'))) labels.push('ci-cd')
    if (files.some(f => f.endsWith('.test.mjs') || f.endsWith('.spec.mjs'))) labels.push('tests')
    if (files.some(f => f.endsWith('.md'))) labels.push('documentation')
    return labels
  }
}
