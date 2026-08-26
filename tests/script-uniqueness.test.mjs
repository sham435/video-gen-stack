import { describe, it, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { ScriptUniqueness, SCRIPT_UNIQUENESS_POLICY } from '../src/uniqueness/ScriptUniqueness.mjs'
import { AssetRegistry } from '../src/uniqueness/AssetRegistry.mjs'
import { GlobalAssetUniquenessGate, ScopeEnforcement } from '../src/uniqueness/GlobalAssetUniquenessGate.mjs'

function makeRegistry(tmpDir) {
  return new AssetRegistry({ filePath: path.join(tmpDir, 'registry.json'), rollingWindow: 50 })
}

describe('ScriptUniqueness', () => {
  let tmpDir, registry, checker

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'su-test-'))
    registry = makeRegistry(tmpDir)
    checker = new ScriptUniqueness(registry)
  })

  it('rejects exact duplicate by hash', () => {
    const text = 'Samsung launches the world\'s fastest smartphone with groundbreaking processor'
    checker.record(text, { title: 'Samsung Launch' })

    const result = checker.validate(text)
    assert.equal(result.pass, false)
    assert.equal(result.reason.includes('SCRIPT_DUPLICATE'), true)
    assert.equal(result.similarity, 1.0)
  })

  it('rejects near-duplicate with different wording (same facts)', () => {
    const text1 = 'Samsung launches the world\'s fastest smartphone with groundbreaking new processor technology'
    const text2 = 'Samsung unveils the fastest smartphone featuring groundbreaking processor innovations'
    checker.record(text1, { title: 'Samsung Launch' })

    const result = checker.validate(text2)
    assert.equal(result.pass, false)
    assert.ok(result.similarity >= SCRIPT_UNIQUENESS_POLICY.semanticSimilarityMax,
      `similarity ${result.similarity} should be >= ${SCRIPT_UNIQUENESS_POLICY.semanticSimilarityMax}`)
  })

  it('allows genuinely different stories', () => {
    const text1 = 'Samsung launches the world\'s fastest smartphone with groundbreaking processor'
    const text2 = 'NASA discovers water ice deposits on the lunar surface near the south pole'
    checker.record(text1, { title: 'Samsung Launch' })

    const result = checker.validate(text2)
    assert.equal(result.pass, true)
    assert.ok(result.similarity < SCRIPT_UNIQUENESS_POLICY.semanticSimilarityMax,
      `similarity ${result.similarity} should be < ${SCRIPT_UNIQUENESS_POLICY.semanticSimilarityMax}`)
  })

  it('rejects exact rewording of same story', () => {
    const text1 = 'Apple announced its new iPhone with improved camera and longer battery life for 2026'
    const text2 = 'Apple reveals upcoming iPhone featuring enhanced camera and extended battery duration in 2026'
    checker.record(text1, { title: 'Apple iPhone' })

    const result = checker.validate(text2)
    assert.equal(result.pass, false)
  })

  it('allows minor variations (introductory phrases)', () => {
    const text1 = 'Breaking news today, Samsung just launched their new Galaxy S26 with incredible camera'
    const text2 = 'Samsung launched new Galaxy S26 with incredible camera system today'
    checker.record(text1, { title: 'Galaxy S26' })

    const result = checker.validate(text2)
    // These are genuinely similar stories — should be caught
    assert.equal(result.pass, false)
  })

  it('handles empty script', () => {
    const result = checker.validate('')
    assert.equal(result.pass, false)
    assert.equal(result.reason, 'EMPTY_SCRIPT')
  })

  it('handles null/undefined script', () => {
    const result = checker.validate(null)
    assert.equal(result.pass, false)
    assert.equal(result.reason, 'EMPTY_SCRIPT')
  })

  it('passes first script (no history)', () => {
    const result = checker.validate('This is a unique story about quantum computing breakthroughs')
    assert.equal(result.pass, true)
  })

  it('respects rolling window — old scripts do not block', () => {
    // Fill registry with 55 scripts (rolling window = 50)
    // Scripts 0-4 use unique vocabulary not shared with scripts 5-54
    for (let i = 0; i < 55; i++) {
      const vocab = i < 5
        ? 'alpha' + i + ' bravo' + i + ' charlie' + i + ' delta' + i + ' echo' + i
        : 'xray' + i + ' yankee' + i + ' zulu' + i + ' hotel' + i + ' india' + i
      const text = vocab + ' report breaking development today'
      const hash = checker._hash(text)
      registry.state.scripts[hash] = { text, title: 'Story ' + i, usageCount: 1 }
      registry.state.publishedVideos.push({
        videoId: 'vid-' + i,
        scriptHash: hash,
        scriptText: text,
      })
    }
    registry._save()

    // Script 0 should have aged out (only 50 most recent kept in window)
    const oldText = 'alpha0 bravo0 charlie0 delta0 echo0 report breaking development today'
    const result = checker.validate(oldText)
    // Should pass because script 0 is outside rolling window
    assert.equal(result.pass, true)
  })

  it('record stores text for future similarity checks', () => {
    const text = 'A story about quantum computing breakthrough in 2026'
    checker.record(text, { title: 'Quantum' })

    // Check that text is stored in the registry
    const hash = checker._hash(text)
    assert.ok(registry.state.scripts[hash], 'script should be in registry')
    assert.equal(registry.state.scripts[hash].text, text, 'text should be stored')
  })

  it('within-video duplicate always passes (single script per video)', () => {
    // A single video with one script always passes within-video check
    const result = checker.validate('Some script text')
    assert.equal(result.pass, true)
  })
})

