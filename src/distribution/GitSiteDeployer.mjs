// GitSiteDeployer — commit the landing-page feed to GitHub (gh-API path).
//
// Mirrors the CI workflow (publish-news.yml "Refresh landing page video feed"
// + "Commit updated videos.json") but WITHOUT `git push`: the sandbox has no
// SSH/HTTPS push access, so the commit is assembled against the live
// refs/heads/main via GitHub's git-data API (blob → tree → commit → ref).
//
// Flow:
//   1. Regenerate public/videos.json from the verified PublicationLedger
//      (node scripts/update-videos.mjs — canonical, ledger-derived shape).
//   2. Regenerate public/video-detail.json + public/videos/{videoId}.json
//      (node scripts/update-video-detail.mjs — hub + OG/SEO detail pages).
//   3. Stage the freshly rendered mp4 into public/videos/{videoId}.mp4 so the
//      site's Download buttons work (same as the CI step, size-guarded).
//   4. Commit public/* + production/runs + output/data/publication-ledger.json
//      on top of the LIVE origin/main via gh-API, tolerating concurrent
//      commits (rebase-onto-latest on retry).
//
// Best-effort by design: a GitHub API hiccup must never fail or stall an
// otherwise-successful video publish (same contract as the LinkedIn post).

import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, readdirSync, mkdirSync, copyFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
export const ROOT = resolve(__dirname, '..', '..')

const DEFAULT_REPO = process.env.SITE_DEPLOY_REPO || 'sham435/video-gen-stack'
const COMMIT_MESSAGE = 'chore: refresh landing page video feed [skip ci]'

const MAX_MP4_BYTES = 60 * 1024 * 1024 // GitHub blob API limit is 100MB; be safe

