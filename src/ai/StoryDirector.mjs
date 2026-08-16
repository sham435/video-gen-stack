import { PromptEngine } from './PromptEngine.mjs'
import { pickAlgorithm } from './StoryAlgorithmRegistry.mjs'
import { TopicCtaBuilder } from '../publishing/TopicCtaBuilder.mjs'
import { brandOutroScene, BRAND_OUTRO } from '../publishing/BrandOutro.mjs'
import { parseStructured } from './parseStructured.mjs'

const HOOK_STRATEGIES = ['mystery', 'shock', 'question', 'stat']
const SCENE_TYPES = ['hook', 'fact', 'reveal', 'explanation', 'reaction', 'close']
const CAMERA_MOTIONS = ['push_in', 'slow_zoom', 'orbit', 'pan', 'shake', 'parallax', 'pull_back']
const TRANSITIONS = ['cut', 'flash', 'glitch', 'zoom_blur', 'light_leak', 'crossfade']
const EMOTIONS = ['shock', 'awe', 'curiosity', 'tension', 'excitement', 'neutral']

// JSON-001: the minimal container schema the downstream planner requires. The
// LLM may return markdown fences, prose, truncated, or wrong-typed JSON — this
// gate parses + validates + retries once before a scene ever reaches validate().
const STORY_SCHEMA = {
  headline: 'string',
  scenePlan: 'array',
}

export class StoryDirector {
  constructor(provider) {
    this.provider = provider
    this.promptEngine = new PromptEngine()
  }

  async plan(article, options = {}) {
    const targetFormat = options.targetFormat || article.targetFormat || 'youtube_shorts'
    this.lastAlgorithm = pickAlgorithm({ title: article.title || '', category: article.category })
    const messages = this.buildPrompt(article, targetFormat)
    const story = await this.queryLLM(messages, article)
    return this.validate(story, article, targetFormat)
  }

  // The last scene is ALWAYS the fixed brand outro — the LLM is told not to
  // invent close text, and this overwrites whatever it returned anyway, so
  // article words can never leak into the ending. The story source still
  // travels through so the end card can credit it, and the topic CTA is
  // carried in so the renderer can draw the engagement question on-screen.
  applyBrandOutro(story, article = {}) {
    const scenePlan = Array.isArray(story.scenePlan) ? story.scenePlan.slice(0, -1) : []
    let cta = null
    try { cta = new TopicCtaBuilder().build(article) } catch {}
    scenePlan.push(brandOutroScene(article, cta))
    return { ...story, scenePlan, brandMoment: { type: 'cta', sceneIndex: scenePlan.length - 1 } }
  }

