export const metadata = {
  name: 'thumbnail',
  version: '1.0.0',
  group: 'media',
  dependsOn: ['schema'],
  provides: ['thumbnailGenerator'],
  description: 'Generate AI-powered video cover images (thumbnails) for YouTube, TikTok, Facebook, X, and LinkedIn',
}

export const FALLBACK_ENDPOINT = 'fal-ai/fast-sdxl/image-to-image'
export const GENERATION_ENDPOINT = 'fal-ai/stable-diffusion-v3-medium'

export const CACHE_VERSION = 1
