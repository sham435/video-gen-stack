const FAL_API_BASE = 'https://fal.run'

function getKey() {
  const key = process.env.FAL_KEY
  if (!key) throw new Error('FAL_KEY not set in environment')
  return key
}

export async function getModelInfo(modelId) {
  const { getModel } = await import('./models.js')
  const model = getModel(modelId)
  if (!model) throw new Error(`Unknown model: ${modelId}`)
  return {
    model: model.id,
    name: model.name,
    provider: model.provider,
    capabilities: model.capabilities,
    openSource: model.openSource,
    speed: model.speed,
    quality: model.quality,
  }
}

export async function generateVideo({ modelId, prompt, duration = 5, aspectRatio = '16:9', imageUrl, numVideos = 1 }) {
  const { getEndpoint } = await import('./models.js')
  const endpoint = getEndpoint(modelId, 'fal.ai')
  if (!endpoint) throw new Error(`No fal.ai endpoint for model: ${modelId}`)

  const body = {
    prompt,
    num_frames: duration * 8,
    aspect_ratio: '16:9',
    num_images: numVideos,
  }

  if (imageUrl) {
    body.image_url = imageUrl
  }

  const response = await fetch(`${FAL_API_BASE}/${endpoint}`, {
    method: 'POST',
    headers: {
      'Authorization': `Key ${getKey()}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  })

  if (!response.ok) {
    const err = await response.text()
    throw new Error(`fal.ai API error (${response.status}): ${err}`)
  }

  const data = await response.json()

  return {
    videos: data.images || data.video || [data],
    requestId: data.request_id,
    status: 'completed',
  }
}

export async function getQueueStatus(requestId) {
  const response = await fetch(`${FAL_API_BASE}/requests/${requestId}/status`, {
    headers: {
      'Authorization': `Key ${getKey()}`,
    },
  })
  if (!response.ok) throw new Error(`Status check failed: ${response.status}`)
  return response.json()
}
