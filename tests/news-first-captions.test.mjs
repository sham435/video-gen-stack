/**
 * NEWS-FIRST captions — the repeated-narrative / missing-important-news fix.
 *
 * Regression set for the two related production failures:
 *
 *   1. SAME NARRATIVE LINES were repeated as on-screen text:
 *      - StoryDirector.fallbackPlan() recycled the generic emotional template
 *        ("Nobody expected this move from X", "The world was against them",
 *        "Every small win counted", "Then it happened", "Never give up") for
 *        ANY article.
 *      - StoryDirector.validate() copied the VO sentence into caption.fullText
 *        when the LLM left the caption empty.
 *      - SceneTextManifest could fall back to scene.narration as the caption
 *        layer, and ScenePlanner rendered the FULL hook narration as the hero
 *        headline.
 *
 *   2. IMPORTANT / FRESH NEWS sentences were spoken but never captioned:
 *      - the LLM was prompted with a generic "Anchor hook: Nobody expected
 *        this move — {title}" and never told captions must be concise
 *        article-derived facts.
 *
 * The contract under test: narration = VOICE ONLY, caption.fullText = VISUAL
 * ONLY, and captions must come from the ARTICLE (entities/claims), never a
 * recycled story template.
 *
 * Run: node --test tests/news-first-captions.test.mjs
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { StoryDirector, isGenericStoryTemplate, GENERIC_STORY_TEMPLATES } from '../src/ai/StoryDirector.mjs'
import { ScenePlanner } from '../src/ai/ScenePlanner.mjs'
import { SceneTextManifest } from '../src/pipeline/SceneTextManifest.mjs'
import { TopicCtaBuilder } from '../src/publishing/TopicCtaBuilder.mjs'
import { ScriptUniqueness } from '../src/uniqueness/ScriptUniqueness.mjs'

// Normalize exactly like the director does (uppercase, punctuation-free).
const norm = (t) => String(t || '')
  .toUpperCase()
  .replace(/["'“”‘’`]/g, '')
  .replace(/[^A-Z0-9\s]/g, ' ')
  .replace(/\s+/g, ' ')
  .trim()

// ── Realistic fixtures derived from the two example articles ───────────────

const KOJIMA_ARTICLE = {
  title: "'Death Stranding' Creator Hideo Kojima's Upcoming 'Physint' Moves From PlayStation to Xbox",
  source: 'Variety',
  description: 'Xbox is expanding its partnership with video game industry legend Hideo Kojima. The new title Physint will be published by Xbox Game Studios. Kojima Productions confirmed the announcement at a Tokyo keynote.',
  category: 'gaming',
}

const IPAD_ARTICLE = {
  title: 'When did iPads get as expensive as MacBooks?',
  source: 'TechCrunch',
  description: 'Would you switch out your MacBook for an iPad with an M4 chip and OLED display? Apple seems to be arguing these are comparable but we are curious to see if consumers will make the change.',
  category: 'technology',
}

const ANTHROPIC_ARTICLE = {
  title: 'Two more AI researchers leave Anthropic over safety concerns',
  source: 'The Information',
  description: 'Two AI researchers are leaving Anthropic to speak out about safety concerns. The departures follow Jacob Coxon\u2019s viral exit from the company.',
  category: 'ai',
}

// ── 1. Generic hook templates do not repeatedly dominate captions ──────────

test('fallbackPlan fixture A (Kojima/Xbox) emits NO generic story-template narration or caption', () => {
  const director = new StoryDirector(null)
  const story = director.fallbackPlan(KOJIMA_ARTICLE)
  for (const scene of story.scenePlan) {
    const n = norm(scene.narration)
    const c = norm(scene.caption?.fullText || '')
    assert.equal(isGenericStoryTemplate(n), false, `narration is generic: "${scene.narration}"`)
    assert.equal(isGenericStoryTemplate(c), false, `caption is generic: "${scene.caption?.fullText}"`)
  }
})

test('fallbackPlan fixture A captions carry the article entities (Xbox/Kojima/Physint)', () => {
  const director = new StoryDirector(null)
  const story = director.fallbackPlan(KOJIMA_ARTICLE)
  const captions = story.scenePlan.map(s => s.caption?.fullText || '').join(' ')
  const narrations = story.scenePlan.map(s => s.narration || '').join(' ')
  assert.ok(/XBOX/.test(captions), `captions mention Xbox: ${captions}`)
  assert.ok(/KOJIMA|PHYSINT/.test(captions), `captions mention the people/product: ${captions}`)
  assert.ok(/Xbox|Kojima|Physint/i.test(narrations), `narrations are article-derived: ${narrations}`)
})

test('fallbackPlan fixture B (iPad/MacBook) captions carry the article entities', () => {
  const director = new StoryDirector(null)
  const story = director.fallbackPlan(IPAD_ARTICLE)
  const captions = story.scenePlan.map(s => s.caption?.fullText || '').join(' ')
  assert.ok(/IPAD|MACBOOK|M4|OLED|APPLE/.test(captions), `captions are article-derived: ${captions}`)
  for (const scene of story.scenePlan) {
    const n = norm(scene.narration)
    const c = norm(scene.caption?.fullText || '')
    assert.equal(isGenericStoryTemplate(n), false, `narration is generic: "${scene.narration}"`)
    assert.equal(isGenericStoryTemplate(c), false, `caption is generic: "${scene.caption?.fullText}"`)
  }
})

test('fallbackPlan keeps the article title as the headline (never "BRAND CHANGED EVERYTHING")', () => {
  const director = new StoryDirector(null)
  const story = director.fallbackPlan(KOJIMA_ARTICLE)
  assert.ok(/Kojima|Xbox|Physint|Death/i.test(story.headline), `headline is article-derived: ${story.headline}`)
  assert.ok(!/CHANGED EVERYTHING/i.test(story.headline))
})

// ── 2. Important article-derived facts can become caption.fullText ─────────

test('conciseNewsCaption turns the Kojima/Xbox fact into a visual caption with the entity', () => {
  const cap = StoryDirector.conciseNewsCaption('Xbox is expanding its partnership with video game industry legend Hideo Kojima.')
  assert.ok(/XBOX/.test(cap), `caption contains Xbox: ${cap}`)
  assert.ok(cap.split(' ').length <= 8, `caption is concise (${cap.split(' ').length} words): ${cap}`)
})

test('conciseNewsCaption turns the MacBook/iPad question into a visual caption', () => {
  const cap = StoryDirector.conciseNewsCaption('Would you switch out your MacBook for an iPad with an M4 chip and OLED display?')
  assert.ok(/MACBOOK|IPAD|M4|OLED/.test(cap), `caption has article terms: ${cap}`)
})

test('conciseNewsCaption turns the Apple comparison into a visual caption', () => {
  const capA = StoryDirector.conciseNewsCaption('Apple seems to be arguing these are comparable but we are curious to see if consumers will make the change')
  assert.ok(/APPLE/.test(capA), `caption has Apple: ${capA}`)
  const capB = StoryDirector.conciseNewsCaption('Two AI researchers are leaving Anthropic to speak out about safety concerns')
  assert.ok(/ANTHROPIC|AI/.test(capB), `caption has the entity: ${capB}`)
})

// ── 3. validate() fills empty captions from ARTICLE FACTS, never narration ─

test('validate() fills an empty caption with an article-derived fact (Xbox story never loses its news)', () => {
  const director = new StoryDirector(null)
  const plan = {
    headline: 'Kojima moves to Xbox',
    scenePlan: [
      { type: 'hook', duration: 2.5, narration: 'Kojima is leaving PlayStation behind for Xbox.', caption: { focus: 'KOJIMA', fullText: 'KOJIMA LEAVES PLAYSTATION' } },
      { type: 'fact', duration: 5.5, narration: 'Xbox is expanding its partnership with video game industry legend Hideo Kojima.', caption: { focus: 'XBOX', fullText: '' } },
      { type: 'reveal', duration: 4.5, narration: 'Physint will be published by Xbox Game Studios.', caption: { focus: 'PHYSINT', fullText: 'PHYSINT PUBLISHED BY XBOX' } },
      { type: 'close', duration: 3, narration: 'Stay with NEWS-MONSTER.', caption: { focus: 'SUB', fullText: 'YOUR CALL' } },
    ],
  }
  const story = director.validate(plan, KOJIMA_ARTICLE, 'youtube_video')
  const fact = story.scenePlan.find(s => s.type === 'fact')
  assert.ok(fact.caption.fullText.length > 0, 'empty caption was filled')
  assert.ok(/XBOX|KOJIMA|PHYSINT|DEATH|STRANDING/.test(fact.caption.fullText), `caption is article-derived: ${fact.caption.fullText}`)
  // narration remains VO-only — the caption is NOT the VO sentence
  assert.notEqual(norm(fact.caption.fullText), norm(fact.narration))
  assert.ok(fact.narration.includes('Xbox is expanding'), 'narration untouched')
})

test('validate() fills ALL empty captions from the article (fixture B)', () => {
  const director = new StoryDirector(null)
  const plan = {
    headline: 'iPad prices',
    scenePlan: [
      { type: 'hook', duration: 2.5, narration: 'When did iPads get as expensive as MacBooks?', caption: { focus: '', fullText: '' } },
      { type: 'fact', duration: 5.5, narration: 'Would you switch out your MacBook for an iPad with an M4 chip and OLED display?', caption: { focus: '', fullText: '' } },
      { type: 'explanation', duration: 5, narration: 'Apple seems to be arguing these are comparable but consumers will decide.', caption: { focus: '', fullText: '' } },
      { type: 'close', duration: 3, narration: 'Stay with NEWS-MONSTER.', caption: { focus: 'SUB', fullText: 'YOUR CALL' } },
    ],
  }
  const story = director.validate(plan, IPAD_ARTICLE, 'youtube_video')
  const caps = story.scenePlan.filter(s => s.type !== 'close').map(s => s.caption.fullText).join(' ')
  assert.ok(/IPAD|MACBOOK|M4|OLED|APPLE/.test(caps), `captions are article-derived: ${caps}`)
  for (const s of story.scenePlan) {
    if (s.type === 'close') continue
    assert.ok(s.caption.fullText.length > 0, `scene ${s.type} has a caption`)
    assert.ok(s.caption.fullText.split(' ').length <= 12, `caption fits the 16:9 visual cap: ${s.caption.fullText}`)
  }
})

// ── 4. Exact duplicate captions are rejected/normalized ────────────────────

test('validate() rejects exact duplicate visual captions', () => {
  const director = new StoryDirector(null)
  const plan = {
    headline: 'Kojima moves to Xbox',
    scenePlan: [
      { type: 'hook', duration: 2.5, narration: 'Kojima is leaving PlayStation.', caption: { focus: 'X', fullText: 'XBOX EXPANDS KOJIMA PARTNERSHIP' } },
      { type: 'fact', duration: 5.5, narration: 'Xbox is expanding its partnership with Hideo Kojima.', caption: { focus: 'X', fullText: 'XBOX EXPANDS KOJIMA PARTNERSHIP' } },
      { type: 'reveal', duration: 4.5, narration: 'Physint publishes on Xbox.', caption: { focus: 'X', fullText: 'PHYSINT PUBLISHES ON XBOX' } },
      { type: 'close', duration: 3, narration: 'Stay with NEWS-MONSTER.', caption: { focus: 'SUB', fullText: 'YOUR CALL' } },
    ],
  }
  const story = director.validate(plan, KOJIMA_ARTICLE, 'youtube_video')
  const caps = story.scenePlan.filter(s => s.type !== 'close').map(s => norm(s.caption.fullText))
  assert.equal(caps.length, new Set(caps).size, `no duplicate captions: ${caps.join(' | ')}`)
  // the duplicate's replacement is still the article (never a template)
  const joined = caps.join(' ')
  assert.ok(/XBOX|KOJIMA|PHYSINT|DEATH|STRANDING/.test(joined), `replacement is article-derived: ${joined}`)
})

// ── 5. Obvious repeated template captions are NOT separate beats ───────────

test('template normalization: "THE WORLD WAS AGAINST THEM" and "THE WORLD WAS AGAINST THEM?" are the same beat', () => {
  const a = norm('THE WORLD WAS AGAINST THEM')
  const b = norm('THE WORLD WAS AGAINST THEM?')
  assert.equal(a, b)
  assert.equal(isGenericStoryTemplate(a), true)
  assert.equal(isGenericStoryTemplate(b), true)
})

test('template normalization: "NOBODY EXPECTED THIS" and "NOBODY EXPECTED THIS FROM DEATH" are the same beat', () => {
  assert.equal(isGenericStoryTemplate(norm('NOBODY EXPECTED THIS')), true)
  assert.equal(isGenericStoryTemplate(norm('NOBODY EXPECTED THIS MOVE FROM DEATH')), true)
})

test('validate() replaces every generic-template caption with the article' + "'" + 's own facts', () => {
  const director = new StoryDirector(null)
  const plan = {
    headline: 'Kojima moves to Xbox',
    scenePlan: [
      { type: 'hook', duration: 2.5, narration: 'The story begins.', caption: { focus: 'X', fullText: 'NOBODY EXPECTED THIS' } },
      { type: 'fact', duration: 5.5, narration: 'Xbox is expanding its partnership with video game industry legend Hideo Kojima.', caption: { focus: 'X', fullText: 'THE WORLD WAS AGAINST THEM?' } },
      { type: 'explanation', duration: 5, narration: 'Physint will be published by Xbox Game Studios.', caption: { focus: 'X', fullText: 'NOBODY EXPECTED THIS MOVE FROM DEATH' } },
      { type: 'reaction', duration: 5, narration: 'Kojima Productions confirmed the announcement.', caption: { focus: 'X', fullText: 'EVERY SMALL WIN COUNTED' } },
      { type: 'close', duration: 3, narration: 'Stay with NEWS-MONSTER.', caption: { focus: 'SUB', fullText: 'YOUR CALL' } },
    ],
  }
  const story = director.validate(plan, KOJIMA_ARTICLE, 'youtube_video')
  const caps = story.scenePlan.filter(s => s.type !== 'close').map(s => s.caption.fullText)
  for (const c of caps) {
    assert.equal(isGenericStoryTemplate(norm(c)), false, `generic caption survived: "${c}"`)
    assert.ok(c.length > 0, 'caption replaced with real content')
  }
  const joined = caps.join(' ')
  assert.ok(/XBOX|KOJIMA|PHYSINT|DEATH|STRANDING/.test(joined), `all captions article-derived: ${joined}`)
})

test('generic template NARRATION is replaced with the article lead (nobody expected this move from death → news)', () => {
  const director = new StoryDirector(null)
  const plan = {
    headline: 'Kojima moves to Xbox',
    scenePlan: [
      { type: 'hook', duration: 2.5, narration: 'Nobody expected this move from death.', caption: { focus: 'X', fullText: 'KOJIMA MOVES TO XBOX' } },
      { type: 'fact', duration: 5.5, narration: 'Xbox is expanding its partnership with video game industry legend Hideo Kojima.', caption: { focus: 'X', fullText: '' } },
      { type: 'reveal', duration: 4.5, narration: 'Physint will be published by Xbox Game Studios.', caption: { focus: 'X', fullText: '' } },
      { type: 'close', duration: 3, narration: 'Stay with NEWS-MONSTER.', caption: { focus: 'SUB', fullText: 'YOUR CALL' } },
    ],
  }
  const story = director.validate(plan, KOJIMA_ARTICLE, 'youtube_video')
  const hook = story.scenePlan[0]
  assert.equal(isGenericStoryTemplate(norm(hook.narration)), false, `hook narration is news: ${hook.narration}`)
  assert.ok(/Xbox|Kojima|Physint|Death|Stranding/i.test(hook.narration), `hook narration derives from the article: ${hook.narration}`)
})

// ── 6. Narration stays VO-only / caption.fullText stays VISUAL-only ────────

test('SceneTextManifest never turns narration into the caption layer', () => {
  const manifest = SceneTextManifest.build({
    id: 1,
    type: 'fact',
    text: 'A HEADLINE',
    narration: 'The spoken sentence must never be re-printed as a caption.',
    caption: '',
    caption_focus: '',
  })
  assert.equal(manifest.text_layers.some(l => l.type === 'caption'), false, 'no caption layer from narration')
  const headline = manifest.text_layers.find(l => l.type === 'headline')
  assert.equal(headline.text, 'A HEADLINE')
})

test('fallbackPlan captions are never byte-equal to their narration (VO-only contract)', () => {
  const director = new StoryDirector(null)
  for (const article of [KOJIMA_ARTICLE, IPAD_ARTICLE, ANTHROPIC_ARTICLE]) {
    const story = director.fallbackPlan(article)
    for (const s of story.scenePlan) {
      if (!s.caption?.fullText) continue
      assert.notEqual(norm(s.caption.fullText), norm(s.narration),
        `caption duplicated narration: "${s.caption.fullText}" / "${s.narration}"`)
    }
  }
})

// ── 7. Fallback plan remains structurally unique (dedup gate intact) ───────

test('fallbackPlan narrations are unique within the video (existing gate preserved)', () => {
  const director = new StoryDirector(null)
  for (const article of [KOJIMA_ARTICLE, IPAD_ARTICLE, ANTHROPIC_ARTICLE]) {
    const story = director.fallbackPlan(article)
    const gate = ScriptUniqueness.validateWithinVideo(story.scenePlan.map(s => s.narration))
    assert.equal(gate.pass, true, `fallback narrations unique for ${article.title}: ${gate.reason || ''}`)
    assert.ok(story.scenePlan.length >= 7, 'full 7-scene structure preserved')
  }
})

// ── 8. TopicCtaBuilder is article-aware, not arc-emotional ─────────────────

test('TopicCtaBuilder builds a news question from the article, never the rain/shelter arc', () => {
  const builder = new TopicCtaBuilder()
  for (const article of [KOJIMA_ARTICLE, IPAD_ARTICLE, ANTHROPIC_ARTICLE]) {
    const cta = builder.build(article)
    assert.ok(!/shelter|rain/i.test(cta.cta), `CTA no longer arc-emotional: ${cta.cta}`)
    assert.ok(!/never giving up/i.test(cta.cta), `CTA no longer moral-template: ${cta.cta}`)
    assert.ok(cta.cta.length > 10, 'CTA present')
    assert.ok(cta.caption && cta.engagement && cta.pinnedComment && cta.narration, 'CTA contract shape intact')
  }
})

// ── 9. Banned-template catalog sanity ──────────────────────────────────────

test('the exact phrases observed on the published videos are all in the template list', () => {
  const observed = [
    'Nobody expected this move',
    'The world was against them',
    'It started like any day',
    'Every small win counted',
    'Every night they kept going',
    'Then it happened',
    'The whole world started watching',
    'Now the whole world is watching',
    'The power of never giving up',
  ]
  for (const phrase of observed) {
    assert.equal(isGenericStoryTemplate(norm(phrase)), true, `"${phrase}" is a banned template`)
  }
  assert.ok(GENERIC_STORY_TEMPLATES.length >= 12, 'template catalog is non-trivial')
})

// ── 10. ScenePlanner hook headline is the ARTICLE headline, not the VO ─────

test('ScenePlanner hook scene renders the article headline, not the full narration sentence', () => {
  const planner = new ScenePlanner()
  const scene = planner.buildScene(
    { id: 1, type: 'hook', duration: 3, narration: 'Nobody expected this move from death.', caption: 'KOJIMA MOVES TO XBOX', caption_focus: 'KOJIMA' },
    0,
    { title: "'Death Stranding' Creator Hideo Kojima's Upcoming 'Physint' Moves From PlayStation to Xbox", category: 'gaming' }
  )
  assert.ok(!/nobody expected/i.test(scene.text), `hook headline is not the VO template: ${scene.text}`)
  assert.ok(/kojima|xbox|death|stranding|physint/i.test(scene.text), `hook headline is the news: ${scene.text}`)
  assert.ok(scene.text.length <= 60, `hook headline stays short: ${scene.text.length}`)
  // the VO sentence is preserved on the audio channel only
  assert.equal(scene.narration, 'Nobody expected this move from death.')
})

// ── 11. End-to-end plan for the fixture: news-first captions + narration ───

test('full validated plan for fixture A: important facts are on screen, narrative is unique', () => {
  const director = new StoryDirector(null)
  const story = director.validate({ headline: 'x', scenePlan: [
    { type: 'hook', duration: 2.5, narration: 'Kojima is leaving PlayStation.', caption: { focus: 'KOJIMA', fullText: 'KOJIMA LEAVES PLAYSTATION' } },
    { type: 'fact', duration: 5.5, narration: 'Xbox is expanding its partnership with video game industry legend Hideo Kojima.', caption: { focus: 'XBOX', fullText: '' } },
    { type: 'explanation', duration: 5, narration: 'Physint will be published by Xbox Game Studios.', caption: { focus: 'PHYSINT', fullText: '' } },
    { type: 'reaction', duration: 5, narration: 'Kojima Productions confirmed the announcement at a Tokyo keynote.', caption: { focus: 'NEXT', fullText: '' } },
    { type: 'close', duration: 3, narration: 'Stay with NEWS-MONSTER.', caption: { focus: 'SUB', fullText: 'YOUR CALL' } },
  ] }, KOJIMA_ARTICLE, 'youtube_video')
  const caps = story.scenePlan.filter(s => s.type !== 'close').map(s => s.caption.fullText)
  const joined = caps.join(' ')
  assert.ok(/XBOX|KOJIMA|PHYSINT/.test(joined), `important facts on screen: ${joined}`)
  for (const c of caps) assert.equal(isGenericStoryTemplate(norm(c)), false, `generic caption: ${c}`)
  const gate = ScriptUniqueness.validateWithinVideo(story.scenePlan.map(s => s.narration))
  assert.equal(gate.pass, true, `narration unique: ${gate.reason || ''}`)
  // 16:9 center-stage contract: captions stay visual-only and concise
  for (const s of story.scenePlan) {
    if (s.type === 'close') continue
    assert.ok(s.caption.fullText.split(' ').length <= 12, `caption within the 12-word visual cap: ${s.caption.fullText}`)
  }
})