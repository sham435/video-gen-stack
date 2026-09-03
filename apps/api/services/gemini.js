const GEMINI_BASE = 'https://generativelanguage.googleapis.com/v1beta'

function getKey() {
  const key = process.env.GEMINI_API_KEY
  if (!key) throw new Error('GEMINI_API_KEY not set in environment')
  return key
}

export async function generateVideo({ endpoint, modelId, prompt, duration = 5, aspectRatio = '16:9', imageUrl }) {
  const body = {
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    generationConfig: {
      responseModalities: ['TEXT', 'IMAGE'],
      imageConfig: {
        aspectRatio: '16:9',
        quality: 'MEDIUM',
      },
    },
  }

  const model = endpoint || 'gemini-2.5-flash'
  const url = `${GEMINI_BASE}/models/${model}:generateContent`
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': getKey() },
    body: JSON.stringify(body),
  })

  if (!response.ok) {
    const err = await response.text()
    throw new Error(`Gemini ${response.status}: ${err.slice(0, 220)}`)
  }

  const data = await response.json()
  const image = data.candidates?.[0]?.content?.parts?.find(p => p.inlineData?.data)
  if (!image) {
    throw new Error('Gemini returned no image (free tier: image generation unavailable on this model)')
  }

  const mime = image.inlineData.mimeType || 'image/png'
  return {
    provider: 'gemini',
    model: modelId,
    freeTier: true,
    videos: [{
      url: `data:${mime};base64,${image.inlineData.data}`,
      contentType: mime,
      width: image.inlineData.width || 512,
      height: image.inlineData.height || 512,
      duration: 1,
    }],
    note: 'free-tier output: image frame (Veo video generation requires paid Gemini tier)',
  }
}
