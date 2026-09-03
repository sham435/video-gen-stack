// CreativeDirectorAgent — per-scene creative brief generator.
//
// Runs ONCE per script, after StoryDirector.plan() and before
// ScenePlanner.planScenes(). The LLM receives the full script context
// (headline, emotional arc, scene types + narration) and outputs a
// structured creative brief for every scene — mood, visual direction,
// BGM cue, and text emphasis words — that the existing ImageRanker,
// MusicFamily, and InformationLayer consume as RANKING WEIGHTS / SOURCES,
// never as replacements.
//
// The provider chain is StoryDirector's same LLMProviderChain (OpenRouter
// primary → fallback). On ANY failure the agent returns a neutral/empty
// brief and the pipeline runs unchanged — this layer adds judgment, not
// a hard dependency.

import { parseStructured } from './parseStructured.mjs'
import { resolveMusicFamily, FAMILY_KEYS } from '../audio/MusicFamily.mjs'

// ── Schema ────────────────────────────────────────────────────────────────────

const SCENE_BRIEF_SCHEMA = {
  sceneId: 'number',
  mood: 'string',
  imageDirection: 'string',
  bgmCue: { genre: 'string', energy: 'number', family: 'string' },
  textHook: { style: 'string', emphasisWords: 'array' },
}

const BRIEF_SCHEMA = {
  scenes: 'array',
  overallMood: 'string',
}

const MOODS = ['urgent', 'triumphant', 'ominous', 'playful', 'reflective', 'curious', 'neutral']

// Map agent moods to the existing emotion system used by emotionColors(),
// emotionalArc, and visualIntent. The agent may produce a richer mood
// palette than the 6-value StoryDirector emotion — we canonicalize here.
const MOOD_TO_EMOTION = {
  urgent: 'shock',
  triumphant: 'excitement',
  ominous: 'tension',
  playful: 'excitement',
  reflective: 'curiosity',
  curious: 'curiosity',
  neutral: 'neutral',
}

// Map agent moods to music families. These are the 4 families in
// assets/music/ — the brief's bgmCue.family is a soft preference; if
// absent or unrecognized, MusicFamily.resolveMusicFamily() handles it.
const MOOD_TO_FAMILY = {
  urgent: 'action-energy',
  triumphant: 'luxury-future',
  ominous: 'action-energy',
  playful: 'cinematic-tech-reveal',
  reflective: 'emotional-story',
  curious: 'cinematic-tech-reveal',
  neutral: null, // let article-based resolution decide
}

// ── Agent ─────────────────────────────────────────────────────────────────────

export class CreativeDirectorAgent {
  constructor(provider) {
    this.provider = provider
  }

  /**
   * Generate a creative brief for every scene in the script.
   *
   * @param {{title:string, description:string, category:string, source:string}} article
   * @param {{headline:string, emotionalArc:string[], scenePlan:Array}} directorStory
   * @returns {{scenes:Array<{sceneId:number, mood:string, imageDirection:string, bgmCue:{genre:string,energy:number,family:string}, textHook:{style:string,emphasisWords:string[]}}>, overallMood:string}|null}
   *   Null on total failure — caller must run pipeline unchanged.
   */
  async plan(article, directorStory) {
    if (!this.provider) return this._fallback(directorStory)

    try {
      const messages = this._buildPrompt(article, directorStory)
      const raw = await this.provider.generate(messages, { json: true })

      const brief = await parseStructured(raw, {
        schema: BRIEF_SCHEMA,
        attempts: 1,
        generate: async (prompt) => {
          return this.provider.generate([{ role: 'user', content: prompt }], { json: true })
        },
        correct: (detail) =>
          `Your creative brief had JSON errors. Fix these and return ONLY valid JSON: ${detail.errors ? detail.errors.join('; ') : detail.raw || 'invalid structure'}`,
      })

      return this._validate(brief, directorStory)
    } catch (e) {
      console.warn('[CreativeDirector] LLM brief failed, running neutral fallback:', e.message)
      return this._fallback(directorStory)
    }
  }

  // ── Prompt ────────────────────────────────────────────────────────────────

