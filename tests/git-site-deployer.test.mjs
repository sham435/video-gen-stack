import { describe, it, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

describe('GitSiteDeployer', () => {
  let GitSiteDeployer
  let tmpRoot

  before(async () => {
    ({ GitSiteDeployer } = await import('../src/distribution/GitSiteDeployer.mjs'))
    tmpRoot = mkdtempSync(join(tmpdir(), 'git-site-deployer-test-'))
    // Simulated repo state after GitHubPagesDistributor ran
    mkdirSync(join(tmpRoot, 'public', 'videos'), { recursive: true })
    mkdirSync(join(tmpRoot, 'public', 'thumbnails'), { recursive: true })
    mkdirSync(join(tmpRoot, 'public', 'assets'), { recursive: true })
    mkdirSync(join(tmpRoot, 'production', 'runs', 'job-art-abc'), { recursive: true })
    mkdirSync(join(tmpRoot, 'output', 'data'), { recursive: true })
    mkdirSync(join(tmpRoot, 'output'), { recursive: true })
    writeFileSync(join(tmpRoot, 'public', 'videos.json'), '{"videos":[]}')
    writeFileSync(join(tmpRoot, 'public', 'video-detail.json'), '{"videoId":"vid1"}')
    writeFileSync(join(tmpRoot, 'public', 'videos', 'vid1.json'), '{"id":"vid1"}')
    writeFileSync(join(tmpRoot, 'output', 'data', 'publication-ledger.json'), '{"entries":[]}')
    writeFileSync(join(tmpRoot, 'production', 'runs', 'job-art-abc', 'publication.json'), '{"ok":true}')
  })

  after(() => {
    if (tmpRoot) rmSync(tmpRoot, { recursive: true, force: true })
  })

  function makeRunner({ ghAuthOk = true, failingStage = null, blobFailures = 0 } = {}) {
    const calls = []
    const gh = (args, opts) => {
      calls.push(args.join(' '))
      const joined = args.join(' ')
      if (joined.includes('auth status')) {
        if (!ghAuthOk) throw new Error('not logged in')
        return '✓ Logged in to github.com as test-user'
      }

      if (joined.includes('git/ref/heads/main')) return 'a'.repeat(40)
      if (joined.includes('git/blobs')) {
        if (blobFailures > 0) {
          blobFailures--
          throw new Error('blob api unavailable (blobFailures left)')
        }
        return JSON.stringify({ sha: 'b'.repeat(40) })
      }
      if (joined.includes('git/trees')) return JSON.stringify({ sha: 'c'.repeat(40) })
      if (joined.includes('git/commits')) return JSON.stringify({ sha: 'd'.repeat(40) })
      if (joined.includes('git/refs/heads/main')) return JSON.stringify({ ref: 'refs/heads/main', object: { sha: 'd'.repeat(40) } })
      return ''
    }
    const run = (cmd, args, opts = {}) => {
      if (cmd === 'node' && args[0]?.includes('update-videos')) return 'updated videos'
      if (cmd === 'node' && args[0]?.includes('update-video-detail')) return 'updated detail'
      if (cmd === 'gh') return gh(args, opts)
      throw new Error(`unexpected cmd ${cmd}`)
    }
    return { run, calls }
  }

  it('skips under TEST_PUBLISH', async () => {
    const { run } = makeRunner()
    const d = new GitSiteDeployer({ root: tmpRoot, run })
    const res = await d.deploy({ outDir: 'output', jobId: 'job-art-abc', videoId: 'vid1', testPublish: true })
    assert.equal(res.state, 'SKIPPED')
    assert.match(res.reason, /TEST_PUBLISH/)
  })

  it('skips when gh is not authenticated (file exists but api fails softly)', async () => {
    const { run } = makeRunner({ ghAuthOk: false })
    const d = new GitSiteDeployer({ root: tmpRoot, run })
    const res = await d.deploy({ outDir: 'output', jobId: 'job-art-abc' })
    assert.equal(res.state, 'SKIPPED')
  })

  it('regenerates both feed scripts then commits via gh-API blob→tree→commit→ref', async () => {
    const { run } = makeRunner()
    const d = new GitSiteDeployer({ root: tmpRoot, run })
    const res = await d.deploy({ outDir: 'output', jobId: 'job-art-abc', videoId: 'vid1' })
    assert.equal(res.state, 'SUCCESS')
    assert.equal(res.pushedSha, 'd'.repeat(40))
    assert.ok(res.changedFiles.length >= 4) // videos.json, detail json, per-video json, publication.json, ledger
    // Order: ref read → per-file blob → tree → commit → ref update
    assert.ok(res.changedFiles.some(f => f.ghPath === 'public/videos.json'))
    assert.ok(res.changedFiles.some(f => f.ghPath === 'public/video-detail.json'))
    assert.ok(res.changedFiles.some(f => f.ghPath === 'public/videos/vid1.json'))
    assert.ok(res.changedFiles.some(f => f.ghPath === 'output/data/publication-ledger.json'))
  })

  it('returns FAILED (best-effort, never throws) when blobs keep failing', async () => {
    const { run } = makeRunner({ blobFailures: 10 })
    const d = new GitSiteDeployer({ root: tmpRoot, run })
    const res = await d.deploy({ outDir: 'output', jobId: 'job-art-abc' })
    assert.equal(res.state, 'FAILED')
    assert.match(res.reason, /blob/)
  })

  it('stages the freshly rendered mp4 into public/videos/{videoId}.mp4', async () => {
    // Write a real final.mp4 into a temp output dir
    const mp4 = Buffer.alloc(4096, 7)
    writeFileSync(join(tmpRoot, 'output', 'final.mp4'), mp4)
    const { run } = makeRunner()
    const d = new GitSiteDeployer({ root: tmpRoot, run })
    const res = await d.deploy({ outDir: 'output', jobId: 'job-art-abc', videoId: 'vid1' })
    assert.ok(res.changedFiles.some(f => f.ghPath === 'public/videos/vid1.mp4'))
  })

  it('skips mp4 staging when the file exceeds the size guard', async () => {
    const big = Buffer.alloc(61 * 1024 * 1024) // > 60MB guard
    writeFileSync(join(tmpRoot, 'output', 'final.mp4'), big)
    const { run } = makeRunner()
    const d = new GitSiteDeployer({ root: tmpRoot, run })
    const res = await d.deploy({ outDir: 'output', jobId: 'job-art-abc', videoId: 'vid2' })
    assert.ok(!res.changedFiles.some(f => f.ghPath === 'public/videos/vid2.mp4'))
  })
})