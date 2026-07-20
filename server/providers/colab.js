export const name = 'Colab (Free T4 GPU)'
export const needsKey = true
export const freeCredits = 'Free Google Colab T4 GPU (limited hours)'

export async function generateVideo({ modelId, prompt, duration, aspectRatio }) {
  const url = process.env.COLAB_API_URL
  if (!url) {
    throw new Error(
      'COLAB_API_URL not set.\n' +
      'Run colab/wan_colab_api.ipynb in Google Colab with T4 GPU,\n' +
      'then paste the ngrok URL into .env as COLAB_API_URL.'
    )
  }

  const resp = await fetch(`${url}/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      prompt,
      num_frames: duration * 8,
      aspect_ratio: aspectRatio,
    }),
  })

  if (!resp.ok) {
    const err = await resp.text()
    throw new Error(`Colab error (${resp.status}): ${err}`)
  }

  return await resp.json()
}
