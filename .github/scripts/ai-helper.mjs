#!/usr/bin/env node
/**
 * AI Pipeline Manager — NEWS-MONSTER | Anchor: sham435
 *
 * Modes:
 *   debug   — Parse GitHub Actions logs for known errors, suggest/codefix
 *   enhance — Scan stack for improvements, output suggestions JSON
 *   health  — Check all env vars, assets, and dependencies
 *   fix     — Auto-apply known fixes (creates PR if changes made)
 *   pr      — Create PR from detected issues
 */

import fs from 'fs'
import path from 'path'
import { createRequire } from 'module'
import { fileURLToPath } from 'url'
import { execFileSync } from 'child_process'
import 'dotenv/config'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const PROJECT_ROOT = path.resolve(__dirname, '..', '..')
const require = createRequire(import.meta.url)
dotenvFallbackLoad()

// dotenv loads from process.cwd(); when run via an npm script the cwd is the
// project root already, but guard against invocations from elsewhere.
function dotenvFallbackLoad() {
  try {
    const local = path.join(PROJECT_ROOT, '.env')
    if (!process.env.PEXELS_API_KEY && fs.existsSync(local)) {
      const parsed = require('dotenv').parse(fs.readFileSync(local))
      Object.assign(process.env, parsed)
    }
  } catch { /* non-fatal */ }
}

const KNOWN_FIXES = {
  sidechaincompress: {
    error: 'sidechaincompress',
    match: /sidechaincompress|sidechain|Invalid argument.*sidechain/g,
    fix: 'Replace sidechaincompress with amix 12% duck',
    auto: true,
    apply: () => applyReplace('scripts/composer.mjs', /sidechaincompress[^)]+\)/g, 'amix=inputs=2:duration=longest:dropout_transition=0:normalize=0'),
  },
  canvas_binding: {
    error: '@napi-rs/canvas',
    match: /Cannot find native binding|@napi-rs\/canvas-linux/g,
    fix: 'Use npm install not npm ci --omit=optional',
    auto: true,
    apply: () => applyReplace('.github/workflows/publish-news.yml', /npm ci --omit=optional/g, 'npm install --include=optional'),
  },
  pexels_401: {
    error: 'Pexels API 401',
    match: /Pexels.*401|pexels.*unauthorized|401.*pexels/gi,
    fix: 'Fallback to OG scraper (already built in)',
    auto: true,
    apply: () => null,
  },
  music_null: {
    error: 'getRandomMusic() null',
    match: /getRandomMusic.*null|music.*not found|No music file/gi,
    fix: 'ensureMusicExists() + pink noise fallback',
    auto: true,
    apply: () => null,
  },
  edge_tts_429: {
    error: 'edge-tts rate limit',
    match: /429.*edge-tts|edge-tts.*rate|Too Many Requests/gi,
    fix: 'Retry with exponential backoff',
    auto: false,
    apply: () => null,
  },
  ffmpeg_invalid: {
    error: 'FFmpeg invalid filter',
    match: /Error (opening|binding) filter|Filter.*not found|Invalid argument/gi,
    fix: 'Simplify filter chain, remove unsupported filters',
    auto: false,
    apply: () => null,
  },
  youtube_auth: {
    error: 'YouTube auth expired',
    match: /youtube.*401|refresh.*token.*invalid|unauthorized.*youtube/gi,
    fix: 'Re-run OAuth: node scripts/auth.mjs',
    auto: false,
    apply: () => null,
  },
}

// ===================================================================
// HELPERS
// ===================================================================

function applyReplace(filePath, pattern, replacement) {
  try {
    let content = fs.readFileSync(filePath, 'utf8')
    if (!content.match(pattern)) return null
    content = content.replace(pattern, replacement)
    fs.writeFileSync(filePath, content)
    return `✅ ${filePath}: fixed`
  } catch (e) {
    return `❌ ${filePath}: ${e.message}`
  }
}

function parseLogs(logText) {
  if (!logText) return []
  return Object.values(KNOWN_FIXES).filter(r => r.match.test(logText))
}

function getLatestRunLogs() {
  try {
    const runId = execFileSync('gh', ['run', 'list', '--workflow=Publish News Video', '--limit=1', '--json=databaseId', '--jq=.[0].databaseId'], {
      encoding: 'utf8', timeout: 15000, stdio: 'pipe',
    }).trim()
    if (!runId) return ''
    return execFileSync('gh', ['run', 'view', runId, '--log'], { encoding: 'utf8', timeout: 30000, stdio: 'pipe' })
  } catch { return '' }
}

// ===================================================================
// STACK ENHANCEMENT SCANNER
// ===================================================================

