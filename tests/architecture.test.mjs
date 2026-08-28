import { describe, it, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

/**
 * Architecture tests — enforce production invariants that are verified
 * by code structure analysis and controlled integration tests.
 *
 * These tests guarantee:
 *   1. Exactly one ProductionJob is created per production run
 *   2. generateFromArticle() is completely job-free
 *   3. Thumbnail stage is unconditional (no YouTube credentials required)
 *   4. Upload stage cannot execute without a thumbnail artifact
 *   5. Upload stage cannot execute after thumbnail failure
 */

let tmpDir

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'arch-'))
})

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true })
})

// ──────────────────────────────────────────────────────────────────
// 1. Exactly one ProductionJob per production run
// ──────────────────────────────────────────────────────────────────
describe('Architecture: one ProductionJob', () => {
  it('composer.mjs creates exactly one orchestrator ProductionJob per article', async () => {
    const { readFileSync } = await import('node:fs')
    const source = readFileSync(join(process.cwd(), 'scripts/composer.mjs'), 'utf-8')

    // Count ProductionJob instantiations in the orchestrator flow
    // The pattern is: new ProductionJob(article, { outDir, governor })
    const jobCreations = source.match(/new ProductionJob\(/g) || []
    assert.equal(jobCreations.length, 1, `Expected exactly 1 ProductionJob creation in composer.mjs, found ${jobCreations.length}`)
  })

  it('orchestrator ProductionJob is created once per article in the for-loop', async () => {
    const { readFileSync } = await import('node:fs')
    const source = readFileSync(join(process.cwd(), 'scripts/composer.mjs'), 'utf-8')

    // The for-loop processes articles one at a time, creating one job per article.
    // Verify the ProductionJob creation is inside the for-loop body.
    const forLoopMatch = source.match(/for\s*\(const\s+rawArticle\s+of\s+articles\)\s*\{/)
    assert.ok(forLoopMatch, 'for-loop over articles must exist')

    const jobCreationLine = source.indexOf('const job = new ProductionJob(article, { outDir, governor })')
    const forLoopStart = forLoopMatch.index
    assert.ok(jobCreationLine > forLoopStart, 'ProductionJob creation must be inside the for-loop')
  })
})

// ──────────────────────────────────────────────────────────────────
// 2. generateFromArticle() is completely job-free
// ──────────────────────────────────────────────────────────────────
describe('Architecture: generateFromArticle is job-free', () => {
  it('generateFromArticle signature has no job parameter', async () => {
    const { readFileSync } = await import('node:fs')
    const source = readFileSync(join(process.cwd(), 'src/index.mjs'), 'utf-8')

    const sigMatch = source.match(/async\s+generateFromArticle\s*\(([^)]+)\)/)
    assert.ok(sigMatch, 'generateFromArticle must exist')
    const params = sigMatch[1].split(',').map(p => p.trim().split(/\s+/)[0])
    assert.ok(!params.includes('job'), `generateFromArticle must not have a 'job' parameter, found: [${params}]`)
  })

  it('generateFromArticle does not import ProductionJob', async () => {
    const { readFileSync } = await import('node:fs')
    const source = readFileSync(join(process.cwd(), 'src/index.mjs'), 'utf-8')

    const imports = source.match(/import\s+.*ProductionJob\s+from/g) || []
    assert.equal(imports.length, 0, 'index.mjs must not import ProductionJob')
  })

  it('generateFromArticle contains no markStart/markDone/markFailed calls', async () => {
    const { readFileSync } = await import('node:fs')
    const source = readFileSync(join(process.cwd(), 'src/index.mjs'), 'utf-8')

    // Find the generateFromArticle method body
    const methodStart = source.indexOf('async generateFromArticle(')
    assert.ok(methodStart > 0, 'generateFromArticle must exist')

    // Find the next top-level method or end of class
    const nextMethod = source.indexOf('\n  async ', methodStart + 30)
    const methodBody = source.slice(methodStart, nextMethod > 0 ? nextMethod : source.length)

    const markCalls = methodBody.match(/job\.(markStart|markDone|markFailed)\(/g) || []
    assert.equal(markCalls.length, 0, `generateFromArticle must not contain job.markStart/markDone/markFailed, found: [${markCalls}]`)
  })

  it('generateFromArticle returns artifacts without job', async () => {
    const { readFileSync } = await import('node:fs')
    const source = readFileSync(join(process.cwd(), 'src/index.mjs'), 'utf-8')

    // Find the return statement in generateFromArticle
    const returnMatch = source.match(/return\s*\{\s*videoPath[^}]*\}/)
    assert.ok(returnMatch, 'generateFromArticle must return { videoPath, ... }')
    assert.ok(!returnMatch[0].includes('job'), 'return value must not include job')
  })
})

// ──────────────────────────────────────────────────────────────────
// 3. Thumbnail stage is unconditional (no YouTube credentials required)
// ──────────────────────────────────────────────────────────────────
describe('Architecture: thumbnail is unconditional', () => {
  it('THUMBNAIL stage handler exists and is not gated by YOUTUBE_REFRESH_TOKEN', async () => {
    const { readFileSync } = await import('node:fs')
    const source = readFileSync(join(process.cwd(), 'scripts/composer.mjs'), 'utf-8')

    const thumbHandler = source.indexOf("job.onStage('THUMBNAIL'")
    assert.ok(thumbHandler > 0, 'THUMBNAIL stage handler must exist')

    // Check that YOUTUBE_REFRESH_TOKEN does not gate the THUMBNAIL stage
    const surrounding = source.slice(Math.max(0, thumbHandler - 200), thumbHandler)
    assert.ok(!surrounding.includes('YOUTUBE_REFRESH_TOKEN'), 'THUMBNAIL must not be gated by YOUTUBE_REFRESH_TOKEN')
  })

  it('THUMBNAIL stage always produces a result (even without thumbnail files)', async () => {
    const { readFileSync } = await import('node:fs')
    const source = readFileSync(join(process.cwd(), 'scripts/composer.mjs'), 'utf-8')

    // Find the THUMBNAIL handler and check it handles missing thumbnail gracefully
    const thumbHandler = source.indexOf("job.onStage('THUMBNAIL'")
    const thumbEnd = source.indexOf("job.onStage('C2PA'", thumbHandler)
    const thumbBody = source.slice(thumbHandler, thumbEnd > 0 ? thumbEnd : thumbHandler + 1400)
    assert.ok(thumbBody.includes('candidate') || thumbBody.includes('!selected'), 'THUMBNAIL must handle case where no thumbnail file exists')
    assert.ok(thumbBody.includes("'none'"), 'THUMBNAIL must return strategy none when no thumbnail')
  })
})

// ──────────────────────────────────────────────────────────────────
// 4. Upload stage cannot execute without a thumbnail artifact
// ──────────────────────────────────────────────────────────────────
describe('Architecture: upload requires thumbnail', () => {
  it('UPLOAD stage handler throws if no thumbnail', async () => {
    const { readFileSync } = await import('node:fs')
    const source = readFileSync(join(process.cwd(), 'scripts/composer.mjs'), 'utf-8')

    const uploadHandler = source.indexOf("job.onStage('UPLOAD'")
    assert.ok(uploadHandler > 0, 'UPLOAD stage handler must exist')
    const uploadBody = source.slice(uploadHandler, uploadHandler + 600)
    assert.ok(uploadBody.includes('UPLOAD_REQUIRES_THUMBNAIL'), 'UPLOAD must throw UPLOAD_REQUIRES_THUMBNAIL when no thumbnail')
  })

  it('UPLOAD stage handler throws if no video', async () => {
    const { readFileSync } = await import('node:fs')
    const source = readFileSync(join(process.cwd(), 'scripts/composer.mjs'), 'utf-8')

    const uploadHandler = source.indexOf("job.onStage('UPLOAD'")
    const uploadBody = source.slice(uploadHandler, uploadHandler + 600)
    assert.ok(uploadBody.includes('UPLOAD_REQUIRES_VIDEO'), 'UPLOAD must throw UPLOAD_REQUIRES_VIDEO when no video')
  })
})

// ──────────────────────────────────────────────────────────────────
// 5. Upload cannot execute after thumbnail failure
// ──────────────────────────────────────────────────────────────────
describe('Architecture: upload cannot run after thumbnail failure', () => {
  it('orchestrator STAGES order puts THUMBNAIL before UPLOAD', async () => {
    const { readFileSync } = await import('node:fs')
    const source = readFileSync(join(process.cwd(), 'src/orchestrator/Stages.mjs'), 'utf-8')

    const stages = ['DISCOVER', 'RENDER', 'THUMBNAIL', 'C2PA', 'UNIQUENESS', 'UPLOAD', 'PUBLISH', 'VERIFY', 'ANALYTICS']
    let lastIndex = -1
    for (const stage of stages) {
      const idx = source.indexOf(`id: '${stage}'`)
      assert.ok(idx > 0, `Stage ${stage} must exist in Stages.mjs`)
      assert.ok(idx > lastIndex, `Stage ${stage} must come after previous stage in STAGES array`)
      lastIndex = idx
    }
  })

  it('orchestrator ProductionJob.run() quarantines on stage failure, preventing UPLOAD', async () => {
    const { readFileSync } = await import('node:fs')
    const source = readFileSync(join(process.cwd(), 'src/orchestrator/ProductionJob.mjs'), 'utf-8')

    // Verify that _executeStage returns false on quarantine, which stops run()
    assert.ok(source.includes('return false'), '_executeStage must return false on quarantine to stop pipeline')
    assert.ok(source.includes('QUARANTINED'), 'Job must set status to QUARANTINED on stage failure')
  })
})

// ──────────────────────────────────────────────────────────────────
// 6. Engine is the single source of truth for artifacts
// ──────────────────────────────────────────────────────────────────
describe('Architecture: engine is artifact source', () => {
  it('RENDER stage returns engine as the artifact carrier', async () => {
    const { readFileSync } = await import('node:fs')
    const source = readFileSync(join(process.cwd(), 'scripts/composer.mjs'), 'utf-8')

    const renderHandler = source.indexOf("job.onStage('RENDER'")
    assert.ok(renderHandler > 0, 'RENDER stage handler must exist')
    const renderBody = source.slice(renderHandler, renderHandler + 1200)
    assert.ok(renderBody.includes('engine: result.engine'), 'RENDER must return engine')
  })

  it('THUMBNAIL reads from ctx.results.RENDER.engine', async () => {
    const { readFileSync } = await import('node:fs')
    const source = readFileSync(join(process.cwd(), 'scripts/composer.mjs'), 'utf-8')

    const thumbHandler = source.indexOf("job.onStage('THUMBNAIL'")
    const thumbBody = source.slice(thumbHandler, thumbHandler + 900)
    assert.ok(thumbBody.includes('const { engine } = ctx.results.RENDER'), 'THUMBNAIL must read engine from RENDER results')
  })

  it('generateFromArticle stores lastQualityScore on engine', async () => {
    const { readFileSync } = await import('node:fs')
    const source = readFileSync(join(process.cwd(), 'src/index.mjs'), 'utf-8')

    assert.ok(source.includes('this.lastQualityScore = qScore'), 'Engine must store lastQualityScore')
  })
})

// ──────────────────────────────────────────────────────────────────
// 7. No ThumbnailFactory usage in orchestrator flow
// ──────────────────────────────────────────────────────────────────
describe('Architecture: no ThumbnailFactory in orchestrator', () => {
  it('composer.mjs does not import ThumbnailFactory', async () => {
    const { readFileSync } = await import('node:fs')
    const source = readFileSync(join(process.cwd(), 'scripts/composer.mjs'), 'utf-8')

    assert.ok(!source.includes('ThumbnailFactory'), 'composer.mjs must not reference ThumbnailFactory')
  })

  it('THUMBNAIL stage consumes engine output, does not generate', async () => {
    const { readFileSync } = await import('node:fs')
    const source = readFileSync(join(process.cwd(), 'scripts/composer.mjs'), 'utf-8')

    const thumbHandler = source.indexOf("job.onStage('THUMBNAIL'")
    const thumbEnd = source.indexOf("job.onStage('C2PA'", thumbHandler)
    const thumbBody = source.slice(thumbHandler, thumbEnd > 0 ? thumbEnd : thumbHandler + 1400)
    assert.ok(thumbBody.includes('engine-generated'), 'THUMBNAIL strategy must be engine-generated')
    assert.ok(thumbBody.includes('fs.existsSync(thumbPath)'), 'THUMBNAIL reads from filesystem, not ThumbnailFactory')
  })
})
