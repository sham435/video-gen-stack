// tests/creative-director.test.mjs
//
// Tests for Creative Director content layer:
// 1. CreativeDirectorAgent mood → BGM family mapping
// 2. CreativeDirectorAgent mood → emotion mapping
// 3. Brief generation + validation (mock provider)
// 4. Fallback on provider failure
// 5. ImageRanker direction weight scoring
// 6. InformationLayer emphasisWords from brief
// 7. Retry backoff honors Retry-After header
// 8. AudioMixer family override via creative brief

import { test } from 'node:test'
import assert from 'node:assert/strict'

// ─── 1. Mood → BGM family mapping ─────────────────────────────────────────

test('creative-director: mood-to-BGM family mapping covers all moods', async () => {
  const { MOOD_TO_FAMILY } = await import('../src/ai/CreativeDirectorAgent.mjs')
  assert.equal(MOOD_TO_FAMILY.urgent, 'action-energy')
  assert.equal(MOOD_TO_FAMILY.triumphant, 'luxury-future')
  assert.equal(MOOD_TO_FAMILY.ominous, 'action-energy')
  assert.equal(MOOD_TO_FAMILY.playful, 'cinematic-tech-reveal')
  assert.equal(MOOD_TO_FAMILY.reflective, 'emotional-story')
  assert.equal(MOOD_TO_FAMILY.curious, 'cinematic-tech-reveal')
  assert.equal(MOOD_TO_FAMILY.neutral, null, 'neutral defers to article-based resolution')
})

// ─── 2. Mood → emotion mapping ─────────────────────────────────────────────

test('creative-director: mood-to-emotion mapping canonicalizes agent moods', async () => {
  const { MOOD_TO_EMOTION } = await import('../src/ai/CreativeDirectorAgent.mjs')
  assert.equal(MOOD_TO_EMOTION.urgent, 'shock')
  assert.equal(MOOD_TO_EMOTION.triumphant, 'excitement')
  assert.equal(MOOD_TO_EMOTION.ominous, 'tension')
  assert.equal(MOOD_TO_EMOTION.curious, 'curiosity')
  assert.equal(MOOD_TO_EMOTION.neutral, 'neutral')
  assert.equal(Object.keys(MOOD_TO_EMOTION).length, 7, 'all 7 agent moods mapped')
})

// ─── 3. Brief generation + validation (mock provider) ──────────────────────

test('creative-director: generates valid brief from mock provider response', async () => {
  const { CreativeDirectorAgent } = await import('../src/ai/CreativeDirectorAgent.mjs')

  const mockBrief = {
    overallMood: 'curious',
    scenes: [
      { sceneId: 1, mood: 'curious', imageDirection: 'wide establishing cityscape', bgmCue: { family: 'cinematic-tech-reveal', energy: 0.6, genre: 'ambient curiosity' }, textHook: { style: 'rhetorical-question', emphasisWords: ['SECRETLY'] } },
      { sceneId: 2, mood: 'tension', imageDirection: 'close-up product shot', bgmCue: { family: 'action-energy', energy: 0.8, genre: 'dark tension' }, textHook: { style: 'highlight-keyword', emphasisWords: ['DROPPED', 'SHOCK'] } },
    ],
  }

  const mockProvider = {
    generate: async () => JSON.stringify(mockBrief),
  }

  const agent = new CreativeDirectorAgent(mockProvider)
  const article = { title: 'Test Article', category: 'technology', description: 'A test', source: 'Test' }
  const story = { headline: 'Test', emotionalArc: ['curiosity'], scenePlan: [{ type: 'hook', narration: 'SECRETLY DROPPED a SHOCK', duration: 3 }, { type: 'fact', narration: 'The reveal', duration: 3 }] }

  const brief = await agent.plan(article, story)
  assert.ok(brief, 'brief generated')
  assert.equal(brief.scenes.length, 2, 'one brief per scene')
  assert.equal(brief.scenes[0].mood, 'curious')
  assert.deepEqual(brief.scenes[1].textHook.emphasisWords, ['DROPPED', 'SHOCK'])
  assert.equal(brief.scenes[0].bgmCue.family, 'cinematic-tech-reveal')
  assert.equal(brief.overallMood, 'curious')
})

