export const name = 'Replicate'
export const needsKey = true
export const freeCredits = '$5 free on signup (~100 videos)'

function getKey() {
  const key = process.env.REPLICATE_API_TOKEN
  if (!key) throw new Error('REPLICATE_API_TOKEN not set. Get one at https://replicate.com/account')
  return key
}

const MODELS = {
  'wan/v2.2': 'lucataco/wan-v2.2:latest',
  'kling/v3': 'nightlystreet/kling-v3:latest',
  'pixverse/v6': 'pixverse/pixverse-v6:latest',
}

export async function generateVideo({ modelId, prompt, duration, aspectRatio }) {
  const replicateModel = MODELS[modelId]
  if (!replicateModel) throw new Error(`Replicate: ${modelId} not available`)

  const response = await fetch('https://api.replicate.com/v1/predictions', {
    method: 'POST',
    headers: {
      'Authorization': `Token ${getKey()}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      version: replicateModel,
      input: {
        prompt,
        num_frames: duration * 8,
        aspect_ratio: aspectRatio,
      },
    }),
  })

  if (!response.ok) {
    const err = await response.text()
    throw new Error(`Replicate error (${response.status}): ${err}`)
  }

  const prediction = await response.json()

  // Poll until complete
  let result = prediction
  while (result.status !== 'succeeded' && result.status !== 'failed') {
    await new Promise(r => setTimeout(r, 2000))
    const pollRes = await fetch(result.urls?.get || `https://api.replicate.com/v1/predictions/${result.id}`, {
      headers: { 'Authorization': `Token ${getKey()}` },
    })
    result = await pollRes.json()
  }

  if (result.status === 'failed') {
    throw new Error(`Replicate: generation failed - ${result.error || 'unknown'}`)
  }

  return {
    videos: Array.isArray(result.output) ? result.output.map(u => ({ url: u })) : [{ url: result.output }],
    provider: 'replicate',
  }
}
