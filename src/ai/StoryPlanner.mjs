import { TopicCtaBuilder } from '../publishing/TopicCtaBuilder.mjs'
import { parseStructured } from './parseStructured.mjs'

// JSON-001: minimal container schema the planner requires downstream.
const PLAN_SCHEMA = {
  headline: 'string',
  scenes: 'array',
}

export class StoryPlanner {
  constructor(provider) {
    this.provider = provider
  }

  async plan(article) {
    const messages = this.buildPrompt(article)
    const story = await this.queryLLM(messages, article)
    return this.validate(story, article)
  }

  buildPrompt(article) {
    return [
      {
        role: 'system',
        content: `You are a viral short-form video scriptwriter for NEWS-MONSTER, a premium tech news channel.

Given a news article, produce a structured video plan as JSON.

Style: mysterious, exclusive, documentary-style. Write hooks like:
- "Why [Company] Buried This Secret For Years"
- "Nobody Expected What [Product] Just Did"
- "The Hidden Feature [Company] Never Told You About"
- "[Number] Years Later, We Found The Truth"

Rules:
- Duration: 25-35 seconds total
- Hook (0-3s): create urgency/curiosity, max 10 words, use "declassified/exclusive" tone
- Each scene: 3-7 seconds, with specific purpose
- Every scene has:
  - type: hook | fact | reveal | explanation | reaction | close
  - narration: 1-2 sentences what the voice says
  - visual_prompt: detailed AI image prompt (ultra realistic cinematic, 8k, 16:9 landscape)
  - camera: push_in | slow_zoom | orbit | pan | shake | parallax | pull_back
  - transition: cut | flash | glitch | zoom_blur | light_leak
  - emotion: shock | awe | curiosity | tension | excitement
  - music_cue: intro | build | suspense | drop | resolve | outro
  - sfx: impact | whoosh | alert | riser | reveal | none
  - caption_focus: the 1-3 words to highlight in brightest yellow

Output ONLY valid JSON:
{
  "headline": "short declassified-style headline",
  "hook": "curiosity hook text, mystery/reveal style",
  "scenes": [
    {
      "id": 1,
      "type": "hook",
      "purpose": "stop scroll with breaking news",
      "narration": "8-12 words max",
      "visual_prompt": "detailed cinematic prompt, 16:9 landscape",
      "camera": "push_in",
      "transition": "flash",
      "emotion": "shock",
      "music_cue": "intro",
      "sfx": "impact",
      "caption_focus": "KEY WORD",
      "duration": 2.5
    }
  ],
  "cta": "call to action text"
}`
        },
        {
          role: 'user',
          content: `Title: ${article.title || 'Tech News'}
Source: ${article.source || 'News'}
Description: ${(article.description || article.title || '').slice(0, 500)}
Category: ${article.category || 'technology'}`
        }
      ]
  }

  async queryLLM(messages, article) {
    if (this.provider) {
      try {
        const raw = await this.provider.generate(messages, { json: true })
        // JSON-001: structured gate — parse/validate/retry-once before validate().
        return await parseStructured(raw, {
          schema: PLAN_SCHEMA,
          attempts: 1,
          generate: async (prompt, opts) => {
            return await this.provider.generate([{ role: 'user', content: prompt }], { json: true, ...opts })
          },
          correct: (detail) => `Your previous JSON response was invalid. Fix these issues and return ONLY valid JSON: ${detail.errors ? detail.errors.join('; ') : detail.raw || 'invalid structure'}`,
        })
      } catch (e) { console.log('StoryPlanner provider error:', e.message) }
    }
    return this.fallbackPlan(article)
  }

  fallbackPlan(article) {
    const title = article.title || 'Tech News'
    const desc = article.description || ''
    const sentences = desc.split(/[.!?]+/).filter(s => s.trim().length > 10)
    const brand = (title.split(' ')[0] || 'TECH').toUpperCase()
    const cta = new TopicCtaBuilder().build(article)
    return {
      headline: `${brand} CHANGES EVERYTHING`,
      hook: `Nobody expected this move from ${brand}.`,
      scenes: [
        { id: 1, type: 'hook', purpose: 'stop scroll with a curiosity gap', narration: `Nobody expected this move from ${brand}.`, visual_prompt: `cinematic dramatic lighting, glitch effect, split screen, carbon fiber texture, 8k`, camera: 'push_in', transition: 'glitch', emotion: 'shock', music_cue: 'intro', sfx: 'impact', caption_focus: 'NOBODY', duration: 2.5 },
        { id: 2, type: 'fact', purpose: 'reveal what happened', narration: `${title.split(' ').slice(0, 6).join(' ')}. This changed the plan overnight.`, visual_prompt: `dramatic technology reveal, cinematic lighting, mystery atmosphere, neon accents, 8k`, camera: 'slow_zoom', transition: 'flash', emotion: 'awe', music_cue: 'build', sfx: 'whoosh', caption_focus: 'CHANGED', duration: 4 },
        { id: 3, type: 'explanation', purpose: 'explain the overlooked detail', narration: sentences[0] || `Here is the detail everyone missed.`, visual_prompt: `forensic analysis, digital evidence, code on screen, carbon fiber background, neon magenta, 8k`, camera: 'orbit', transition: 'zoom_blur', emotion: 'curiosity', music_cue: 'build', sfx: 'riser', caption_focus: 'MISSED', duration: 5 },
        { id: 4, type: 'reaction', purpose: 'create tension and doubt', narration: sentences[1] || `Most people still do not know about this.`, visual_prompt: `spotlight on evidence, dramatic documentary style, 8k`, camera: 'parallax', transition: 'light_leak', emotion: 'tension', music_cue: 'suspense', sfx: 'alert', caption_focus: 'DOUBT', duration: 4 },
        { id: 5, type: 'reveal', purpose: 'the big reveal', narration: `But here is what happened after the announcement.`, visual_prompt: `explosive reveal, dramatic impact, particles flying, cinematic lighting, 8k`, camera: 'shake', transition: 'glitch', emotion: 'tension', music_cue: 'suspense', sfx: 'reveal', caption_focus: 'AFTER', duration: 3.5 },
        { id: 6, type: 'reaction', purpose: 'why it matters', narration: `This changes the entire industry going forward.`, visual_prompt: `industry impact visualization, glowing data streams, futuristic interface, 8k`, camera: 'pan', transition: 'cut', emotion: 'excitement', music_cue: 'resolve', sfx: 'whoosh', caption_focus: 'IMPACT', duration: 3 },
        { id: 7, type: 'close', purpose: 'call to action', narration: cta.narration, visual_prompt: `NEWS-MONSTER brand logo, red and cyan, futuristic, cinematic, 8k`, camera: 'pull_back', transition: 'fade', emotion: 'excitement', music_cue: 'outro', sfx: 'none', caption_focus: 'SUB', duration: 3 },
      ],
      cta: cta.cta,
      engagement: cta.engagement,
    }
  }

  validate(story, article) {
    if (!story.scenes || !Array.isArray(story.scenes) || story.scenes.length < 2) {
      return this.fallbackPlan(article)
    }
    story.scenes.forEach((s, i) => {
      s.id = i + 1
      s.duration = Math.max(2, Math.min(8, s.duration || 3))
    })
    const total = story.scenes.reduce((sum, s) => sum + s.duration, 0)
    if (total < 15 || total > 45) {
      return this.fallbackPlan(article)
    }
    return story
  }
}
