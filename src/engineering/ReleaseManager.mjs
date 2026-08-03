import { execFileSync } from 'child_process'
import fs from 'fs'

export class ReleaseManager {
  constructor() {
    this.version = this.readVersion()
  }

  readVersion() {
    try {
      const pkg = JSON.parse(fs.readFileSync('package.json', 'utf-8'))
      return pkg.version || '1.0.0'
    } catch { return '1.0.0' }
  }

  generateNotes() {
    const log = this.getGitLog()
    const commits = this.parseCommits(log)

    return {
      version: this.version,
      date: new Date().toISOString().slice(0, 10),
      commits: commits.length,
      features: commits.filter(c => c.type === 'feat').map(c => c.message),
      fixes: commits.filter(c => c.type === 'fix').map(c => c.message),
      other: commits.filter(c => !['feat', 'fix'].includes(c.type)).map(c => c.message),
      contributors: [...new Set(commits.map(c => c.author).filter(Boolean))],
      stats: this.repoStats(),
    }
  }

  getGitLog() {
    try {
      const tags = execFileSync('git', ['tag', '--sort=-creatordate'], { timeout: 3000 }).toString().trim().split('\n').filter(Boolean)
      const range = tags.length > 0 ? `${tags[0]}..HEAD` : '--all'
      return execFileSync('git', ['log', range, '--oneline', '--format=%h|%s|%an', '--no-merges'], { timeout: 5000 }).toString().trim()
    } catch {
      try { return execFileSync('git', ['log', '--oneline', '--format=%h|%s|%an', '-30', '--no-merges'], { timeout: 5000 }).toString().trim() } catch { return '' }
    }
  }

  parseCommits(log) {
    if (!log) return []
    return log.split('\n').filter(Boolean).map(line => {
      const [hash, ...rest] = line.split('|')
      const full = rest.join('|') || ''
      const type = full.startsWith('feat') ? 'feat' : full.startsWith('fix') ? 'fix' : 'other'
      const message = full.replace(/^(feat|fix)\(?\w*\)?:\s*/i, '').split('|')[0] || full
      return { hash: hash?.slice(0, 7) || '', message: message.slice(0, 80), type, author: line.split('|')[2] || '' }
    })
  }

  repoStats() {
    try {
      const list = execFileSync('git', ['ls-files', 'src/', 'scripts/', 'packages/'], { timeout: 3000 }).toString().trim().split('\n').filter(Boolean)
      const wc = execFileSync('wc', ['-l', ...list], { timeout: 10000, maxBuffer: 16 * 1024 * 1024 }).toString().trim().split('\n')
      const total = parseInt(wc[wc.length - 1]?.trim().split(/\s+/)[0] || '0')
      return { files: list.length, lines: total || 0 }
    } catch { return { files: 0, lines: 0 } }
  }

  bumpVersion(type = 'patch') {
    const parts = this.version.split('.').map(Number)
    if (type === 'major') { parts[0]++; parts[1] = 0; parts[2] = 0 }
    else if (type === 'minor') { parts[1]++; parts[2] = 0 }
    else { parts[2]++ }
    return parts.join('.')
  }
}