  _buildPrompt(article, story) {
    const sceneSummaries = (story.scenePlan || [])
      .map((s, i) => {
        const words = (s.narration || '').split(/\s+/).length
        return `Scene ${i + 1} [${s.type}] ${s.duration}s (~${words} words): "${(s.narration || '').slice(0, 120)}" — emotion=${s.emotion || 'neutral'}, visual=${s.visual?.subject || 'none'}`
      })
      .join('\n')

    return [
      {
        role: 'system',
        content: `You are the Creative Director for NEWS-MONSTER, a premium vertical video news platform (1080x1920, 10fps canvas → 30fps output).

Your job: for each scene in a news script, decide the creative direction — what mood the moment needs, what kind of imagery would hold attention, what background music energy fits, and which words on screen should POP with the word-stagger emphasis animation.

You make JUDGMENT CALLS, not lookups. Think like a real film editor watching the narration and picking the right shot + music cue for each beat.

RULES:
- Output ONLY valid JSON. No markdown, no commentary.
- One brief object per scene (same sceneId + order as the input scenes).
- mood: one of "urgent", "triumphant", "ominous", "playful", "reflective", "curious", "neutral".
- imageDirection: a short descriptive phrase for what TYPE of imagery fits (e.g. "close-up product shot", "wide establishing shot", "reaction face", "aerial drone", "data visualization", "split-screen comparison"). Be specific to the scene's narration.
- bgmCue.family: one of ${JSON.stringify(FAMILY_KEYS)} — the BGM family that best matches the mood.
- bgmCue.energy: 0.0 (calm) to 1.0 (peak intensity). Controls BPM bias within the family.
- bgmCue.genre: a short descriptive genre label (e.g. "cinematic tension", "warm lo-fi", "dark drone").
- textHook.emphasisWords: 1-3 words from the scene's narration that should get the STAGGER emphasis (large accent-colored word animation). Pick words that create curiosity or emotional punch. Never pick the first word or a proper noun. If no word fits, return an empty array.
- textHook.style: one of "shock-stat", "rhetorical-question", "direct-address", "highlight-keyword", "contrast-frame".
- overallMood: the dominant mood across all scenes.
- The emotional arc should progress naturally (e.g. curious → tension → reveal → excitement → reflect).

Return ONLY valid JSON matching this structure:
{
  "overallMood": "curious",
  "scenes": [
    {
      "sceneId": 1,
      "mood": "curious",
      "imageDirection": "wide establishing cityscape at dusk",
      "bgmCue": { "family": "cinematic-tech-reveal", "energy": 0.6, "genre": "ambient curiosity" },
      "textHook": { "style": "rhetorical-question", "emphasisWords": ["SECRETLY"] }
    }
  ]
}`,
      },
      {
        role: 'user',
        content: `ARTICLE:
Title: ${article.title || 'Tech News'}
Source: ${article.source || 'News'}
Category: ${article.category || 'technology'}
Description: ${(article.description || article.title || '').slice(0, 500)}

SCRIPT (${story.scenePlan.length} scenes):
${sceneSummaries}

EMOTIONAL ARC: ${(story.emotionalArc || []).join(' → ')}

Generate the creative brief for every scene. Keep the mood arc natural — start curious/urgent (hook), build tension, peak at the reveal, then reflect.`,
      },
    ]
  }

  // ── Validation ─────────────────────────────────────────────────────────────

  _validate(brief, story) {
    if (!brief || !Array.isArray(brief.scenes) || brief.scenes.length === 0) {
      return this._fallback(story)
    }

    const sceneCount = (story.scenePlan || []).length
    const validated = []

    for (let i = 0; i < sceneCount; i++) {
      const incoming = brief.scenes.find(s => s.sceneId === i + 1) || brief.scenes[i]
      if (!incoming) {
        validated.push(this._neutralBrief(i + 1))
        continue
      }

      validated.push({
        sceneId: i + 1,
        mood: MOODS.includes(incoming.mood) ? incoming.mood : 'neutral',
        imageDirection: typeof incoming.imageDirection === 'string' ? incoming.imageDirection.slice(0, 120) : '',
        bgmCue: {
          family: FAMILY_KEYS.includes(incoming.bgmCue?.family) ? incoming.bgmCue.family : null,
          energy: Math.max(0, Math.min(1, Number(incoming.bgmCue?.energy) || 0.5)),
          genre: typeof incoming.bgmCue?.genre === 'string' ? incoming.bgmCue.genre.slice(0, 60) : '',
        },
        textHook: {
          style: incoming.textHook?.style || 'highlight-keyword',
          emphasisWords: Array.isArray(incoming.textHook?.emphasisWords)
            ? incoming.textHook.emphasisWords.filter(w => typeof w === 'string' && w.length > 1).slice(0, 3)
            : [],
        },
      })
    }

    return {
      scenes: validated,
      overallMood: typeof brief.overallMood === 'string' ? brief.overallMood : 'neutral',
    }
  }

  _neutralBrief(sceneId) {
    return {
      sceneId,
      mood: 'neutral',
      imageDirection: '',
      bgmCue: { family: null, energy: 0.5, genre: '' },
      textHook: { style: 'highlight-keyword', emphasisWords: [] },
    }
  }

  _fallback(story) {
    const sceneCount = (story?.scenePlan || []).length || 3
    return {
      scenes: Array.from({ length: sceneCount }, (_, i) => this._neutralBrief(i + 1)),
      overallMood: 'neutral',
    }
  }
}

// ── Helpers exported for tests ─────────────────────────────────────────────────

export { MOOD_TO_EMOTION, MOOD_TO_FAMILY, MOODS }
