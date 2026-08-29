// Production niche automation — unit tests for nicheResolver, nicheProfiles,
// thumbnailValidator, and the production context pipeline.
import test from 'node:test'
import assert from 'node:assert/strict'
import { detectNiche, normalize, applyConfidencePolicy, buildProductionContext, NICHES } from '../src/youtube/nicheResolver.mjs'
import { getProfile, getAccentColor, listNiches, CategoryProductionProfiles } from '../src/youtube/nicheProfiles.mjs'
import { validateThumbnail, assertValidThumbnail } from '../src/youtube/thumbnailValidator.mjs'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { createCanvas } from '@napi-rs/canvas'

// ─── nicheResolver ──────────────────────────────────────────────────────────

test('normalize — maps canonical niches', () => {
  assert.equal(normalize('TESLA'), 'TESLA')
  assert.equal(normalize('tesla'), 'TESLA')
  assert.equal(normalize('Ai'), 'AI')
  assert.equal(normalize('space'), 'SPACE')
  assert.equal(normalize('CRYPTO'), 'CRYPTO')
})

test('normalize — maps legacy niches to GENERAL', () => {
  assert.equal(normalize('STOCKS'), 'GENERAL')
  assert.equal(normalize('POLITICS'), 'GENERAL')
  assert.equal(normalize('SPORTS'), 'GENERAL')
  assert.equal(normalize('TECH'), 'GENERAL')
})

test('normalize — returns null for unknown', () => {
  assert.equal(normalize('not-a-niche'), null)
  assert.equal(normalize(''), null)
  assert.equal(normalize(null), null)
})

test('detectNiche — explicit category returns high confidence', async () => {
  const result = await detectNiche({ category: 'TESLA' })
  assert.equal(result.niche, 'TESLA')
  assert.equal(result.source, 'explicit')
  assert.equal(result.tier, 'high')
  assert.ok(result.confidence >= 0.90)
})

test('detectNiche — heuristic detects TESLA from text', async () => {
  const result = await detectNiche({ text: 'Tesla stock surges after record earnings call' })
  assert.equal(result.niche, 'TESLA')
  assert.ok(result.confidence >= 0.80)
  assert.equal(result.source, 'heuristic')
})

test('detectNiche — heuristic detects AI from text', async () => {
  const result = await detectNiche({ text: 'OpenAI launches a new GPT model for agents' })
  assert.equal(result.niche, 'AI')
})

test('detectNiche — heuristic detects SPACE', async () => {
  const result = await detectNiche({ text: 'SpaceX starship reaches orbit on test flight' })
  assert.equal(result.niche, 'SPACE')
})

test('detectNiche — GENERAL fallback for unmatched text', async () => {
  const result = await detectNiche({ text: 'a quiet evening walk in the park' })
  assert.equal(result.niche, 'GENERAL')
  assert.equal(result.tier, 'fallback')
})

test('detectNiche — LLM override wins', async () => {
  const llm = async () => 'crypto'
  const result = await detectNiche({ text: 'random words', llm })
  assert.equal(result.niche, 'CRYPTO')
  assert.equal(result.source, 'ai')
})

test('detectNiche — LLM garbage falls to heuristic', async () => {
  const badLlm = async () => 'not-a-real-niche'
  const result = await detectNiche({ text: 'Tesla announces new battery', llm: badLlm })
  assert.equal(result.niche, 'TESLA')
})

test('detectNiche — normalizes category through resolver', async () => {
  const result = await detectNiche({ category: 'stocks' })
  assert.equal(result.niche, 'GENERAL')
  assert.equal(result.source, 'explicit')
})

test('applyConfidencePolicy — high tier for >= 0.80', () => {
  const r = applyConfidencePolicy({ niche: 'AI', confidence: 0.85, source: 'heuristic', reason: 'test' })
  assert.equal(r.tier, 'high')
  assert.equal(r.niche, 'AI')
})

test('applyConfidencePolicy — low tier for 0.60-0.79', () => {
  const r = applyConfidencePolicy({ niche: 'AI', confidence: 0.70, source: 'heuristic', reason: 'test' })
  assert.equal(r.tier, 'low')
  assert.equal(r.niche, 'AI')
})

test('applyConfidencePolicy — fallback to GENERAL for < 0.60', () => {
  const r = applyConfidencePolicy({ niche: 'AI', confidence: 0.40, source: 'heuristic', reason: 'test' })
  assert.equal(r.tier, 'fallback')
  assert.equal(r.niche, 'GENERAL')
})

test('buildProductionContext — returns the full context object', () => {
  const article = { headline: 'Tesla stock surges', id: 'art-1' }
  const nicheResult = { niche: 'TESLA', confidence: 0.95, source: 'heuristic', tier: 'high', reason: 'tesla' }
  const ctx = buildProductionContext({ article, nicheResult })
  assert.equal(ctx.articleId, 'art-1')
  assert.equal(ctx.niche.key, 'TESLA')
  assert.equal(ctx.niche.confidence, 0.95)
  assert.equal(ctx.publishing.youtube.uploaded, false)
})