test('creative-director: validation clamps invalid mood to neutral', async () => {
  const { CreativeDirectorAgent } = await import('../src/ai/CreativeDirectorAgent.mjs')

  const mockProvider = {
    generate: async () => JSON.stringify({
      overallMood: 'invalid-mood',
      scenes: [{ sceneId: 1, mood: 'not-a-mood', imageDirection: 123, bgmCue: { family: 'fake-family', energy: 5.0, genre: 42 }, textHook: { emphasisWords: ['ok', 123, 'valid'] } }],
    }),
  }

  const agent = new CreativeDirectorAgent(mockProvider)
  const brief = await agent.plan({ title: 'X', category: 'tech' }, { headline: 'X', emotionalArc: [], scenePlan: [{ type: 'hook', narration: 'test', duration: 3 }] })

  assert.equal(brief.scenes[0].mood, 'neutral', 'invalid mood → neutral')
  assert.equal(brief.scenes[0].imageDirection, '', 'non-string imageDirection → empty')
  assert.equal(brief.scenes[0].bgmCue.family, null, 'invalid family → null')
  assert.ok(brief.scenes[0].bgmCue.energy <= 1, 'energy clamped to ≤1')
  assert.deepEqual(brief.scenes[0].textHook.emphasisWords, ['ok', 'valid'], 'non-string words filtered')
})

// ─── 4. Fallback on provider failure ───────────────────────────────────────

test('creative-director: returns neutral fallback on provider failure', async () => {
  const { CreativeDirectorAgent } = await import('../src/ai/CreativeDirectorAgent.mjs')

  const failProvider = {
    generate: async () => { throw new Error('429 rate limit') },
  }

  const agent = new CreativeDirectorAgent(failProvider)
  const story = { headline: 'X', scenePlan: [{ type: 'hook', narration: 'a', duration: 2 }, { type: 'fact', narration: 'b', duration: 3 }, { type: 'close', narration: 'c', duration: 2 }] }
  const brief = await agent.plan({ title: 'X', category: 'tech' }, story)

  assert.ok(brief, 'brief returned (fallback)')
  assert.equal(brief.scenes.length, 3, 'one per scenePlan')
  assert.equal(brief.overallMood, 'neutral')
  assert.ok(brief.scenes.every(s => s.mood === 'neutral'), 'all scenes neutral')
})

test('creative-director: returns neutral fallback when provider is null', async () => {
  const { CreativeDirectorAgent } = await import('../src/ai/CreativeDirectorAgent.mjs')
  const agent = new CreativeDirectorAgent(null)
  const brief = await agent.plan({ title: 'X', category: 'tech' }, { headline: 'X', scenePlan: [{ type: 'hook', narration: 'a', duration: 2 }] })
  assert.equal(brief.scenes.length, 1)
  assert.equal(brief.overallMood, 'neutral')
})

// ─── 5. ImageRanker direction weight scoring ───────────────────────────────

test('creative-director: ImageRanker direction weight is 0.08', async () => {
  const { RANK_WEIGHTS } = await import('../src/assets/ImageRanker.mjs')
  assert.equal(RANK_WEIGHTS.direction, 0.08)
  // Weights don't sum to 1.0 because freshness/reuse are subtracted (penalties)
  // and learned is added (bonus). Direction is additive with relevance/quality.
  const positive = RANK_WEIGHTS.relevance + RANK_WEIGHTS.quality + RANK_WEIGHTS.entity + RANK_WEIGHTS.direction
  assert.ok(positive > 0.8 && positive < 1.0, `positive weights sum in (0.8, 1.0) range (got ${positive.toFixed(3)})`)
})

test('creative-director: ImageRanker direction scoring boosts matching candidates', async () => {
  const { ImageRanker } = await import('../src/assets/ImageRanker.mjs')
  const ranker = new ImageRanker()

  const candidates = [
    { url: 'close-up-product.jpg', tags: ['close-up', 'product', 'shot'], title: 'Samsung Galaxy Closeup', width: 1920, height: 1080 },
    { url: 'wide-aerial.jpg', tags: ['aerial', 'wide', 'city'], title: 'Aerial City View', width: 1920, height: 1080 },
    { url: 'reaction-face.jpg', tags: ['reaction', 'face', 'emotion'], title: 'Reaction Shot', width: 1920, height: 1080 },
  ]

  const intent = { subject: 'Samsung', entities: ['Samsung'], keywords: ['galaxy'] }
  const ranked = ranker.rank(candidates, intent, { brief: { imageDirection: 'close-up product shot' } })

  // The close-up product shot should score highest due to direction match
  assert.equal(ranked[0].url, 'close-up-product.jpg', 'direction-matched candidate ranks first')
  assert.ok(ranked[0]._direction > 0, `direction score > 0 (got ${ranked[0]._direction})`)
  assert.equal(ranked[2]._direction, 0, 'non-matching candidate has direction=0')
})

test('creative-director: ImageRanker direction=0 when no brief provided', async () => {
  const { ImageRanker } = await import('../src/assets/ImageRanker.mjs')
  const ranker = new ImageRanker()
  const candidates = [{ url: 'test.jpg', tags: ['close-up'], title: 'test', width: 1920, height: 1080 }]
  const ranked = ranker.rank(candidates, { subject: 'test' }, {})
  assert.equal(ranked[0]._direction, 0, 'no brief → direction=0 (neutral)')
})