function enhanceStack() {
  const suggestions = []
  let composer = ''; try { composer = fs.readFileSync('scripts/composer.mjs', 'utf8') } catch {}

  // Subtitles
  if (!composer.includes('generateSRT') && !composer.includes('burnSubtitles')) {
    suggestions.push({
      level: 'HIGH', title: 'Add burned subtitles', impact: '+40% retention (85% watch muted)',
      detail: 'Word-by-word SRT with glass background. Already in captions.mjs, just wire into composer',
      code: "const { generateSRT, burnSubtitles } = await import('./captions.mjs')",
      autoFix: true,
    })
  }

  // Narration quality
  if (composer.includes('hooks.join')) {
    suggestions.push({
      level: 'MED', title: 'Improve TTS script with full article summary', impact: 'Better retention',
      detail: 'Current script only uses hooks — add article.description for context',
      autoFix: true,
    })
  }

  // Multi-image slideshow
  if (!composer.includes('images.length > 1')) {
    suggestions.push({
      level: 'HIGH', title: 'Multi-image slideshow (3 Pexels images)', impact: '+25% retention',
      detail: 'Fetch 3 images from Pexels, concat with zoompan per image as B-roll',
      autoFix: false,
    })
  }

  // Pexels NER
  suggestions.push({
    level: 'MED', title: 'Improve Pexels keywords with NER', impact: 'More relevant images',
    detail: 'Use compromise NLP for noun/entity extraction from article title',
    autoFix: false,
  })

  // Ken Burns
  if (composer.includes('zoompan')) {
    suggestions.push({
      level: 'LOW', title: 'Add Ken Burns to image frames too', impact: 'Cinematic feel',
      detail: 'Currently only huge text frames have zoompan — extend to B-roll images',
      autoFix: true,
    })
  }

  // Video description
  suggestions.push({
    level: 'LOW', title: 'Add hashtags + timestamps to YouTube description', impact: 'SEO boost',
    detail: 'Auto-generate description with #tech #news + scene timestamps',
    autoFix: false,
  })

  return suggestions
}

// ===================================================================
// CREATE PR FROM FIXES
// ===================================================================

function createAutoPR(issues, fixes) {
  const branch = `fix/auto-${Date.now().toString(36)}`
  const issueList = issues.map(i => `- **${i.error}**: ${i.fix}`).join('\n')
  const fixList = fixes.filter(Boolean).join('\n')

  try {
    execFileSync('git', ['checkout', '-b', branch], { stdio: 'pipe', timeout: 10000 })
    execFileSync('git', ['add', '-A'], { stdio: 'pipe', timeout: 10000 })
    const hasChanges = execFileSync('git', ['diff', '--cached', '--stat'], { encoding: 'utf8', timeout: 5000 }).trim()
    if (!hasChanges) {
      execFileSync('git', ['checkout', 'main'], { stdio: 'pipe' })
      execFileSync('git', ['branch', '-D', branch], { stdio: 'pipe' })
      return { pr: null, reason: 'no changes to commit' }
    }

    execFileSync('git', ['commit', '-m', `fix: auto-apply detected pipeline fixes\n\n${issueList}\n${fixList}`], { stdio: 'pipe', timeout: 10000 })
    execFileSync('git', ['push', 'origin', branch], { stdio: 'pipe', timeout: 15000 })

    const prTitle = `auto-fix: ${issues.length} pipeline issue${issues.length > 1 ? 's' : ''} detected`
    const prBody = `## 🤖 AI Auto-Fix\n\nDetected and applied fixes for:\n\n${issueList}\n\n### Changes\n${fixList || 'No file changes needed (config/env fix)'}\n\n---\n*Generated by AI Pipeline Manager*`

    const prUrl = execFileSync(
      'gh',
      ['pr', 'create', '--title', prTitle, '--body', prBody, '--base', 'main'],
      { encoding: 'utf8', timeout: 15000, stdio: 'pipe' },
    ).trim()

    return { pr: prUrl, branch, issues: issues.length, fixes: fixes.filter(Boolean).length }
  } catch (e) {
    return { pr: null, error: e.message }
  }
}

// ===================================================================
// MAIN
// ===================================================================

const mode = process.argv[2] || 'health'
console.log(`\n╔══════════════════════════════════════╗`)
console.log(`║  🤖 AI Pipeline Manager            ║`)
console.log(`║  NEWS-MONSTER | anchor: sham435      ║`)
console.log(`║  Mode: ${mode.padEnd(29)}║`)
console.log(`╚══════════════════════════════════════╝\n`)

