import { PromptEngine } from './PromptEngine.mjs'

const HOOK_STRATEGIES = ['mystery', 'shock', 'question', 'stat']
const SCENE_TYPES = ['hook', 'fact', 'reveal', 'explanation', 'reaction', 'close']
const CAMERA_MOTIONS = ['push_in', 'slow_zoom', 'orbit', 'pan', 'shake', 'parallax', 'pull_back']
const TRANSITIONS = ['cut', 'flash', 'glitch', 'zoom_blur', 'light_leak', 'crossfade']
const EMOTIONS = ['shock', 'awe', 'curiosity', 'tension', 'excitement', 'neutral']

export class StoryDirector {
  constructor(provider) {
    this.provider = provider
    this.promptEngine = new PromptEngine()
  }

  async plan(article, options = {}) {
    const targetFormat = options.targetFormat || article.targetFormat || 'youtube_shorts'
    const messages = this.buildPrompt(article, targetFormat)
    const story = await this.queryLLM(messages, article)
    return this.validate(story, article, targetFormat)
  }

  buildPrompt(article, targetFormat) {
    return [
      {
        role: 'system',
        content: `You are a cinematic AI Story Director for NEWS-MONSTER, a premium video news platform.

Given a news article and target format, produce a structured video production plan as JSON.

## Hook Strategies
Pick one:
- "mystery": "Why X buried this secret for years"
- "shock": "Nobody expected what X just did"  
- "question": "What if everything you knew about X was wrong?"
- "stat": "[Number] years later, we found the truth"

## Scene Types
- hook (0-3s): stop-scroll intro, max 10 words
- fact (3-7s): reveal what happened
- reveal (3-5s): the big reveal moment
- explanation (4-8s): why it matters
- reaction (3-5s): create tension/impact
- close (2-4s): CTA + brand

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
Target Format: ${targetFormat}`
        }
      ]
  }

  async queryLLM(messages, article) {
    if (this.provider) {
      try {
        return await this.provider.generate(messages, { json: true })
      } catch (e) { console.log('StoryDirector LLM error:', e.message) }
    }
    return this.fallbackPlan(article)
  }

  fallbackPlan(article) {
    const title = article.title || 'Tech News'
    const desc = article.description || ''
    const sentences = desc.split(/[.!?]+/).filter(s => s.trim().length > 10)
    const brand = (title.split(' ')[0] || 'TECH').toUpperCase()
    return {
      headline: `${brand} DECLASSIFIED`,
      hookStrategy: 'mystery',
      emotionalArc: ['curiosity', 'surprise', 'authority', 'futureVision'],
      scenePlan: [
        { type: 'hook', duration: 2.5, narration: `Why ${brand} buried this secret.`, visual: { subject: brand, style: 'cinematic mystery', composition: 'close_up' }, camera: 'push_in', motion: 'cinematicReveal', transition: 'glitch', emotion: 'shock', caption: { focus: 'SECRET', fullText: 'BURIED SECRET'.toUpperCase() } },
        { type: 'fact', duration: 4, narration: `${title.split(' ').slice(0, 6).join(' ')}. Nobody expected this.`, visual: { subject: 'technology reveal', style: 'dramatic lighting', composition: 'medium' }, camera: 'slow_zoom', motion: 'depthBlur', transition: 'flash', emotion: 'awe', caption: { focus: 'NOBODY', fullText: 'NOBODY EXPECTED THIS' } },
        { type: 'explanation', duration: 5, narration: sentences[0] || 'This changes everything you thought you knew.', visual: { subject: 'analysis', style: 'forensic digital', composition: 'wide' }, camera: 'orbit', motion: null, transition: 'zoom_blur', emotion: 'curiosity', caption: { focus: 'CHANGES', fullText: 'CHANGES EVERYTHING' } },
        { type: 'reaction', duration: 4, narration: sentences[1] || 'Most people still do not know about this.', visual: { subject: 'hidden truth', style: 'documentary', composition: 'medium' }, camera: 'parallax', motion: 'depthBlur', transition: 'light_leak', emotion: 'tension', caption: { focus: 'HIDDEN', fullText: 'HIDDEN TRUTH' } },
        { type: 'reveal', duration: 3.5, narration: 'But here is what nobody noticed until now.', visual: { subject: 'explosive reveal', style: 'dramatic impact', composition: 'close_up' }, camera: 'shake', motion: 'particleField', transition: 'glitch', emotion: 'tension', caption: { focus: 'REVEALED', fullText: 'NOW REVEALED' } },
        { type: 'reaction', duration: 3, narration: 'This changes the entire industry going forward.', visual: { subject: 'industry impact', style: 'glowing data streams', composition: 'wide' }, camera: 'pan', motion: 'digitalHUD', transition: 'cut', emotion: 'excitement', caption: { focus: 'IMPACT', fullText: 'INDUSTRY IMPACT' } },
        { type: 'close', duration: 3, narration: 'Follow NEWS-MONSTER for exclusive analysis.', visual: { subject: 'NEWS-MONSTER brand', style: 'red and cyan futuristic', composition: 'medium' }, camera: 'pull_back', motion: null, transition: 'fade', emotion: 'excitement', caption: { focus: 'FOLLOW', fullText: 'FOLLOW NEWS-MONSTER' } },
      ],
      brandMoment: { type: 'cta', sceneIndex: 6 },
      cta: 'Follow NEWS-MONSTER for exclusive analysis you will not find anywhere else.',
    }
  }

  validate(story, article, targetFormat) {
    if (!story.scenePlan || !Array.isArray(story.scenePlan) || story.scenePlan.length < 2) {
      console.log('StoryDirector: invalid scenePlan, using fallback')
      return this.fallbackPlan(article)
    }
    story.scenePlan.forEach((s, i) => {
      s.type = SCENE_TYPES.includes(s.type) ? s.type : 'fact'
      s.duration = Math.max(2, Math.min(8, s.duration || 3))
      s.camera = CAMERA_MOTIONS.includes(s.camera) ? s.camera : 'push_in'
      s.transition = TRANSITIONS.includes(s.transition) ? s.transition : 'cut'
      s.emotion = EMOTIONS.includes(s.emotion) ? s.emotion : 'neutral'
      if (!s.caption) s.caption = { focus: 'NEWS', fullText: (s.narration || '').toUpperCase() }
    })
    const total = story.scenePlan.reduce((sum, s) => sum + s.duration, 0)
    if (total < 15 || total > 60) {
      console.log(`StoryDirector: total duration ${total}s out of range, falling back`)
      return this.fallbackPlan(article)
    }
    return story
  }
}