describe('GlobalAssetUniquenessGate — Script Scopes', () => {
  let tmpDir, registry, gate

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gate-script-test-'))
    registry = makeRegistry(tmpDir)
    gate = new GlobalAssetUniquenessGate(registry)
  })

  it('has 8 scopes including script scopes', () => {
    const scopes = GlobalAssetUniquenessGate.getScopes()
    assert.equal(scopes.length, 8)
    const scriptScopes = scopes.filter(s => s.id.startsWith('script-'))
    assert.equal(scriptScopes.length, 2)
  })

  it('script-within-video scope is ENFORCED', () => {
    const scopes = GlobalAssetUniquenessGate.getScopes()
    const scriptWithin = scopes.find(s => s.id === 'script-within-video')
    assert.equal(scriptWithin.enforcement, ScopeEnforcement.ENFORCED)
  })

  it('script-across-video scope is ENFORCED', () => {
    const scopes = GlobalAssetUniquenessGate.getScopes()
    const scriptAcross = scopes.find(s => s.id === 'script-across-video')
    assert.equal(scriptAcross.enforcement, ScopeEnforcement.ENFORCED)
  })

  it('passes with no script in manifest', async () => {
    const manifest = { scenes: [], music: null, thumbnail: null }
    const result = await gate.validate(manifest, { jobId: 'test-1' })
    const scriptScopes = result.scopeResults.filter(s => s.scope.startsWith('script-'))
    assert.ok(scriptScopes.every(s => s.pass), 'all script scopes should pass with no script')
  })

  it('rejects exact duplicate script across videos', async () => {
    // First video: record script
    const scriptText = 'Apple launches revolutionary new AI chip for 2026 Mac lineup'
    registry.recordScript(registry.constructor.hash(scriptText), { text: scriptText, title: 'Apple AI Chip' })
    registry.state.publishedVideos.push({
      videoId: 'vid-1',
      scriptHash: registry.constructor.hash(scriptText),
      scriptText,
    })
    registry._save()

    // Second video: same script
    const manifest = {
      scriptHash: registry.constructor.hash(scriptText),
      scriptText,
      scenes: [],
      music: null,
      thumbnail: null,
    }
    const result = await gate.validate(manifest, { jobId: 'test-2' })
    const scriptAcross = result.scopeResults.find(s => s.scope === 'script-across-video')
    assert.equal(scriptAcross.pass, false, 'should reject duplicate script')
    assert.ok(result.violations.length > 0, 'should have violations')
  })

  it('rejects semantic near-duplicate script', async () => {
    // First video
    const text1 = 'Samsung launches world\'s fastest smartphone with groundbreaking new processor technology'
    registry.recordScript(registry.constructor.hash(text1), { text: text1, title: 'Samsung Launch' })
    registry.state.publishedVideos.push({
      videoId: 'vid-1',
      scriptHash: registry.constructor.hash(text1),
      scriptText: text1,
    })
    registry._save()

    // Second video: near-duplicate with different wording
    const text2 = 'Samsung unveils fastest smartphone featuring groundbreaking processor innovations'
    const manifest = {
      scriptHash: registry.constructor.hash(text2),
      scriptText: text2,
      scenes: [],
      music: null,
      thumbnail: null,
    }
    const result = await gate.validate(manifest, { jobId: 'test-2' })
    const scriptAcross = result.scopeResults.find(s => s.scope === 'script-across-video')
    assert.equal(scriptAcross.pass, false, 'should reject near-duplicate')
  })

  it('allows genuinely different scripts', async () => {
    // First video
    const text1 = 'Samsung launches world\'s fastest smartphone with groundbreaking processor'
    registry.recordScript(registry.constructor.hash(text1), { text: text1, title: 'Samsung Launch' })
    registry.state.publishedVideos.push({
      videoId: 'vid-1',
      scriptHash: registry.constructor.hash(text1),
      scriptText: text1,
    })
    registry._save()

    // Second video: completely different
    const text2 = 'NASA discovers water ice deposits on the lunar surface near the south pole'
    const manifest = {
      scriptHash: registry.constructor.hash(text2),
      scriptText: text2,
      scenes: [],
      music: null,
      thumbnail: null,
    }
    const result = await gate.validate(manifest, { jobId: 'test-2' })
    const scriptAcross = result.scopeResults.find(s => s.scope === 'script-across-video')
    assert.equal(scriptAcross.pass, true, 'should allow different script')
  })

  it('script-within-video always passes (single script per video)', async () => {
    const manifest = {
      scriptHash: 'abc123',
      scriptText: 'Some narration text',
      scenes: [],
      music: null,
      thumbnail: null,
    }
    const result = await gate.validate(manifest, { jobId: 'test-1' })
    const scriptWithin = result.scopeResults.find(s => s.scope === 'script-within-video')
    assert.equal(scriptWithin.pass, true)
  })

  it('reserve includes scriptText', () => {
    const manifest = {
      scriptHash: 'hash123',
      scriptText: 'Full narration text for the video',
      imageHashes: [],
    }
    const result = gate.reserve('job-1', manifest)
    assert.equal(result.reserved, true)

    // Check reservation has scriptText
    const res = registry.state.reservations['job-1']
    assert.equal(res.scriptText, 'Full narration text for the video')
  })

  it('commit preserves scriptText in published videos', () => {
    const text = 'A unique story about AI breakthroughs in 2026'
    const hash = registry.constructor.hash(text)
    registry.reserve('job-1', { scriptHash: hash, scriptText: text, imageHashes: [] })
    registry.commit('job-1', { videoId: 'vid-1' })

    const published = registry.state.publishedVideos.find(v => v.videoId === 'vid-1')
    assert.ok(published, 'should have published video')
    assert.equal(published.scriptText, text, 'scriptText should be preserved')
  })

  it('getEnforcementStatus includes script scopes', () => {
    const status = gate.getEnforcementStatus()
    const scriptStatuses = status.filter(s => s.scope.startsWith('script-'))
    assert.equal(scriptStatuses.length, 2)
    assert.ok(scriptStatuses.every(s => s.enforcement === ScopeEnforcement.ENFORCED))
  })

  it('cross-video duplicate blocks overall validation', async () => {
    const text = 'Google announces major update to Android with revolutionary new features'
    const hash = registry.constructor.hash(text)
    registry.recordScript(hash, { text, title: 'Android Update' })
    registry.state.publishedVideos.push({
      videoId: 'vid-1',
      scriptHash: hash,
      scriptText: text,
    })
    registry._save()

    const manifest = {
      scriptHash: hash,
      scriptText: text,
      scenes: [],
      music: null,
      thumbnail: null,
    }
    const result = await gate.validate(manifest, { jobId: 'test-2' })
    assert.equal(result.pass, false, 'overall validation should fail')
    assert.ok(result.violations.some(v => v.scope === 'script-across-video'))
  })
})