// ─── 6. InformationLayer emphasisWords from brief ──────────────────────────

test('creative-director: InformationLayer processes brief emphasisWords', async () => {
  const { readFileSync } = await import('node:fs')
  const code = readFileSync(new URL('../src/video/layers/InformationLayer.mjs', import.meta.url), 'utf8')
  // Verify the briefEmphasis computation is in the source
  assert.ok(code.includes('briefEmphasis'), 'briefEmphasis variable present')
  assert.ok(code.includes("scene.creativeBrief?.textHook?.emphasisWords"), 'reads from creativeBrief.textHook.emphasisWords')
  // Verify isKeyword uses briefEmphasis
  assert.ok(code.includes('briefEmphasis.some(ew => w.includes(ew))'), 'isKeyword checks briefEmphasis')
})

test('creative-director: brief emphasisWords merged with caption_focus', async () => {
  // Verify the merged logic: isKeyword fires if EITHER caption_focus OR
  // any briefEmphasis word matches. The exact check is:
  //   (keyword && w.includes(keyword)) || (briefEmphasis.length > 0 && briefEmphasis.some(ew => w.includes(ew)))
  const { readFileSync } = await import('node:fs')
  const code = readFileSync(new URL('../src/video/layers/InformationLayer.mjs', import.meta.url), 'utf8')
  assert.ok(code.includes('(keyword && w.includes(keyword)) || (briefEmphasis.length > 0 && briefEmphasis.some'), 'merged keyword check present')
})

// ─── 7. Retry backoff honors Retry-After header ────────────────────────────

test('creative-director: backoffDelay uses retryAfterMs when available', async () => {
  const { backoffDelay } = await import('../src/ai/providers/retry.mjs')
  const error = { retryAfterMs: 5000 }
  const delay = backoffDelay(0, error)
  assert.equal(delay, 5000, 'uses retryAfterMs')
})

test('creative-director: backoffDelay caps retryAfterMs at 10s', async () => {
  const { backoffDelay } = await import('../src/ai/providers/retry.mjs')
  const delay = backoffDelay(0, { retryAfterMs: 30000 })
  assert.equal(delay, 10000, 'capped at 10s')
})

test('creative-director: backoffDelay falls back to fixed schedule without retryAfterMs', async () => {
  const { backoffDelay, RETRY_BACKOFF } = await import('../src/ai/providers/retry.mjs')
  assert.equal(backoffDelay(0, null), RETRY_BACKOFF[0])
  assert.equal(backoffDelay(1, null), RETRY_BACKOFF[1])
  assert.equal(backoffDelay(2, null), RETRY_BACKOFF[2])
  assert.equal(backoffDelay(3, null), RETRY_BACKOFF[2], 'capped at last entry')
})

// ─── 8. ScenePlanner preserves creativeBrief ───────────────────────────────

test('creative-director: ScenePlanner.buildScene preserves creativeBrief', async () => {
  const { ScenePlanner } = await import('../src/ai/ScenePlanner.mjs')
  const planner = new ScenePlanner()
  const brief = { sceneId: 1, mood: 'curious', imageDirection: 'close-up', bgmCue: { family: 'cinematic-tech-reveal', energy: 0.6, genre: 'ambient' }, textHook: { emphasisWords: ['SECRETLY'] } }
  const sceneDef = { id: 1, type: 'hook', narration: 'test narration', duration: 3, creativeBrief: brief }
  const scene = planner.buildScene(sceneDef, 0, { title: 'Test', category: 'tech' })
  assert.deepEqual(scene.creativeBrief, brief, 'creativeBrief preserved through buildScene')
})

// ─── 9. AudioMixer family override ─────────────────────────────────────────

test('creative-director: audioMixer.musicFamily can be overridden after setMusicContext', async () => {
  const { AudioMixer } = await import('../src/audio/AudioMixer.mjs')
  const mixer = new AudioMixer()
  mixer.setMusicContext({ title: 'Technology breakthrough', category: 'technology' })
  const originalFamily = mixer.musicFamily
  assert.equal(originalFamily, 'cinematic-tech-reveal', 'tech article → tech-reveal')

  // Override as the Creative Director would
  mixer.musicFamily = 'action-energy'
  assert.equal(mixer.musicFamily, 'action-energy', 'family overridden by creative brief')
})

// ─── 10. Gemini model updated ──────────────────────────────────────────────

test('creative-director: gemini model string updated to 2.5-flash', async () => {
  const { readFileSync } = await import('node:fs')
  const src = readFileSync(new URL('../src/ai/providers/GeminiProvider.mjs', import.meta.url), 'utf8')
  assert.ok(src.includes('gemini-2.5-flash'), 'GeminiProvider uses 2.5-flash')
  assert.ok(!src.includes('gemini-2.0-flash'), 'no deprecated 2.0-flash')
})
