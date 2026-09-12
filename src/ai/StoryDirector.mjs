import { PromptEngine } from './PromptEngine.mjs'
import { pickAlgorithm } from './StoryAlgorithmRegistry.mjs'
import { TopicCtaBuilder } from '../publishing/TopicCtaBuilder.mjs'
import { brandOutroScene, BRAND_OUTRO } from '../publishing/BrandOutro.mjs'
import { parseStructured } from './parseStructured.mjs'
import { RepoContextReader } from './RepoContextReader.mjs'
import { ScriptUniqueness } from '../uniqueness/ScriptUniqueness.mjs'

const HOOK_STRATEGIES = ['mystery', 'shock', 'question', 'stat']
const SCENE_TYPES = ['hook', 'fact', 'reveal', 'explanation', 'reaction', 'close']
const CAMERA_MOTIONS = ['push_in', 'slow_zoom', 'orbit', 'pan', 'shake', 'parallax', 'pull_back']
const TRANSITIONS = ['cut', 'flash', 'glitch', 'zoom_blur', 'light_leak', 'crossfade']
const EMOTIONS = ['shock', 'awe', 'curiosity', 'tension', 'excitement', 'neutral']

// ── NEWS-FIRST CONTENT POLICY ──────────────────────────────────────────────
// Generic story-template phrases the LLM + deterministic fallback have
// historically recycled for UNRELATED articles (gaming / tech / AI-safety).
// They are banned as VISUAL CAPTIONS and as narration hooks: the article is
// the source of truth, and a phrase that merely describes "somebody's
// struggle" must never be auto-plugged into every story.
//
// Matching is prefix-based on the NORMALIZED (uppercase, punctuation-free)
// text, so "THE WORLD WAS AGAINST THEM?" and "THE WORLD WAS AGAINST THEM"
// resolve to the same template, and "NOBODY EXPECTED THIS MOVE FROM DEATH"
// resolves to the same template as "NOBODY EXPECTED THIS MOVE".
export const GENERIC_STORY_TEMPLATES = [
  'NOBODY EXPECTED THIS MOVE',
  'NOBODY EXPECTED THIS',
  'IT STARTED LIKE ANY DAY',
  'THE WORLD WAS AGAINST',
  'EVERY SMALL WIN',
  'EVERY NIGHT THEY KEPT GOING',
  'THEN IT HAPPENED',
  'THE WHOLE WORLD STARTED WATCHING',
  'NOW THE WHOLE WORLD IS WATCHING',
  'THE WORLD IS WATCHING',
  'THE POWER OF NEVER GIVING UP',
  'NEVER GIVE UP',
  'THEY REFUSED TO GIVE UP',
  'IT ALL STARTED SO WRONG',
  'THE FIGHT BACK',
]

// Low-signal words never lead a concise visual caption (uppercase match).
const CAPTION_OPENERS = new Set([
  'A', 'AN', 'AND', 'ARE', 'AS', 'AT', 'AFTER', 'BEFORE', 'BUT', 'BY',
  'COULD', 'DID', 'DO', 'DOES', 'FOR', 'FROM', 'HAS', 'HAVE', 'HOW',
  'IF', 'IN', 'INTO', 'IS', 'IT', 'ITS', 'MAY', 'MIGHT', 'OF', 'ON',
  'ONTO', 'OR', 'OUT', 'OVER', 'SHOULD', 'SO', 'THAT', 'THE', 'THEIR',
  'THERE', 'THESE', 'THIS', 'THOSE', 'TO', 'UNDER', 'UNTIL', 'UP',
  'WAS', 'WERE', 'WHAT', 'WHEN', 'WHERE', 'WHICH', 'WHILE', 'WHY',
  'WILL', 'WITH', 'WOULD', 'YOU', 'YOUR',
])

const TEMPLATE_CACHE = new Map()

