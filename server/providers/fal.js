export const name = 'fal.ai'
export const needsKey = true
export const freeCredits = 'Pay-as-you-go ($5 free on signup)'

const BASE = 'https://fal.run'

function getKey() {
  const key = process.env.FAL_KEY
  if (!key) throw new Error('FAL_KEY not set. Add it to .env')
  return key
}

export async function generateVideo({ endpoint, prompt, duration, aspectRatio, imageUrl }) {
  const body = {
    prompt,
    num_frames: duration * 8,
    aspect_ratio: aspectRatio === '9:16' ? '9:16' : '16:9',
    num_images: 1,
  }
  if (imageUrl) body.image_url = imageUrl

  const response = await fetch(`${BASE}/${endpoint}`, {
    method: 'POST',
    headers: {
      'Authorization': `Key ${getKey()}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  })

  if (!response.ok) {
    const err = await response.text()
    if (response.status === 403) {
      throw new Error('fal.ai: Account locked (exhausted balance). Top up at https://fal.ai/dashboard/billing')
    }
    throw new Error(`fal.ai error (${response.status}): ${err}`)
  }

  const data = await response.json()
  return {
    videos: data.images || data.video || [data],
    provider: 'fal.ai',
  }
}
