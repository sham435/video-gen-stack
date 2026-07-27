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
          content: `You are a viral short-form video scriptwriter for the TECH-MONSTER news channel.

Given a news article, produce a structured video plan as JSON.

Rules:
- Duration: 25-35 seconds total
- Hook (0-3s): create urgency/curiosity, max 10 words
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
  "headline": "short headline",
  "hook": "curiosity hook text",
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
      headline: title.slice(0, 60),
      hook: `Nobody expected what ${(title.split(' ')[0] || 'they')} just did.`,
      scenes: [
        { id: 1, type: 'hook', purpose: 'breaking news alert', narration: `${title.split(' ').slice(0, 8).join(' ')}.`, visual_prompt: `cinematic news broadcast breaking ${title.slice(0, 40)}, dramatic lighting, 8k`, camera: 'push_in', transition: 'flash', emotion: 'shock', music_cue: 'intro', sfx: 'impact', caption_focus: 'BREAKING', duration: 2.5 },
        { id: 2, type: 'fact', purpose: 'reveal the company', narration: `${title.split(' ').slice(0, 6).join(' ')} has announced a major development.`, visual_prompt: `technology company headquarters, modern architecture, cinematic lighting, 8k`, camera: 'slow_zoom', transition: 'cut', emotion: 'awe', music_cue: 'build', sfx: 'whoosh', caption_focus: 'ANNOUNCES', duration: 4 },
        { id: 3, type: 'explanation', purpose: 'explain what happened', narration: sentences[0] || `This changes the technology landscape significantly.`, visual_prompt: `futuristic technology concept, holographic display, data visualization, blue neon, 8k`, camera: 'orbit', transition: 'zoom_blur', emotion: 'curiosity', music_cue: 'build', sfx: 'whoosh', caption_focus: 'CHANGES', duration: 5 },
        { id: 4, type: 'reaction', purpose: 'create tension', narration: sentences[1] || `Industry experts are calling this a game-changing move.`, visual_prompt: `analysts discussing technology, news studio, professional lighting, 8k`, camera: 'parallax', transition: 'light_leak', emotion: 'tension', music_cue: 'suspense', sfx: 'alert', caption_focus: 'GAME CHANGER', duration: 4 },
        { id: 5, type: 'reveal', purpose: 'the hidden detail', narration: `But here is what nobody is talking about yet.`, visual_prompt: `hidden discovery, dramatic reveal, spotlight, dark environment, cinematic, 8k`, camera: 'shake', transition: 'glitch', emotion: 'tension', music_cue: 'suspense', sfx: 'riser', caption_focus: 'NOBODY', duration: 3.5 },
        { id: 6, type: 'reaction', purpose: 'community response', narration: `The community is already reacting to this development.`, visual_prompt: `social media reactions, glowing comments, digital interface, neon, 8k`, camera: 'pan', transition: 'cut', emotion: 'excitement', music_cue: 'resolve', sfx: 'reveal', caption_focus: 'REACTING', duration: 3 },
        { id: 7, type: 'close', purpose: 'call to action', narration: `Follow TECH-MONSTER for daily tech breakthroughs.`, visual_prompt: `TECH-MONSTER brand logo, red and cyan, futuristic, cinematic, 8k`, camera: 'pull_back', transition: 'fade', emotion: 'excitement', music_cue: 'outro', sfx: 'none', caption_focus: 'FOLLOW', duration: 3 },
      ],
      cta: 'Follow for more tech news.',
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
