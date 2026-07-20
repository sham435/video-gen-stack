export const name = 'Google Gemini (Free)'
export const needsKey = true
export const freeCredits = 'Free tier at aistudio.google.com (60 req/min, no CC needed)'

const URL = 'https://generativelanguage.googleapis.com/v1beta/models'

async function getKey() {
  const key = process.env.GEMINI_API_KEY
  if (!key) {
    throw new Error(
      'GEMINI_API_KEY not set.\n' +
      'Get a FREE key (no credit card) at:\n' +
      '  https://aistudio.google.com/apikey'
    )
  }
  return key
}

export async function generateVideo({ modelId, prompt, duration, aspectRatio }) {
  const key = await getKey()
  const shortRatio = aspectRatio === '9:16' ? '9:16' : '16:9'

  // Gemini generates an optimized video prompt (text output)
  const body = {
    contents: [{
      role: 'user',
      parts: [{ text: prompt }],
    }],
    generationConfig: { temperature: 0.7, maxOutputTokens: 4096 },
    systemInstruction: {
      parts: [{
        text: `You are a video prompt engineer. Generate a single optimized prompt for AI video generation. ` +
              `Duration: ${duration}s. Aspect ratio: ${shortRatio}. ` +
              `Include scene description, camera movement, lighting, style (Apple keynote), timing. ` +
              `Output ONLY the prompt text, no explanations.`,
      }],
    },
  }

  const resp = await fetch(`${URL}/gemini-2.0-flash:generateContent?key=${key}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })

  if (!resp.ok) {
    const err = await resp.text()
    if (resp.status === 429) throw new Error('Gemini: Rate limited. Try again in a minute.')
    if (resp.status === 403) throw new Error('Gemini: Invalid key. Get a free key at https://aistudio.google.com/apikey')
    throw new Error(`Gemini error (${resp.status}): ${err}`)
  }

  const data = await resp.json()
  const optimizedPrompt = data.candidates?.[0]?.content?.parts?.[0]?.text || prompt

  // Gemini free API can't generate video directly.
  // Return the optimized prompt for use with Colab/Wan
  throw new Error(
    `🎬 OPTIMIZED PROMPT READY (${data.usageMetadata?.candidatesTokenCount || 0} tokens)\n` +
    `──────────────────────────────────\n` +
    `${optimizedPrompt}\n` +
    `──────────────────────────────────\n` +
    `💡 Gemini free tier can't render video. Run this prompt through:\n` +
    `   • Colab (free T4 GPU): Run colab/wan_colab_api.ipynb\n` +
    `   • Or use the paid providers (fal.ai / Replicate)`
  )
}