  buildPrompt(article, targetFormat) {
    const algo = this.lastAlgorithm || pickAlgorithm({ title: article.title || '', category: article.category })
    return [
      {
        role: 'system',
        content: `You are a cinematic AI Story Director for NEWS-MONSTER, a premium video news platform.
Anchor voice: sham435 · ANCHOR (the channel's hard-hitting storyteller).

Given a news article and target format, produce a structured video production plan as JSON.

## STORY FORMULA (3-act arc — mandatory for every video)
ACT 1 — PROBLEM / THE TRAGEDY 😭 (0-8s)
Dark, rainy, lonely. Establish the victim and the unfair world. Visual: rain on glass, grainy newsroom, empty street, worried face.
VO: "It started like any day for [the archetype]."

ACT 2 — COURAGE / SACRIFICE 💪 (8-18s)
The hero fights back against the machine — building, sharing, studying, refusing to give up. Visual: hands working, night desk lamp, small wins.
VO: "But [the archetype] refused to give up."

ACT 3 — TRANSFORMATION ✨ (18-25s)
Family love, celebration, golden hour light. The world notices. Visual: embrace, golden light, applause.
VO: "Now the whole world is watching."

Total: 25s for youtube_shorts (8/10/7). Always end with a moral: "This is the power of never giving up."

## Hook Strategies
Pick one (avoid "hidden/revealed/secret/shocking" phrasing — the channel uses dynamic curiosity patterns only):
- "mystery": "Nobody expected what X just did"
- "shock": "X changed everything overnight"
- "question": "What if everything you knew about X was wrong?"
- "stat": "One number explains why X just changed everything"

Current algorithm: ${algo.id} (#${algo.number}/48)
Anchor hook: "Nobody expected this move — ${article.title || 'this'}"

## Scene Types
- hook (0-3s): stop-scroll intro, max 10 words
- fact (3-7s): reveal what happened
- reveal (3-5s): the big reveal moment
- explanation (4-8s): why it matters
- reaction (3-5s): create tension/impact
- close: THE FIXED BRAND OUTRO. NEVER invent close text. The last scene MUST
  be the fixed NEWS-MONSTER outro card:
  headline "STAY WITH" / brand "NEWS-MONSTER" (visual subject: NEWS-MONSTER
  brand logo) / narration "${BRAND_OUTRO.narration}". Article content must
  never appear in the close scene.

## Output Schema
{
  "headline": "declassified-style headline",
  "hookStrategy": "mystery|shock|question|stat",
  "emotionalArc": ["curiosity", "surprise", "authority", "futureVision"],
  "scenePlan": [
    {
      "type": "hook",
      "duration": 2.5,
      "narration": "hook text, max 10 words",
      "visual": {
        "subject": "main visual subject",
        "style": "cinematic style description",
        "composition": "close_up|wide|medium|dutch_angle"
      },
      "camera": "push_in|slow_zoom|orbit|pan|shake|parallax|pull_back",
      "motion": "cinematicReveal|depthBlur|particleField|digitalHUD|null",
      "transition": "cut|flash|glitch|zoom_blur|light_leak",
      "emotion": "shock|awe|curiosity|tension|excitement",
      "caption": {
        "focus": "KEYWORD (1-3 words to highlight)",
        "fullText": "caption text for bottom overlay"
      }
    }
  ],
  "brandMoment": {
    "type": "reveal|cta",
    "sceneIndex": 0
  },
  "cta": "call to action text"
}

Rules:
- Total duration: 25-35s for youtube_shorts, 45-60s for tiktok/instagram
- emotionalArc: 3-5 emotions that define the story's emotional journey
- Each scene must have a distinct purpose
- Hook scene must use hookStrategy for its narration
- Visual subject describes what to show (concise)
- Camera motion must match the emotional intensity

Output ONLY valid JSON.`
        },
        {
          role: 'user',
          content: `Title: ${article.title || 'Tech News'}
Source: ${article.source || 'News'}
Description: ${(article.description || article.title || '').slice(0, 500)}
Category: ${article.category || 'technology'}
Algorithm: ${algo.id} (#${algo.number}/48)
Visual style: ${algo.visual.prompt}
Target Format: ${targetFormat}`
        }
      ]
  }

  async queryLLM(messages, article) {
    if (this.provider) {
      try {
        const raw = await this.provider.generate(messages, { json: true })
        // JSON-001: structured gate — fence-strip, parse, validate, retry once
        // with a correction request, THEN hand the validated plan to validate().
        return await parseStructured(raw, {
          schema: STORY_SCHEMA,
          attempts: 1,
          generate: async (prompt, opts) => {
            const retry = await this.provider.generate([{ role: 'user', content: prompt }], { json: true, ...opts })
            return retry
          },
          correct: (detail) => `Your previous JSON response was invalid. Fix these issues and return ONLY valid JSON: ${detail.errors ? detail.errors.join('; ') : detail.raw || 'invalid structure'}`,
        })
      } catch (e) { console.log('StoryDirector LLM error:', e.message) }
    }
    return this.fallbackPlan(article)
  }