export class GitSiteDeployer {
  constructor({ repo = DEFAULT_REPO, root = ROOT, run = null, gh = 'gh' } = {}) {
    this.repo = repo
    this.root = root
    this.gh = gh
    // Injectable command runner for tests. Default: real execFileSync.
    this.run = run || ((cmd, args, opts = {}) => execFileSync(cmd, args, { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'pipe'], ...opts }))
  }

  /**
   * Regenerate the feed, then commit it to the live branch via gh-API.
   * Always resolves — returns { state, reason, pushedSha, changedFiles[] }.
   * - SKIPPED  : disabled by env / TEST_PUBLISH / gh missing / nothing to commit
   * - SUCCESS  : commit created on refs/heads/main
   * - FAILED   : API error after retries (caller treats as best-effort)
   */
  async deploy({ outDir = 'output', jobId = null, videoId = null, testPublish = false } = {}) {
    try {
      if (testPublish || process.env.SITE_DEPLOY === '0') {
        return { state: 'SKIPPED', reason: 'site deploy disabled (TEST_PUBLISH or SITE_DEPLOY=0)' }
      }
      if (!this._ghAvailable()) {
        return { state: 'SKIPPED', reason: 'gh not authenticated' }
      }

      // 1) Regenerate feed from the ledger (canonical, idempotent).
      this.run('node', ['scripts/update-videos.mjs'], { cwd: this.root })
      try {
        this.run('node', ['scripts/update-video-detail.mjs'], { cwd: this.root })
      } catch (e) {
        console.log(`[SITE] update-video-detail.mjs failed (best-effort): ${e.message}`)
      }

      // 2) Stage the freshly rendered mp4 (same as CI; size-guarded).
      this._stageMp4(outDir, videoId)

      // 3) Collect changed/new feed files.
      const changedFiles = this._collectFiles({ jobId, videoId })
      if (changedFiles.length === 0) {
        return { state: 'SKIPPED', reason: 'no feed files to commit' }
      }

      // 4) Commit on top of the LIVE main; rebase-onto-latest on conflict-ish retry.
      let lastErr = null
      for (let attempt = 1; attempt <= 3; attempt++) {
        try {
          const headSha = this._getHeadSha()
          const blobs = this._createBlobs(changedFiles)
          const treeSha = this._createTree(headSha, blobs)
          const commitSha = this._createCommit(treeSha, headSha)
          this._updateRef(commitSha)
          console.log(`[SITE] feed committed to ${this.repo}@main (sha=${commitSha.slice(0, 12)} — ${changedFiles.length} file(s))`)
          return { state: 'SUCCESS', pushedSha: commitSha, changedFiles }
        } catch (e) {
          lastErr = e
          console.log(`[SITE] gh-API commit attempt ${attempt}/3 failed: ${e.message}`)
          if (attempt < 3) await new Promise(r => setTimeout(r, attempt * 3000))
        }
      }
      return { state: 'FAILED', reason: lastErr?.message }
    } catch (e) {
      return { state: 'FAILED', reason: e.message }
    }
  }

  _ghAvailable() {
    try {
      const out = this.run(this.gh, ['auth', 'status'], { stdio: ['ignore', 'pipe', 'pipe'] })
      return /logged in/i.test(out)
    } catch {
      return false
    }
  }

  _getHeadSha() {
    const out = this.run(this.gh, ['api', `repos/${this.repo}/git/ref/heads/main`, '--jq', '.object.sha'], { cwd: this.root })
    const sha = String(out || '').trim()
    if (!/^[0-9a-f]{40}$/.test(sha)) throw new Error(`invalid head sha: ${sha}`)
    return sha
  }

  _createBlobs(files) {
    const blobs = []
    for (const f of files) {
      const content = readFileSync(f.path)
      const payload = JSON.stringify({
        content: content.toString('base64'),
        encoding: 'base64',
      })
      const res = JSON.parse(this.run(this.gh, ['api', `repos/${this.repo}/git/blobs`, '--method', 'POST', '--input', '-'], {
        input: payload,
        cwd: this.root,
        stdio: ['pipe', 'pipe', 'pipe'],
      }))
      if (!res?.sha) throw new Error(`blob failed for ${f.path}`)
      blobs.push({ path: f.ghPath, mode: '100644', type: 'blob', sha: res.sha })
    }
    return blobs
  }

  _createTree(baseSha, blobs) {
    const payload = JSON.stringify({ base_tree: baseSha, tree: blobs })
    const res = JSON.parse(this.run(this.gh, ['api', `repos/${this.repo}/git/trees`, '--method', 'POST', '--input', '-'], {
      input: payload,
      cwd: this.root,
      stdio: ['pipe', 'pipe', 'pipe'],
    }))
    if (!res?.sha) throw new Error('tree creation failed')
    return res.sha
  }

  _createCommit(treeSha, parentSha) {
    const payload = JSON.stringify({
      message: COMMIT_MESSAGE,
      tree: treeSha,
      parents: [parentSha],
      author: { name: 'news-monster-bot', email: 'actions@users.noreply.github.com' },
    })
    const res = JSON.parse(this.run(this.gh, ['api', `repos/${this.repo}/git/commits`, '--method', 'POST', '--input', '-'], {
      input: payload,
      cwd: this.root,
      stdio: ['pipe', 'pipe', 'pipe'],
    }))
    if (!res?.sha) throw new Error('commit creation failed')
    return res.sha
  }

  _updateRef(commitSha) {
    const payload = JSON.stringify({ sha: commitSha, force: false })
    this.run(this.gh, ['api', `repos/${this.repo}/git/refs/heads/main`, '--method', 'PATCH', '--input', '-'], {
      input: payload,
      cwd: this.root,
      stdio: ['pipe', 'pipe', 'pipe'],
    })
  }

  _stageMp4(outDir, videoId) {
    const src = resolve(this.root, outDir, 'final.mp4')
    if (!videoId || !existsSync(src)) return
    const srcSize = existsSync(src) ? readFileSync(src).length : 0
    if (srcSize > MAX_MP4_BYTES) {
      console.log(`[SITE] skipping mp4 stage (${(srcSize / 1024 / 1024).toFixed(1)}MB > ${MAX_MP4_BYTES / 1024 / 1024}MB limit)`)
      return
    }
    const dest = resolve(this.root, 'public', 'videos', `${videoId}.mp4`)
    mkdirSync(dirname(dest), { recursive: true })
    copyFileSync(src, dest)
  }

  _collectFiles({ jobId, videoId }) {
    const files = []
    const add = (relPath) => {
      const abs = resolve(this.root, relPath)
      if (existsSync(abs)) files.push({ path: abs, ghPath: relPath })
    }

    add('public/videos.json')
    add('public/video-detail.json')

    // Per-video detail JSONs (+ mp4 when staged) under public/videos/*.
    const videosDir = resolve(this.root, 'public', 'videos')
    if (existsSync(videosDir)) {
      for (const entry of safeReaddir(videosDir)) {
        if (entry.endsWith('.json') || entry.endsWith('.mp4')) add(`public/videos/${entry}`)
      }
    }

    // Thumbnails for the published video.
    if (videoId) add(`public/thumbnails/${videoId}.png`)

    // Production acceptance records: composer writes per-job publication.json
    // under production/runs/{jobId}/, plus the aggregate ledger under output/.
    if (jobId) {
      const pubDir = resolve(this.root, 'production', 'runs', jobId)
      for (const entry of safeReaddir(pubDir)) {
        if (entry.endsWith('.json')) add(`production/runs/${jobId}/${entry}`)
      }
    }
    add('output/data/publication-ledger.json')

    // De-duplicate by ghPath (keep first).
    return [...new Map(files.map(f => [f.ghPath, f])).values()]
  }
}

// Safe sync readdir that returns [] on any failure (best-effort collection).
function safeReaddir(dir) {
  try {
    return readdirSync(dir)
  } catch {
    return []
  }
}