// — DEBUG MODE —
if (mode === 'debug' || mode === 'full') {
  const log = process.env.LOGS || getLatestRunLogs()
  const issues = parseLogs(log)

  if (!issues.length) {
    console.log('✅ No known errors detected in logs')
  } else {
    console.log(`🚨 ${issues.length} known error${issues.length > 1 ? 's' : ''} detected:\n`)
    issues.forEach(i => console.log(`  ❌ ${i.error}`))
    console.log()
  }

  for (const issue of issues) {
    const fixMsg = issue.auto ? '🔧 AUTO-FIX AVAILABLE' : '⚠️  MANUAL FIX REQUIRED'
    console.log(`  ${fixMsg}: ${issue.fix}`)
    if (issue.auto && issue.apply) {
      const result = issue.apply()
      if (result) console.log(`    ${result}`)
    }
  }

  // Auto-fix: try to apply all auto fixes
  const autoFixes = issues.filter(i => i.auto && i.apply).map(i => i.apply()).filter(Boolean)

  if (autoFixes.length > 0) {
    console.log(`\n✅ ${autoFixes.length} auto-fix${autoFixes.length > 1 ? 'es' : ''} applied`)
    const pr = createAutoPR(issues, autoFixes)
    if (pr.pr) {
      console.log(`📬 PR created: ${pr.pr}`)
    } else if (pr.reason) {
      console.log(`ℹ️  ${pr.reason}`)
    }
  }

  // Save debug report
  fs.mkdirSync('output', { recursive: true })
  fs.writeFileSync('output/ai_debug.json', JSON.stringify({
    timestamp: new Date().toISOString(),
    mode: 'debug',
    issues: issues.map(i => ({ error: i.error, fix: i.fix, auto: i.auto })),
    fixes_applied: autoFixes.length,
  }, null, 2))
}

// — ENHANCE MODE —
if (mode === 'enhance' || mode === 'full') {
  const suggestions = enhanceStack()
  console.log(`\n💡 ${suggestions.length} stack enhancement suggestions:\n`)
  suggestions.forEach(s => console.log(`  [${s.level}] ${s.title}`))
  console.log()

  fs.writeFileSync('output/ai_suggestions.json', JSON.stringify(suggestions, null, 2))
}

// — HEALTH MODE —
function musicTrackCount() {
  try {
    const dir = path.resolve(PROJECT_ROOT, 'assets', 'music')
    if (!fs.existsSync(dir)) return 0
    return fs.readdirSync(dir).filter((f) => /^nm-track-.+\.mp3$/.test(f)).length
  } catch {
    return 0
  }
}

if (mode === 'health' || mode === 'full') {
  const checks = [
    { n: 'PEXELS_API_KEY', ok: !!process.env.PEXELS_API_KEY },
    { n: 'NEWSAPI_KEY', ok: !!process.env.NEWSAPI_KEY },
    { n: 'YOUTUBE_REFRESH_TOKEN', ok: !!process.env.YOUTUBE_REFRESH_TOKEN },
    { n: 'YOUTUBE_CLIENT_ID', ok: !!process.env.YOUTUBE_CLIENT_ID },
    { n: 'YOUTUBE_CLIENT_SECRET', ok: !!process.env.YOUTUBE_CLIENT_SECRET },
    { n: 'CRON_SECRET', ok: !!process.env.CRON_SECRET },
    { n: 'node_modules', ok: fs.existsSync('node_modules/@napi-rs/canvas') },
    { n: 'Music engine', ok: fs.existsSync('scripts/gen-music.mjs') },
    { n: 'Background music', ok: musicTrackCount() > 0 },
    { n: 'Anton font', ok: fs.existsSync('assets/fonts/Anton-Regular.ttf') },
    { n: 'composer.mjs', ok: fs.existsSync('scripts/composer.mjs') },
    { n: 'intro.mjs', ok: fs.existsSync('scripts/intro.mjs') },
    { n: 'pexels.mjs', ok: fs.existsSync('scripts/pexels.mjs') },
  ]

  console.log(`🏥 Health Check:\n`)
  checks.forEach(c => console.log(`  ${c.ok ? '✅' : '❌'} ${c.n}`))

  const score = Math.round(checks.filter(c => c.ok).length / checks.length * 100)
  console.log(`\n📊 Health Score: ${score}%\n`)

  fs.writeFileSync('output/ai_health.json', JSON.stringify({
    timestamp: new Date().toISOString(),
    score,
    checks,
  }, null, 2))
}

if (mode === 'full') {
  console.log('═══════════════════════════════════════')
  console.log('✅ Full scan complete')
  console.log('═══════════════════════════════════════')
}