// Normalize visual text for template/duplicate comparison: uppercase,
// punctuation stripped, whitespace collapsed. '?' and '!' are dropped, so
// "THE WORLD WAS AGAINST THEM?" and "THE WORLD WAS AGAINST THEM." compare
// equal — the anti-repetition rule treats them as the same narrative beat.
function normalizeVisualText(text) {
  const src = String(text || '')
  if (!src) return ''
  return src
    .toUpperCase()
    .replace(/["'“”‘’`]/g, '')
    .replace(/[^A-Z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

// True when the normalized text is (or starts with) a banned generic
// story-template phrase — the same semantic statement used across videos.
export function isGenericStoryTemplate(normalizedText) {
  const norm = normalizedText || ''
  if (!norm) return false
  if (TEMPLATE_CACHE.has(norm)) return TEMPLATE_CACHE.get(norm)
  let hit = false
  for (const tpl of GENERIC_STORY_TEMPLATES) {
    if (norm === tpl || norm.startsWith(tpl + ' ')) { hit = true; break }
  }
  TEMPLATE_CACHE.set(norm, hit)
  return hit
}

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
    this.repoContext = new RepoContextReader()
  }

  async plan(article, options = {}) {
    // This director produces 16:9 YouTube plans only.
    const targetFormat = 'youtube_video'
    this.lastAlgorithm = pickAlgorithm({ title: article.title || '', category: article.category })
    const messages = this.buildPrompt(article, targetFormat)
    let story = await this.queryLLM(messages, article)
    story = this.validate(story, article, targetFormat)
    // NARRATION-DEDUP: the LLM sometimes mirrors the description verbatim
    // into more than one scene; the downstream buildNarrationScript join then
    // repeats the line on the voice track. When a provider-fed plan carries
    // duplicate narration, ask the LLM once to fix it. If regeneration fails
    // or still duplicates, fall back to the deterministic template (unique
    // narration by construction) — never ship a repeated line.
    if (this.provider && !this._lastUsedFallback) {
      const dup = ScriptUniqueness.findDuplicateSegments((story.scenePlan || []).map(s => s.narration))
      if (!dup.pass) {
        const fixed = await this._regenerateDedup(messages, dup)
        if (fixed && Array.isArray(fixed.scenePlan) && fixed.scenePlan.length >= 2) {
          story = this.validate(fixed, article, targetFormat)
        } else {
          story = this.validate(this.fallbackPlan(article), article, targetFormat)
        }
      }
    }
    return story
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

Given a news article, produce a structured video production plan as JSON for a 16:9 YouTube video.

## STORY FORMULA — 16:9 YOUTUBE (NEWS-FIRST)
Create a concise cinematic news story for a 16:9 YouTube video.

THE ARTICLE IS THE SOURCE OF TRUTH. Every beat — narration, caption,
headline — must derive from the article's own facts (title, description,
provided text). Structure the story as NEWS, not fiction:

ACT 1 — HOOK / CONTEXT
Lead with the concrete event: what happened, to whom, and why the viewer
should care.

ACT 2 — DEVELOPMENT
Explain the important evidence: company, product, person, platform,
partnership, price, release, acquisition, launch, technical capability,
change, announcement, comparison, consequence.

ACT 3 — IMPACT / REVEAL
Explain the consequence, significance, or likely next development.

Do NOT invent:
- victims, heroes, tragedies, family situations, sacrifices, emotional
  events, outcomes, or facts not supported by the article
- emotional story archetypes (victim → struggle → courage → transformation)
  for technology and news articles

BANNED GENERIC STORY LANGUAGE — never use these phrases as narration or
captions; they recycle propaganda templates across unrelated stories and
must never become the visual narrative:
"Nobody expected this move", "It started like any day", "The world was
against them", "Every small win counted", "Every night they kept going",
"Then it happened", "The whole world started watching", "Now the whole
world is watching", "The power of never giving up", "Never give up".

Target duration: 30–40 seconds.

The final scene is ALWAYS the fixed NEWS-MONSTER brand outro.

## Hook Strategies (news-derived only; avoid "hidden/revealed/secret/shocking")
Pick one and fill it with the ACTUAL article entity + claim:
- "mystery": "The real story behind {entity} just broke"
- "shock": "Why {entity} just reshaped its market"
- "question": "What does {entity}'s move mean for you?"
- "stat": "One number explains {entity}'s latest move"

NEVER use the phrasing "Actually see", "See how", "See why", "See what",
"This is", "Here is", "Look at", "Check out" in narration, captions, or
emphasis keywords — those are dead patterns the channel has banned.

Algorithm slot: #${algo.number}/48 (pace/visual selector only — the slot's
internal archetype name is NOT story content; IGNORE its words and write
from the article only).
Anchor hook: derive the hook from the ARTICLE, never from a template:
"No one saw this coming" style phrasing is BANNED — open with the news:
"${(article.title || '').slice(0, 90)}"

## Scene Types
- hook: establish the story immediately
- fact: explain the important event
- reveal: present the key development
- explanation: explain why it matters
- reaction: communicate consequence/impact
- close: fixed NEWS-MONSTER brand outro

Each scene has:
1. visual media
2. optional center-stage caption
3. voice narration

The caption and narration are separate channels.

## NARRATION / CAPTION CONTRACT
\`narration\` is AUDIO ONLY.
It is sent to the voice/narration system and must NOT be treated as
visual text.

\`caption.fullText\` is the ONLY spoken-narrative text intended for
visual rendering.

\`caption.fullText\` MUST be a concise ARTICLE-DERIVED FACT (3-8 words):
an entity, claim, number, partnership, product, or consequence taken from
the Article. When your narration states an important fresh fact, turn THAT
fact into the caption in short visual language — never an invented summary
and never a generic story phrase.

Examples:
- narration: "Xbox is expanding its partnership with video game industry
  legend Hideo Kojima."  →  caption.fullText: "XBOX EXPANDS KOJIMA PARTNERSHIP"
- narration: "Would you switch out your MacBook for an iPad with an M4
  chip and OLED display?"  →  caption.fullText: "IPAD WITH M4 + OLED"
- narration: "Two AI researchers just left Anthropic over safety
  concerns."  →  caption.fullText: "ANTHROPIC EXITS SHOCK AI"

For 16:9:
- caption is CENTERED horizontally.
- caption is CENTERED vertically in the main video/media area.
- caption is NOT a lower-third.
- caption is NOT bottom aligned.
- caption is NOT placed immediately above the footer.
- caption should normally be 1–2 lines.
- 3 lines is the absolute maximum.
- caption should normally contain 3–8 words.
- never exceed 12 words.
- use concise visual language rather than reproducing the complete VO.
- never repeat the same caption text in two scenes.
- never use the banned generic story phrases listed above.

## 16:9 NARRATIVE TEXT PROGRESSION
The video uses ONE CENTER-STAGE narrative text position.

Narrative states occur sequentially:

STATE 1:
MAIN STORY / HEADLINE
center of video

THEN:

STATE 2:
SPOKEN SENTENCE / CAPTION
center of video

THEN:

STATE 3:
STAY WITH / NEWS-MONSTER
center of video

These are sequential states, NOT stacked text elements.

Do NOT generate instructions that place the caption at the bottom.

Do NOT generate multiple versions of the same caption.

Do NOT repeat the same sentence as both headline and caption unless
explicitly required by the story.

At any point in time there must be only one active narrative text
block in the center-stage area.

## 16:9 VISUAL COMPOSITION
Canvas: 1920x1080.

Narrative text uses the center of the video:
x = 50%
y = approximately 50%

The main visual remains visible behind the text.

Keep sufficient contrast between text and visual background.

The footer is independent and bottom anchored.

The narrative text must never be positioned in the footer area.

${this.repoContext.build()}

## Output Schema
{
  "headline": "short high-impact YouTube headline",
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
        "fullText": "short center-stage visual caption, preferably 3-8 words"
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
- Total duration: 30-40 seconds for the 16:9 YouTube video
- emotionalArc: 3-5 emotions that define the story's emotional journey
- Each scene must have a distinct purpose
- Each scene's narration must be UNIQUE — never repeat the same narration text across scenes
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
Algorithm slot: #${algo.number}/48
Visual style: ${algo.visual.prompt}
Target Format: youtube_video`
      }
    ]
  }

  async queryLLM(messages, article) {
    if (this.provider) {
      try {
        const raw = await this.provider.generate(messages, { json: true })
        // JSON-001: structured gate — fence-strip, parse, validate, retry once
        // with a correction request, THEN hand the validated plan to validate().
        const parsed = await parseStructured(raw, {
          schema: STORY_SCHEMA,
          attempts: 1,
          generate: async (prompt, opts) => {
            const retry = await this.provider.generate([{ role: 'user', content: prompt }], { json: true, ...opts })
            return retry
          },
          correct: (detail) => `Your previous JSON response was invalid. Fix these issues and return ONLY valid JSON: ${detail.errors ? detail.errors.join('; ') : detail.raw || 'invalid structure'}`,
        })
        this._lastUsedFallback = false
        return parsed
      } catch (e) { console.log('StoryDirector LLM error:', e.message) }
    }
    this._lastUsedFallback = true
    return this.fallbackPlan(article)
  }

  /**
   * One bounded LLM correction pass for a plan whose scene narrations repeat.
   * Bounded: initial plan (queryLLM) + this fix = 2 total LLM calls, matching
   * parseStructured's retry-once semantics. Returns null on any failure so
   * callers can fall back to the deterministic template.
   */
  async _regenerateDedup(messages, dup) {
    try {
      const fixPrompt = `Your previous scenePlan had duplicate narration across scenes:
${dup.duplicates.map(d => `  - scene ${d.a + 1} and scene ${d.b + 1} (similarity ${d.similarity.toFixed(2)})`).join('\n')}
Rewrite EVERY scene's narration so all narrations are UNIQUE (rephrase the repeats, keep each 1-2 sentences, keep the exact same JSON schema). Return ONLY valid JSON.`
      const raw = await this.provider.generate([...messages, { role: 'user', content: fixPrompt }], { json: true })
      return parseStructured(raw, {
        schema: STORY_SCHEMA,
        attempts: 0,
        generate: async (prompt, opts) => {
          const retry = await this.provider.generate([{ role: 'user', content: prompt }], { json: true, ...opts })
          return retry
        },
        correct: (detail) => `Your previous JSON response was invalid. Fix these issues and return ONLY valid JSON: ${detail.errors ? detail.errors.join('; ') : detail.raw || 'invalid structure'}`,
      })
    } catch (e) {
      console.log('StoryDirector dup-regenerate error:', e.message)
      return null
    }
  }

  fallbackPlan(article) {
    const title = article.title || 'Tech News'
    const algo = this.lastAlgorithm || pickAlgorithm({ title, category: article.category })
    // NEWS-FIRST deterministic plan: every beat derives from the article's own
    // facts (title + description sentences). No emotional archetype language
    // ("river save fish", "the world was against them") — the article is the
    // source of truth even when no LLM is available.
    const facts = this._newsFacts(article)
    const narrationLines = []
    for (const f of facts) {
      narrationLines.push(f)
      if (narrationLines.length >= 6) break
    }
    while (narrationLines.length < 6) {
      narrationLines.push(this._connectiveNewsLine(narrationLines.length, article))
    }
    const captions = facts.map((f) => StoryDirector.conciseNewsCaption(f))
    const cta = new TopicCtaBuilder().build(article)
    const headline = String(title).replace(/["'“”‘’]/g, '').trim().slice(0, 80) || 'BREAKING NEWS'
    const brandTag = (title.split(' ')[0] || 'TECH').replace(/[^A-Za-z0-9]/g, '').toUpperCase() || 'TECH'
    return {
      headline,
      hookStrategy: 'mystery',
      emotionalArc: ['curiosity', 'authority', 'shock', 'futureVision'],
      algorithm: algo,
      scenePlan: [
        // ACT 1 — HOOK / CONTEXT: the story's own headline, not a template.
        { type: 'hook', duration: 2.5, narration: narrationLines[0], visual: { subject: `${brandTag} newsroom broadcast`, style: algo.visual.prompt, composition: 'close_up' }, camera: 'push_in', motion: 'cinematicReveal', transition: 'glitch', emotion: 'shock', caption: { focus: 'NEWS', fullText: StoryDirector.conciseNewsCaption(facts[0] || title) } },
        // ACT 2 — DEVELOPMENT: article facts.
        { type: 'fact', duration: 5.5, narration: narrationLines[1], visual: { subject: `${brandTag} breaking coverage`, style: 'documentary photojournalism, newsroom studio', composition: 'wide' }, camera: 'slow_zoom', motion: 'depthBlur', transition: 'flash', emotion: 'tension', caption: { focus: 'FACT', fullText: captions[1] || '' } },
        { type: 'explanation', duration: 5, narration: narrationLines[2], visual: { subject: `analysis desk, ${brandTag} charts`, style: algo.visual.prompt, composition: 'medium' }, camera: 'orbit', motion: null, transition: 'zoom_blur', emotion: 'curiosity', caption: { focus: 'WHY', fullText: captions[2] || '' } },
        { type: 'reaction', duration: 5, narration: narrationLines[3], visual: { subject: `industry reaction, ${brandTag} headlines`, style: 'documentary', composition: 'medium' }, camera: 'parallax', motion: 'depthBlur', transition: 'light_leak', emotion: 'curiosity', caption: { focus: 'IMPACT', fullText: captions[3] || '' } },
        // ACT 3 — IMPACT / REVEAL: the consequence + next development.
        { type: 'reveal', duration: 4.5, narration: narrationLines[4], visual: { subject: `${brandTag} launch event, stage lights`, style: 'golden hour, news event', composition: 'wide' }, camera: 'shake', motion: 'particleField', transition: 'glitch', emotion: 'excitement', caption: { focus: 'NEXT', fullText: captions[4] || '' } },
        { type: 'reaction', duration: 2.5, narration: narrationLines[5], visual: { subject: `futuristic broadcast data, ${brandTag}`, style: 'glowing data streams', composition: 'wide' }, camera: 'pan', motion: 'digitalHUD', transition: 'cut', emotion: 'excitement', caption: { focus: 'AFTER', fullText: captions[5] || '' } },
        { type: 'close', duration: 3, narration: cta.narration, visual: { subject: 'NEWS-MONSTER brand', style: 'red and cyan futuristic', composition: 'medium' }, camera: 'pull_back', motion: null, transition: 'fade', emotion: 'excitement', caption: { focus: 'STAY_WITH', fullText: cta.caption } },
      ],
      brandMoment: { type: 'cta', sceneIndex: 6 },
      cta: cta.cta,
      engagement: cta.engagement,
    }
  }

  // Article facts: title/headline first, then description sentences — the
  // same corpus the LLM is prompted with, deduplicated and ordered by
  // importance. This is the deterministic source of news-first narration +
  // captions when no LLM plan is available.
  _newsFacts(article) {
    const seen = new Set()
    const facts = []
    const push = (s) => {
      const clean = String(s || '')
        .replace(/["'“”‘’]/g, '')
        .replace(/\s+/g, ' ')
        .trim()
      if (!clean || clean.length < 12) return
      const key = clean.toLowerCase()
      if (seen.has(key)) return
      seen.add(key)
      facts.push(clean)
    }
    push(article.title)
    push(article.headline)
    for (const s of String(article.description || '').split(/[.!?]+/)) {
      const clean = String(s || '').replace(/["'“”‘’]/g, '').replace(/\s+/g, ' ').trim()
      if (!clean || clean.length < 12) continue
      // Reject near-duplicate sentences (title vs lead are often 0.8+ similar,
      // e.g. "Two more AI researchers leave Anthropic" vs "Two AI researchers
      // are leaving Anthropic"). Emitting both would trip the within-video
      // narration gate; the lead adds nothing the title does not already say.
      // Bar sits below the gate's 0.85 so kept facts have headroom.
      if (facts.some(f => ScriptUniqueness._segmentSimilarity(f, clean) >= 0.8)) continue
      push(clean)
    }
    return facts
  }

  // Neutral news-toned connective lines — used ONLY to keep the deterministic
  // plan full-length when the article has few facts. Never emotional
  // archetypes, never banned template language; each line is distinct.
  _connectiveNewsLine(idx, article) {
    const brandTag = String(article.title || 'TECH').split(' ')[0].replace(/[^A-Za-z0-9]/g, '') || 'the story'
    const source = article.source || 'the report'
    const lines = [
      `Details from ${source} continue to emerge.`,
      `Analysts are watching how ${brandTag} responds.`,
      `The announcement marks a major shift for ${brandTag}.`,
      `More coverage of ${brandTag} is expected soon.`,
    ]
    return lines[idx % lines.length]
  }

  // Deterministic concise visual caption from an article fact: entity-first,
  // uppercase, ≤ maxWords, punctuation-free. Used to guarantee that important
  // article facts always have an on-screen representation even when the LLM
  // caption is missing, duplicated, or a generic story template.
  static conciseNewsCaption(fact, maxWords = 7) {
    const clean = String(fact || '').trim().replace(/\s+/g, ' ')
    if (!clean) return ''
    const words = clean.split(' ')
    // Prefer the first proper-noun entity window (product/company/person),
    // but a capitalized sentence opener is kept too — it is the subject.
    let start = 0
    if (!(words.length > 1 && /^[A-Z][a-z]/.test(words[0]))) {
      const entityIdx = words.findIndex((w, i) => i > 0 && /^[A-Z][a-z]/.test(w) && !CAPTION_OPENERS.has(w.toUpperCase()))
      if (entityIdx >= 0) start = entityIdx
    }
    let cap = words.slice(start, start + Math.max(2, maxWords)).join(' ')
    if (!cap) cap = words.slice(0, maxWords).join(' ')
    return cap
      .toUpperCase()
      .replace(/["'“”‘’]/g, '')
      .replace(/[.,;:!?]+$/g, '')
  }

  // First unused, non-generic, non-duplicate article caption from the pool.
  _nextNewsCaption(facts, usedNorms) {
    for (const f of facts) {
      const cap = StoryDirector.conciseNewsCaption(f, 8)
      const norm = normalizeVisualText(cap)
      if (!norm || usedNorms.has(norm) || isGenericStoryTemplate(norm)) continue
      usedNorms.add(norm)
      return cap
    }
    return ''
  }

  // First unused article sentence, for replacing banned-template narration.
  _nextNewsNarration(facts, usedNorms) {
    for (const f of facts) {
      const norm = normalizeVisualText(f)
      if (!norm || usedNorms.has(norm)) continue
      usedNorms.add(norm)
      return f
    }
    return ''
  }

  // Short center-stage visual caption: first sentence, 3-8 words preferred,
  // hard-capped at 12. narration stays VO-only.
  shortFullText(narration) {
    const first = String(narration || '').split(/[.!?]+/)[0].trim()
    const words = first.split(/\s+/).filter(Boolean)
    if (words.length <= 12) return first.toUpperCase()
    return words.slice(0, 12).join(' ').toUpperCase() + '…'
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
      // narration is VO only; caption.fullText is the only visual narration
      // text (short, center-stage). Never dump the full VO sentence onto the
      // screen — that stacking is what overlapped in published 16:9 videos.
      if (!s.caption || typeof s.caption !== 'object') {
        s.caption = { focus: 'NEWS', fullText: '' }
      }
      s.caption.focus = typeof s.caption.focus === 'string' ? s.caption.focus.trim().slice(0, 30) : 'NEWS'
      s.caption.fullText = typeof s.caption.fullText === 'string' ? s.caption.fullText.trim() : ''
    })

    // NEWS-FIRST caption normalization (this is the content-selection fix):
    // - empty captions are filled from ARTICLE FACTS, never from narration
    //   (a caption copied from the VO is what made generic narration become
    //   on-screen text),
    // - generic story-template captions are replaced by article facts,
    // - exact duplicate captions (normalized, punctuation-insensitive) are
    //   rejected — "THE WORLD WAS AGAINST THEM?" and "THE WORLD WAS AGAINST
    //   THEM." are the same beat and must not be emitted twice.
    // The close scene is exempt: applyBrandOutro replaces it with the fixed
    // brand end card afterwards.
    const facts = this._newsFacts(article)
    const usedCaptionNorms = new Set()
    for (const s of story.scenePlan) {
      if (s.type === 'close') continue
      const norm = normalizeVisualText(s.caption.fullText)
      if (!norm || isGenericStoryTemplate(norm) || usedCaptionNorms.has(norm)) {
        s.caption.fullText = this._nextNewsCaption(facts, usedCaptionNorms)
      } else {
        usedCaptionNorms.add(norm)
      }
    }

    // Banned generic story-template NARRATION is replaced with the article's
    // own sentences (e.g. "Nobody expected this move from death" → the article
    // lead). Narration remains VO-only; this only stops the recycled template
    // from being SPOKEN for unrelated stories. The narration-dedup gate below
    // still guarantees uniqueness across the final scenePlan.
    const usedNarrationNorms = new Set()
    for (const s of story.scenePlan) {
      if (s.type === 'close') continue
      const nNorm = normalizeVisualText(s.narration)
      if (nNorm && isGenericStoryTemplate(nNorm)) {
        const replacement = this._nextNewsNarration(facts, usedNarrationNorms)
        if (replacement) s.narration = replacement
      }
    }
    story.algorithm = story.algorithm || this.lastAlgorithm || pickAlgorithm({ title: article.title || '', category: article.category })
    const total = story.scenePlan.reduce((sum, s) => sum + s.duration, 0)
    if (total < 15 || total > 60) {
      console.log(`StoryDirector: total duration ${total}s out of range, falling back`)
      return this.applyBrandOutro(this.fallbackPlan(article))
    }
    return this.applyBrandOutro(story, article)
  }
}