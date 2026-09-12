import { fetchWithTimeout } from '../util/fetchWithTimeout.mjs'

const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions'
const MODEL = process.env.MOOD_ANALYZER_MODEL || 'anthropic/claude-3.5-sonnet'

const MOOD_SCHEMA = {
  type: 'object',
  properties: {
    mood: { type: 'string', enum: ['curious', 'urgent', 'emotional', 'triumphant', 'tense', 'nostalgic', 'neutral'] },
    energy: { type: 'number', minimum: 0, maximum: 1 },
    emotion: { type: 'string' },
    tempo: { type: 'string', enum: ['slow', 'medium', 'fast'] },
    bpm_hint: { type: 'integer', minimum: 60, maximum: 160 },
    instruments: {
      type: 'array',
      items: { type: 'string' },
      minItems: 2,
      maxItems: 6
    },
    category: { type: 'string', enum: ['tech_reveal', 'emotional_story', 'shorts_intro', 'luxury_future', 'breaking_news', 'general'] }
  },
  required: ['mood', 'energy', 'emotion', 'tempo', 'bpm_hint', 'instruments', 'category'],
  additionalProperties: false
}

const SYSTEM_PROMPT = `You are a music-direction assistant for an automated news-video pipeline (NEWS-MONSTER).
Given a scene's script text and its story category, output ONLY a JSON object matching the schema.
Do not reference any real song, artist, or copyrighted work. Describe mood/energy/instrumentation abstractly.
Never output prose, only the JSON object.`

/**
 * @param {{ sceneText: string, storyCategory: string }} input
 * @returns {Promise<object>} validated mood JSON
 */
export async function analyzeMood({ sceneText, storyCategory }) {
  const body = {
    model: MODEL,
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: `Story category: ${storyCategory}\nScene text: """${sceneText}"""` }
    ],
    response_format: {
      type: 'json_schema',
      json_schema: { name: 'mood_analysis', strict: true, schema: MOOD_SCHEMA }
    },
    temperature: 0.4
  }

  const res = await fetchWithTimeout(OPENROUTER_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`
    },
    body: JSON.stringify(body)
  }, 30_000)

  if (!res.ok) {
    throw new Error(`[MoodAnalyzer] OpenRouter error ${res.status}: ${await res.text()}`)
  }

  const data = await res.json()
  const raw = data.choices?.[0]?.message?.content
  if (!raw) throw new Error('[MoodAnalyzer] empty response from model')

  const parsed = JSON.parse(raw)
  return parsed
}