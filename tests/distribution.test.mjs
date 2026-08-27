import { describe, it, before, after, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

const tmpDir = mkdtempSync(join(tmpdir(), 'distribution-test-'))

describe('PublicationArtifact', () => {
  let PublicationArtifact

  before(async () => {
    ({ PublicationArtifact } = await import('../src/distribution/PublicationArtifact.mjs'))
  })

  it('creates artifact with defaults', () => {
    const a = new PublicationArtifact()
    assert.ok(a.createdAt)
    assert.equal(a.destinations.youtube.state, 'PENDING')
    assert.equal(a.destinations.githubPages.state, 'PENDING')
    assert.equal(a.destinations.linkedin.state, 'PENDING')
  })

  it('serializes and restores from JSON', () => {
    const a = new PublicationArtifact({
      artifactId: 'test-123',
      title: 'Test Video',
      thumbnailPath: '/tmp/thumb.png',
    })
    const json = a.toJSON()
    const restored = PublicationArtifact.fromJSON(json)
    assert.equal(restored.artifactId, 'test-123')
    assert.equal(restored.metadata.title, 'Test Video')
  })
})

describe('DistributionOrchestrator', () => {
  let DistributionOrchestrator, DistributionState, PublicationArtifact

  before(async () => {
    const mod1 = await import('../src/distribution/DistributionOrchestrator.mjs')
    DistributionOrchestrator = mod1.DistributionOrchestrator
    const mod2 = await import('../src/distribution/DistributionState.mjs')
    DistributionState = mod2.DistributionState
    const mod3 = await import('../src/distribution/PublicationArtifact.mjs')
    PublicationArtifact = mod3.PublicationArtifact
  })

  it('fans out to all destinations', async () => {
    const artifact = new PublicationArtifact({ artifactId: 'fan-test' })
    const mockDistributor = {
      distribute: async () => ({ state: DistributionState.SUCCESS, durationMs: 10 }),
    }
    const orchestrator = new DistributionOrchestrator({
      youtube: mockDistributor,
      githubPages: mockDistributor,
      linkedin: mockDistributor,
    })

    const result = await orchestrator.distribute(artifact)
    assert.equal(result.state, DistributionState.SUCCESS)
    assert.equal(result.results.youtube.state, DistributionState.SUCCESS)
    assert.equal(result.results.githubPages.state, DistributionState.SUCCESS)
    assert.equal(result.results.linkedin.state, DistributionState.SUCCESS)
  })

  it('one destination failure does not invalidate others', async () => {
    const artifact = new PublicationArtifact({ artifactId: 'partial-test' })
    const successDist = { distribute: async () => ({ state: DistributionState.SUCCESS, durationMs: 10 }) }
    const failDist = { distribute: async () => ({ state: DistributionState.FAILED, durationMs: 5, errors: [{ error: 'API error', classification: 'TRANSIENT' }] }) }

    const orchestrator = new DistributionOrchestrator({
      youtube: successDist,
      githubPages: successDist,
      linkedin: failDist,
    })

    const result = await orchestrator.distribute(artifact)
    assert.equal(result.results.youtube.state, DistributionState.SUCCESS)
    assert.equal(result.results.githubPages.state, DistributionState.SUCCESS)
    assert.equal(result.results.linkedin.state, DistributionState.FAILED)
  })

  it('handles missing distributors gracefully', async () => {
    const artifact = new PublicationArtifact({ artifactId: 'partial-dist' })
    const orchestrator = new DistributionOrchestrator({
      youtube: { distribute: async () => ({ state: DistributionState.SUCCESS, durationMs: 10 }) },
    })

    const result = await orchestrator.distribute(artifact)
    assert.equal(result.results.youtube.state, DistributionState.SUCCESS)
    assert.equal(result.results.githubPages, undefined)
    assert.equal(result.results.linkedin, undefined)
  })
})

describe('GitHubPagesDistributor', () => {
  let GitHubPagesDistributor, PublicationArtifact, DistributionState
  let publicDir

  before(async () => {
    const mod1 = await import('../src/distribution/GitHubPagesDistributor.mjs')
    GitHubPagesDistributor = mod1.GitHubPagesDistributor
    const mod2 = await import('../src/distribution/PublicationArtifact.mjs')
    PublicationArtifact = mod2.PublicationArtifact
    const mod3 = await import('../src/distribution/DistributionState.mjs')
    DistributionState = mod3.DistributionState
    publicDir = join(tmpDir, 'pages-' + Date.now())
    mkdirSync(publicDir, { recursive: true })
  })

  it('copies thumbnail and updates manifest', async () => {
    const thumbPath = join(tmpDir, 'test-thumb.png')
    writeFileSync(thumbPath, 'fake-png-data')

    const artifact = new PublicationArtifact({
      artifactId: 'pages-test',
      thumbnailPath: thumbPath,
      title: 'Test Video',
      category: 'science',
    })
    artifact.destinations.youtube.videoId = 'yt-123'
    artifact.destinations.youtube.url = 'https://youtu.be/yt-123'

    const dist = new GitHubPagesDistributor({ publicDir })
    const result = await dist.distribute(artifact)

    assert.equal(result.state, DistributionState.SUCCESS)
    assert.equal(result.thumbnailCopied, true)
    assert.equal(result.manifestUpdated, true)

    // Verify thumbnail was copied
    assert.ok(existsSync(join(publicDir, 'thumbnails', 'pages-test.png')))

    // Verify manifest
    const manifest = JSON.parse(readFileSync(join(publicDir, 'videos.json'), 'utf-8'))
    assert.equal(manifest.videos.length, 1)
    assert.equal(manifest.videos[0].id, 'pages-test')
    assert.equal(manifest.videos[0].youtubeId, 'yt-123')
    assert.equal(manifest.videos[0].thumbnailUrl, '/thumbnails/pages-test.png')
  })
})

describe('YouTubeDistributor', () => {
  let YouTubeDistributor, PublicationArtifact, DistributionState

  before(async () => {
    const mod1 = await import('../src/distribution/YouTubeDistributor.mjs')
    YouTubeDistributor = mod1.YouTubeDistributor
    const mod2 = await import('../src/distribution/PublicationArtifact.mjs')
    PublicationArtifact = mod2.PublicationArtifact
    const mod3 = await import('../src/distribution/DistributionState.mjs')
    DistributionState = mod3.DistributionState
  })

  it('records videoId on success', async () => {
    const thumbPath = join(tmpDir, 'yt-thumb.png')
    writeFileSync(thumbPath, 'fake-png')

    const artifact = new PublicationArtifact({
      artifactId: 'yt-test',
      videoPath: join(tmpDir, 'video.mp4'),
      thumbnailPath: thumbPath,
      title: 'Test YouTube Upload',
    })

    const dist = new YouTubeDistributor({
      publishVideo: async () => ({
        videoId: 'yt-abc',
        url: 'https://youtu.be/yt-abc',
        thumbnailUploaded: true,
      }),
    })

    const result = await dist.distribute(artifact)
    assert.equal(result.state, DistributionState.SUCCESS)
    assert.equal(result.videoId, 'yt-abc')
    assert.equal(result.url, 'https://youtu.be/yt-abc')
    assert.equal(result.thumbnail.state, DistributionState.SUCCESS)
  })

  it('records failure with classification', async () => {
    const artifact = new PublicationArtifact({ artifactId: 'yt-fail' })

    const dist = new YouTubeDistributor({
      publishVideo: async () => { throw Object.assign(new Error('insufficientPermissions'), { status: 403 }) },
    })

    const result = await dist.distribute(artifact)
    assert.equal(result.state, DistributionState.FAILED)
    assert.equal(result.errors[0].classification, 'AUTHORIZATION')
  })
})

describe('LinkedInDistributor', () => {
  let LinkedInDistributor, PublicationArtifact, DistributionState

  before(async () => {
    const mod1 = await import('../src/distribution/LinkedInDistributor.mjs')
    LinkedInDistributor = mod1.LinkedInDistributor
    const mod2 = await import('../src/distribution/PublicationArtifact.mjs')
    PublicationArtifact = mod2.PublicationArtifact
    const mod3 = await import('../src/distribution/DistributionState.mjs')
    DistributionState = mod3.DistributionState
  })

  it('skips when no shareImage configured', async () => {
    const artifact = new PublicationArtifact({ artifactId: 'li-skip' })
    const dist = new LinkedInDistributor()
    const result = await dist.distribute(artifact)
    assert.equal(result.state, DistributionState.SKIPPED)
  })

  it('calls shareImage with artifact data', async () => {
    const thumbPath = join(tmpDir, 'li-thumb.png')
    writeFileSync(thumbPath, 'fake-png')

    const artifact = new PublicationArtifact({
      artifactId: 'li-test',
      thumbnailPath: thumbPath,
      title: 'Test LinkedIn Post',
    })
    artifact.destinations.youtube.url = 'https://youtu.be/li-123'

    let capturedArgs = null
    const dist = new LinkedInDistributor({
      shareImage: async (args) => { capturedArgs = args; return { postId: 'li-post-1' } },
    })

    const result = await dist.distribute(artifact)
    assert.equal(result.state, DistributionState.SUCCESS)
    assert.equal(result.postId, 'li-post-1')
    assert.equal(capturedArgs.link, 'https://youtu.be/li-123')
  })
})

describe('DistributionFailure', () => {
  let DistributionFailure

  before(async () => {
    const mod = await import('../src/distribution/DistributionState.mjs')
    DistributionFailure = mod.DistributionFailure
  })

  it('classifies 403 as AUTHORIZATION', () => {
    const err = Object.assign(new Error('forbidden'), { status: 403 })
    assert.equal(DistributionFailure.classify(err), 'AUTHORIZATION')
  })

  it('classifies 429 as QUOTA', () => {
    const err = Object.assign(new Error('rate limit'), { status: 429 })
    assert.equal(DistributionFailure.classify(err), 'QUOTA')
  })

  it('classifies 500 as TRANSIENT', () => {
    const err = Object.assign(new Error('server error'), { status: 500 })
    assert.equal(DistributionFailure.classify(err), 'TRANSIENT')
  })

  it('classifies other as PERMANENT', () => {
    const err = new Error('bad request')
    assert.equal(DistributionFailure.classify(err), 'PERMANENT')
  })
})

describe('PublicationLedger distribution state', () => {
  let PublicationLedger, ledgerPath

  before(() => {
    ledgerPath = join(tmpDir, `ledger-dist-${Date.now()}.json`)
  })

  it('records and reads distribution state', async () => {
    const { PublicationLedger } = await import('../src/publishing/PublicationLedger.mjs')
    const ledger = new PublicationLedger({ filePath: ledgerPath })

    ledger.record({
      videoId: 'dist-123',
      jobId: 'job-dist',
      title: 'Distribution Test',
      uploadState: 'SUCCESS',
      thumbnailState: 'UPLOADED',
      verificationState: 'PENDING',
      distribution: {
        youtube: { state: 'SUCCESS', videoId: 'yt-dist' },
        githubPages: { state: 'SUCCESS' },
        linkedin: { state: 'SKIPPED' },
      },
    })

    const entry = ledger.findByVideoId('dist-123')
    assert.ok(entry)
    assert.equal(entry.distribution.youtube.state, 'SUCCESS')
    assert.equal(entry.distribution.youtube.videoId, 'yt-dist')
    assert.equal(entry.distribution.linkedin.state, 'SKIPPED')
  })
})

// Cleanup
after(() => {
  rmSync(tmpDir, { recursive: true, force: true })
})
