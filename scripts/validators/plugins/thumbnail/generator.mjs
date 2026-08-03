import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { buildPrompt, computeCacheKey } from './prompts.js'
import { metadata, GENERATION_ENDPOINT } from './manifest.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '../../../..')
const CACHE_DIR = path.join(ROOT, 'cache', 'thumbnails')

function ensureCacheDir() {
  if (!fs.existsSync(CACHE_DIR)) {
    fs.mkdirSync(CACHE_DIR, { recursive: true })
  }
}

function cachePath(hash) {
  return path.join(CACHE_DIR, `${hash}.png`)
}

function sha256(input) {
  return crypto.createHash('sha256').update(input).digest('hex').slice(0, 16)
}

function falHeaders() {
  const key = process.env.FAL_KEY
  if (!key) return null
  return {
    'Authorization': `Key ${key}`,
    'Content-Type': 'application/json',
  }
}

export async function generateThumbnail(story, options = {}) {
  const platform = options.platform || 'youtube'
  const style = options.style || 'cinematic'
  const width = options.width || 1280
  const height = options.height || 720

  const cacheInput = computeCacheKey(story, platform, style)
  const hash = sha256(cacheInput)
  const cached = cachePath(hash)

  ensureCacheDir()

  if (fs.existsSync(cached)) {
    return { path: cached, hash, cached: true }
  }

  const prompt = buildPrompt(story, platform, style)
  const headers = falHeaders()
  if (!headers) {
    const fallback = await generateFallbackThumbnail(story, width, height, cached)
    return { path: fallback, hash, cached: false, note: 'FAL_KEY not set, used fallback' }
  }

  try {
    const response = await fetch(`https://fal.run/${GENERATION_ENDPOINT}`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        prompt,
        image_size: { width, height },
        num_images: 1,
        guidance_scale: 7.5,
        num_inference_steps: 30,
      }),
    })

    if (!response.ok) {
      const errText = await response.text()
      console.error(`[thumbnail] fal.ai API error (${response.status}): ${errText}`)
      const fallback = await generateFallbackThumbnail(story, width, height, cached)
      return { path: fallback, hash, cached: false, note: `API error ${response.status}, used fallback` }
    }

    const data = await response.json()
    const imageUrl = data.images?.[0]?.url || data.image?.url
    if (!imageUrl) {
      const fallback = await generateFallbackThumbnail(story, width, height, cached)
      return { path: fallback, hash, cached: false, note: 'No image in response, used fallback' }
    }

    const imgResp = await fetch(imageUrl)
    if (!imgResp.ok) {
      const fallback = await generateFallbackThumbnail(story, width, height, cached)
      return { path: fallback, hash, cached: false, note: 'Failed to download image, used fallback' }
    }

    const buffer = Buffer.from(await imgResp.arrayBuffer())
    fs.writeFileSync(cached, buffer)

    return { path: cached, hash, cached: false }
  } catch (e) {
    console.error(`[thumbnail] Generation error: ${e.message}`)
    const fallback = await generateFallbackThumbnail(story, width, height, cached)
    return { path: fallback, hash, cached: false, note: e.message }
  }
}

export async function generateFallbackThumbnail(story, width, height, outputPath) {
  const title = (story.title || 'News Update').replace(/'/g, "'\\''")
  const category = (story.category || 'news').toUpperCase()

  const solidPath = outputPath || path.join(CACHE_DIR, `fallback_${Date.now()}.png`)

  try {
    const { execFileSync } = await import('node:child_process')
    execFileSync(
      'ffmpeg',
      ['-y', '-f', 'lavfi', '-i', `color=c=0x1a1a2e:s=${width}x${height}:d=0.5:r=1`, '-vf', `drawtext=text='${title}':fontcolor=white:fontsize=${Math.floor(width / 20)}:x=(w-text_w)/2:y=(h-text_h)/2-40:box=1:boxcolor=black@0.5:boxborderw=20,drawtext=text='${category}':fontcolor=#FFD700:fontsize=${Math.floor(width / 40)}:x=(w-text_w)/2:y=(h-text_h)/2+40:box=1:boxcolor=black@0.3:boxborderw=10`, '-frames:v', '1', solidPath],
      { stdio: 'pipe', timeout: 15000 }
    )
  } catch (e) {
    console.error(`[thumbnail] Fallback generation failed: ${e.message}`)
    const { createCanvas } = await import('canvas').catch(() => null)
    if (createCanvas) {
      const canvas = createCanvas(width, height)
      const ctx = canvas.getContext('2d')
      ctx.fillStyle = '#1a1a2e'
      ctx.fillRect(0, 0, width, height)
      ctx.fillStyle = '#ffffff'
      ctx.font = `${Math.floor(width / 20)}px sans-serif`
      ctx.textAlign = 'center'
      ctx.fillText(story.title || 'News Update', width / 2, height / 2)
      const buffer = canvas.toBuffer('image/png')
      fs.writeFileSync(outputPath, buffer)
    }
  }

  return outputPath || solidPath
}

export async function generateMultiplePlatforms(story, platforms, style) {
  const results = {}
  for (const platform of platforms) {
    try {
      const result = await generateThumbnail(story, { platform, style })
      results[platform] = result
    } catch (e) {
      results[platform] = { error: e.message }
    }
  }
  return results
}

export function getCachedHash(story, platform, style) {
  const cacheInput = computeCacheKey(story, platform, style)
  return sha256(cacheInput)
}

export function getCachedPath(hash) {
  const p = cachePath(hash)
  return fs.existsSync(p) ? p : null
}

export function clearCache() {
  ensureCacheDir()
  const files = fs.readdirSync(CACHE_DIR).filter(f => f.endsWith('.png'))
  for (const f of files) {
    fs.unlinkSync(path.join(CACHE_DIR, f))
  }
  return files.length
}
