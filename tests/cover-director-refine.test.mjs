import { test } from 'node:test'
import assert from 'node:assert/strict'
import { CoverDirector, refineHighCtrPrompt, extractNames, stripMjFlags } from '../src/video-studio/CoverDirector.mjs'

// High-CTR thumbnail prompt refiner — the hero_prompt that reaches the image
// generator must be a refined, story-hook-tailored, Midjourney-style prompt
// (named subjects + composition + environment + aura + quality flags), and the
// whole pipeline must stay deterministic (same input → byte-identical prompt).

test('extractNames — keeps multi-word proper nouns together', () => {
  assert.deepEqual(extractNames('Terry Bogard and Rock Howard collide at Evo 2026'), ['Terry Bogard', 'Rock Howard', 'Evo'])
  assert.deepEqual(extractNames('Tesla unveils robotaxi'), ['Tesla'])
})

test('refineHighCtrPrompt — names the actual story subjects', () => {
  const p = refineHighCtrPrompt('base', {
    title: 'Terry Bogard and Rock Howard collide at Evo 2026',
    category: 'gaming',
    hook: 'NOBODY_EXPECTED',
  }, { subject: 'Terry Bogard', aspect: '9:16' })
  assert.ok(p.includes('Terry Bogard and Rock Howard'), 'subject names present')
  assert.ok(p.includes('rainy neon alley'), 'hook environment present')
  assert.ok(p.includes('--ar 9:16 --stylize 250'), 'aspect + stylize flags')
})

test('refineHighCtrPrompt — deterministic for identical input', () => {
  const a = { title: 'Bitcoin crashes through 40k after ETF rejection', category: 'finance', hook: 'SHOCKING_NUMBER' }
  const p1 = refineHighCtrPrompt('base', a, { aspect: '9:16' })
  const p2 = refineHighCtrPrompt('base', a, { aspect: '9:16' })
  assert.equal(p1, p2)
})

test('refineHighCtrPrompt — 16:9 flag for YouTube thumbnails', () => {
  const p = refineHighCtrPrompt('base', { title: 'NASA finds water on Mars moon', category: 'space', hook: 'LOST_IN_RAIN' }, { aspect: '16:9' })
  assert.ok(p.includes('--ar 16:9'))
})

test('stripMjFlags — removes MJ-only flags before SD/FAL generation', () => {
  const p = refineHighCtrPrompt('base', { title: 'Terry Bogard vs Rock Howard', category: 'gaming', hook: 'NOBODY_EXPECTED' }, { aspect: '9:16' })
  const clean = stripMjFlags(p)
  assert.ok(!clean.includes('--ar'), 'no --ar flag')
  assert.ok(!clean.includes('--stylize'), 'no --stylize flag')
  assert.ok(clean.includes('Terry Bogard and Rock Howard'), 'prompt body preserved')
})

test('CoverDirector.analyzeStory — AI-authored hero_prompt passes through unmodified', async () => {
  const aiPrompt = 'Terry Bogard and Rock Howard clashing fists mid-air, rainy neon Southtown alley, volumetric rim light, sparks and motion blur, photorealistic 8k, cinematic poster'
  const fakeAi = { generate: async () => ({ subject: 'Terry Bogard', hero_prompt: aiPrompt, text_overlay: { top: 'FIGHT', bottom: 'LEGACY' }, keywords: ['fight'] }) }
  const dir = new CoverDirector(fakeAi)
  const brief = await dir.analyzeStory({ title: 'Terry Bogard and Rock Howard collide', category: 'gaming' }, { aspect: '9:16' })
  assert.equal(brief.hero_prompt, aiPrompt, 'AI refined prompt kept verbatim')
  assert.equal(brief.source, 'ai')
})

test('CoverDirector.analyzeStory — hero_prompt is refined (deterministic path, no AI)', async () => {
  const dir = new CoverDirector(null)
  const brief = await dir.analyzeStory({
    title: 'Rock Howard challenges Terry Bogard to a title match',
    category: 'gaming',
  }, { aspect: '16:9' })
  assert.ok(brief.hero_prompt && brief.hero_prompt.length > 40, 'hero_prompt populated')
  assert.ok(brief.hero_prompt.includes('--ar 16:9'), '16:9 flag threaded')
  assert.ok(brief.hero_prompt.includes('Rock Howard'), 'named subject in prompt')
})