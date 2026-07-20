export const name = 'Hugging Face (Free)'
export const needsKey = false
export const freeCredits = 'Free tier (rate-limited)'

export async function generateVideo({ modelId, prompt, duration, aspectRatio }) {
  throw new Error(
    'Hugging Face free Inference API does not support video generation.\n' +
    'Use one of these free options instead:\n' +
    '  - Google Colab (free T4 GPU): https://colab.research.google.com\n' +
    '  - Run Wan 2.2 locally: pip install diffusers transformers\n' +
    '  - Replicate free trial: https://replicate.com (signup = $5 free)'
  )
}