  fallbackPlan(article) {
    const title = article.title || 'Tech News'
    const desc = article.description || ''
    const sentences = desc.split(/[.!?]+/).filter(s => s.trim().length > 10)
    const algo = this.lastAlgorithm || pickAlgorithm({ title, category: article.category })
    const arc = algo.arc.toLowerCase().replace(/_/g, ' ')
    const brand = (title.split(' ')[0] || 'TECH').toUpperCase()
    const cta = new TopicCtaBuilder().build(article)
    return {
      headline: `${brand} CHANGED EVERYTHING`,
      hookStrategy: 'curiosity',
      emotionalArc: ['shock', 'courage', 'hope', 'futureVision'],
      algorithm: algo,
      scenePlan: [
        { type: 'hook', duration: 2.5, narration: `Nobody expected this move from ${brand}.`, visual: { subject: brand, style: 'cinematic dramatic', composition: 'close_up' }, camera: 'push_in', motion: 'cinematicReveal', transition: 'glitch', emotion: 'shock', caption: { focus: 'NOBODY', fullText: 'NOBODY EXPECTED THIS' } },
        // ACT 1 — THE TRAGEDY 😭
        { type: 'fact', duration: 5.5, narration: `It started like any day for the ${arc}. ${title.split(' ').slice(0, 6).join(' ')}. The world was against them.`, visual: { subject: `rain on glass, empty street, ${arc} alone`, style: 'dark rainy documentary, grainy newsroom', composition: 'wide' }, camera: 'slow_zoom', motion: 'depthBlur', transition: 'flash', emotion: 'tension', caption: { focus: 'TRAGEDY', fullText: 'IT ALL STARTED SO WRONG' } },
        // ACT 2 — COURAGE 💪
        { type: 'explanation', duration: 5, narration: `${sentences[0] || 'But they refused to give up.'} Every small win counted. Every night they kept going.`, visual: { subject: 'hands working at night desk lamp, building, small wins', style: algo.visual.prompt, composition: 'medium' }, camera: 'orbit', motion: null, transition: 'zoom_blur', emotion: 'awe', caption: { focus: 'COURAGE', fullText: 'THEY REFUSED TO GIVE UP' } },
        { type: 'reaction', duration: 5, narration: sentences[1] || 'And little by little, the machine could not ignore them anymore.', visual: { subject: 'spotlight evidence, determination', style: 'documentary', composition: 'medium' }, camera: 'parallax', motion: 'depthBlur', transition: 'light_leak', emotion: 'curiosity', caption: { focus: 'FIGHT', fullText: 'THE FIGHT BACK' } },
        // ACT 3 — TRANSFORMATION ✨
        { type: 'reveal', duration: 4.5, narration: 'And then it happened. The whole world started watching.', visual: { subject: 'golden hour light, applause, embrace', style: 'golden warm celebration', composition: 'wide' }, camera: 'shake', motion: 'particleField', transition: 'glitch', emotion: 'excitement', caption: { focus: 'TRANSFORM', fullText: 'THE WORLD IS WATCHING' } },
        { type: 'reaction', duration: 2.5, narration: 'Now the whole world is watching. This is the power of never giving up.', visual: { subject: 'industry impact, golden light', style: 'glowing data streams', composition: 'wide' }, camera: 'pan', motion: 'digitalHUD', transition: 'cut', emotion: 'excitement', caption: { focus: 'IMPACT', fullText: 'NEVER GIVE UP' } },
        { type: 'close', duration: 3, narration: cta.narration, visual: { subject: 'NEWS-MONSTER brand', style: 'red and cyan futuristic', composition: 'medium' }, camera: 'pull_back', motion: null, transition: 'fade', emotion: 'excitement', caption: { focus: 'SUB', fullText: cta.caption } },
      ],
      brandMoment: { type: 'cta', sceneIndex: 6 },
      cta: cta.cta,
      engagement: cta.engagement,
    }
  }

  validate(story, article, targetFormat) {
    if (!story.scenePlan || !Array.isArray(story.scenePlan) || story.scenePlan.length < 2) {
      console.log('StoryDirector: invalid scenePlan, using fallback')
      return this.applyBrandOutro(this.fallbackPlan(article))
    }
    story.scenePlan.forEach((s, i) => {
      s.type = SCENE_TYPES.includes(s.type) ? s.type : 'fact'
      s.duration = Math.max(2, Math.min(8, s.duration || 3))
      s.camera = CAMERA_MOTIONS.includes(s.camera) ? s.camera : 'push_in'
      s.transition = TRANSITIONS.includes(s.transition) ? s.transition : 'cut'
      s.emotion = EMOTIONS.includes(s.emotion) ? s.emotion : 'neutral'
      if (!s.caption) s.caption = { focus: 'NEWS', fullText: (s.narration || '').toUpperCase() }
    })
    story.algorithm = story.algorithm || this.lastAlgorithm || pickAlgorithm({ title: article.title || '', category: article.category })
    const total = story.scenePlan.reduce((sum, s) => sum + s.duration, 0)
    if (total < 15 || total > 60) {
      console.log(`StoryDirector: total duration ${total}s out of range, falling back`)
      return this.applyBrandOutro(this.fallbackPlan(article))
    }
    return this.applyBrandOutro(story, article)
  }
}