test('NICHES — canonical set is closed (10 niches)', () => {
  assert.equal(NICHES.length, 10)
  assert.ok(NICHES.includes('TESLA'))
  assert.ok(NICHES.includes('GENERAL'))
})

// ─── nicheProfiles ──────────────────────────────────────────────────────────

test('getProfile — TESLA accent is automotive red', () => {
  const p = getProfile('TESLA')
  assert.equal(p.accent, '#E82127')
  assert.equal(p.label, 'TESLA')
  assert.equal(p.style, 'automotive-tech')
})

test('getProfile — AI accent is futuristic purple', () => {
  const p = getProfile('AI')
  assert.equal(p.accent, '#7C3AED')
  assert.equal(p.label, 'AI')
})

test('getProfile — returns GENERAL for unknown niche', () => {
  const p = getProfile('UNKNOWN')
  assert.equal(p.accent, '#E10600')
  assert.equal(p.label, 'NEWS')
})

test('getAccentColor — quick accessor works', () => {
  assert.equal(getAccentColor('TESLA'), '#E82127')
  assert.equal(getAccentColor('AI'), '#7C3AED')
  assert.equal(getAccentColor('GAMING'), '#FF6B35')
})

test('listNiches — returns all 10 niches with profiles', () => {
  const all = listNiches()
  assert.equal(all.length, 10)
  assert.ok(all.every(n => n.accent && n.label && n.hookStyle))
})

test('CategoryProductionProfiles — all niches have required fields', () => {
  for (const [niche, profile] of Object.entries(CategoryProductionProfiles)) {
    assert.ok(profile.accent, `${niche} missing accent`)
    assert.ok(profile.label, `${niche} missing label`)
    assert.ok(profile.hookStyle, `${niche} missing hookStyle`)
    assert.ok(Array.isArray(profile.preferredVisuals), `${niche} missing preferredVisuals`)
  }
})

// ─── thumbnailValidator ─────────────────────────────────────────────────────

function makeValidPng(width = 1280, height = 720) {
  const canvas = createCanvas(width, height)
  const ctx = canvas.getContext('2d')
  ctx.fillStyle = '#E10600'
  ctx.fillRect(0, 0, width, height)
  return canvas.toBuffer('image/png')
}

test('validateThumbnail — rejects non-existent file', () => {
  const r = validateThumbnail('/tmp/does-not-exist-12345.png')
  assert.equal(r.ok, false)
  assert.ok(r.errors[0].includes('not found'))
})

test('validateThumbnail — accepts a valid canonical 2160x3840 (9:16 short) PNG', () => {
  const tmpFile = path.join(os.tmpdir(), `nm-test-${Date.now()}.png`)
  fs.writeFileSync(tmpFile, makeValidPng(2160, 3840))
  try {
    const r = validateThumbnail(tmpFile)
    assert.equal(r.ok, true, `errors: ${r.errors.join('; ')}`)
    assert.equal(r.width, 2160)
    assert.equal(r.height, 3840)
    assert.equal(r.isPng, true)
  } finally { fs.unlinkSync(tmpFile) }
})

test('validateThumbnail — rejects wrong (non-canonical) geometry', () => {
  const tmpFile = path.join(os.tmpdir(), `nm-test-${Date.now()}.png`)
  fs.writeFileSync(tmpFile, makeValidPng(1024, 1024))
  try {
    const r = validateThumbnail(tmpFile)
    assert.equal(r.ok, false)
    assert.ok(r.errors.some(e => e.includes('do not match canonical')))
  } finally { fs.unlinkSync(tmpFile) }
})

test('validateThumbnail — rejects too-small resolution', () => {
  const tmpFile = path.join(os.tmpdir(), `nm-test-${Date.now()}.png`)
  fs.writeFileSync(tmpFile, makeValidPng(320, 180))
  try {
    const r = validateThumbnail(tmpFile)
    assert.equal(r.ok, false)
    assert.ok(r.errors.some(e => e.includes('do not match canonical')) || r.errors.some(e => e.includes('too small')))
  } finally { fs.unlinkSync(tmpFile) }
})

test('assertValidThumbnail — throws on invalid file', () => {
  assert.throws(() => assertValidThumbnail('/tmp/nope.png'), /not found/)
})

test('assertValidThumbnail — returns result on valid canonical file', () => {
  const tmpFile = path.join(os.tmpdir(), `nm-test-${Date.now()}.png`)
  fs.writeFileSync(tmpFile, makeValidPng(2160, 3840))
  try {
    const r = assertValidThumbnail(tmpFile)
    assert.equal(r.ok, true)
    assert.equal(r.width, 2160)
  } finally { fs.unlinkSync(tmpFile) }
})
