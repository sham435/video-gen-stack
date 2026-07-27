const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions'

export class StoryPlanner {
  constructor(apiKey) {
    this.apiKey = apiKey || process.env.OPENROUTER_API_KEY
  }

  async plan(article) {
    const prompt = this.buildPrompt(article)
    const story = await this.queryLLM(prompt)
    return this.validate(story, article)
  }

  buildPrompt(article) {
    return {
      model: process.env.LLM_MODEL || 'openrouter/auto',
      messages: [
        {
          role: 'system',
          content: `You are a viral short-form video scriptwriter for TECH-MONSTER, a premium tech news channel.

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
  - visual_prompt: detailed AI image prompt (ultra realistic cinematic, 8k, vertical 9:16)
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
      "visual_prompt": "detailed cinematic prompt, vertical 9:16",
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
      ],
      temperature: 0.7,
      response_format: { type: 'json_object' }
    }
  }

  async queryLLM(payload) {
    if (this.apiKey) {
      try {
        const res = await fetch(OPENROUTER_URL, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${this.apiKey}`,
            'Content-Type': 'application/json',
            'HTTP-Referer': 'https://github.com/sham435/video-gen-stack',
          },
          body: JSON.stringify({ ...payload, stream: false }),
          signal: AbortSignal.timeout(30000),
        })
        if (res.ok) {
          const data = await res.json()
          const content = data.choices?.[0]?.message?.content
          if (content) return JSON.parse(content)
        }
      } catch (e) { console.log('OpenRouter LLM error:', e.message) }
    }

    return this.fallbackPlan(payload)
  }

  fallbackPlan(article) {
    const title = article.title || 'Tech News'
    const desc = article.description || ''
    const sentences = desc.split(/[.!?]+/).filter(s => s.trim().length > 10)
    return {
      headline: `${(title.split(' ')[0] || 'TECH').toUpperCase()} DECLASSIFIED`,
      hook: `Why ${(title.split(' ').slice(0, 3).join(' ') || 'they')} buried this secret.`,
      scenes: [
        { id: 1, type: 'hook', purpose: 'stop scroll with exclusive reveal', narration: `Why ${(title.split(' ').slice(0, 3).join(' ') || 'they')} buried this secret.`, visual_prompt: `cinematic mystery reveal, dark dramatic lighting, glitch effect, split screen, carbon fiber texture, 8k`, camera: 'push_in', transition: 'glitch', emotion: 'shock', music_cue: 'intro', sfx: 'impact', caption_focus: 'SECRET', duration: 2.5 },
        { id: 2, type: 'fact', purpose: 'reveal what happened', narration: `${title.split(' ').slice(0, 6).join(' ')}. Nobody expected this move.`, visual_prompt: `dramatic technology reveal, cinematic lighting, mystery atmosphere, neon accents, 8k`, camera: 'slow_zoom', transition: 'flash', emotion: 'awe', music_cue: 'build', sfx: 'whoosh', caption_focus: 'NOBODY', duration: 4 },
        { id: 3, type: 'explanation', purpose: 'explain the hidden detail', narration: sentences[0] || `This changes everything you thought you knew.`, visual_prompt: `forensic analysis, digital evidence, code on screen, carbon fiber background, neon magenta, 8k`, camera: 'orbit', transition: 'zoom_blur', emotion: 'curiosity', music_cue: 'build', sfx: 'riser', caption_focus: 'EXPOSED', duration: 5 },
        { id: 4, type: 'reaction', purpose: 'create tension and doubt', narration: sentences[1] || `Most people still don't know about this.`, visual_prompt: `hidden truth revealed, spotlight on evidence, dramatic documentary style, 8k`, camera: 'parallax', transition: 'light_leak', emotion: 'tension', music_cue: 'suspense', sfx: 'alert', caption_focus: 'HIDDEN', duration: 4 },
        { id: 5, type: 'reveal', purpose: 'the big reveal', narration: `But here is what nobody noticed until now.`, visual_prompt: `explosive reveal, dramatic impact, particles flying, cinematic lighting, 8k`, camera: 'shake', transition: 'glitch', emotion: 'tension', music_cue: 'suspense', sfx: 'reveal', caption_focus: 'REVEALED', duration: 3.5 },
        { id: 6, type: 'reaction', purpose: 'why it matters', narration: `This changes the entire industry going forward.`, visual_prompt: `industry impact visualization, glowing data streams, futuristic interface, 8k`, camera: 'pan', transition: 'cut', emotion: 'excitement', music_cue: 'resolve', sfx: 'whoosh', caption_focus: 'IMPACT', duration: 3 },
        { id: 7, type: 'close', purpose: 'call to action', narration: `Follow TECH-MONSTER for exclusive analysis you won't find anywhere else.`, visual_prompt: `TECH-MONSTER brand logo, red and cyan, futuristic, cinematic, 8k`, camera: 'pull_back', transition: 'fade', emotion: 'excitement', music_cue: 'outro', sfx: 'none', caption_focus: 'FOLLOW', duration: 3 },
      ],
      cta: 'Follow TECH-MONSTER for exclusive analysis you will not find anywhere else.',
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
