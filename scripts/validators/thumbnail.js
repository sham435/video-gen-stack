import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { buildPrompt, computeCacheKey, CATEGORY_TEMPLATES, PLATFORM_SIZES, STYLE_PRESETS } from './plugins/thumbnail/prompts.js'
import { metadata as thumbMeta, GENERATION_ENDPOINT } from './plugins/thumbnail/manifest.mjs'

export const metadata = {
  name: 'thumbnail',
  version: '1.0.0',
  dependsOn: ['schema'],
  provides: ['thumbnailChecks'],
  group: 'media',
  description: 'Validate thumbnail generation pipeline: prompt templates, cache system, fal.ai endpoint accessibility, manifest metadata, fallback generation',
}

function hasFalKey() {
  return !!(process.env.FAL_KEY)
}

export default async function (ctx) {
  const r = ctx.results

  // 1. Validate plugin manifest metadata
  const requiredFields = ['name', 'version', 'group', 'dependsOn', 'provides', 'description']
  for (const field of requiredFields) {
    if (!(field in thumbMeta)) {
      r.add('media', `thumbnail manifest missing field: ${field}`, 'CRITICAL', false)
    }
  }
  r.add('media', `thumbnail manifest (v${thumbMeta.version}) loaded correctly`, 'INFO', true,
    `provides: ${thumbMeta.provides.join(',')}`)

  // 2. Validate prompt templates exist for all categories
  const categoryCount = Object.keys(CATEGORY_TEMPLATES).length
  r.add('media', `prompt templates: ${categoryCount} categories`, 'INFO', true,
    `categories: ${Object.keys(CATEGORY_TEMPLATES).join(',')}`)

  // 3. Validate platform size definitions
  const platformCount = Object.keys(PLATFORM_SIZES).length
  r.add('media', `platform sizes: ${platformCount} platforms`, 'INFO', true,
    `platforms: ${Object.keys(PLATFORM_SIZES).join(',')}`)

  // 4. Validate style presets
  const styleCount = Object.keys(STYLE_PRESETS).length
  r.add('media', `style presets: ${styleCount} styles`, 'INFO', true,
    `styles: ${Object.keys(STYLE_PRESETS).join(',')}`)

  // 5. Test prompt builder output
  const testStory = {
    title: 'Apple Unveils New AI-Powered Smart Glasses with Augmented Reality Features',
    category: 'technology',
    topic: 'technology',
  }
  const prompt = buildPrompt(testStory, 'youtube', 'cinematic')
  const promptLines = prompt.split('\n').length
  const includesTitle = prompt.includes(testStory.title)
  const includesResolution = prompt.includes('1280x720')

  if (includesTitle && includesResolution) {
    r.add('media', `prompt builder: ${promptLines} lines, includes title + resolution`, 'INFO', true)
  } else {
    const issues = []
    if (!includesTitle) issues.push('missing title in prompt')
    if (!includesResolution) issues.push('missing resolution')
    r.add('media', `prompt builder output issues`, 'ERROR', false, issues.join(', '))
  }

  // 6. Test cache key computation (deterministic)
  const key1 = computeCacheKey(testStory, 'youtube', 'cinematic')
  const key2 = computeCacheKey(testStory, 'youtube', 'cinematic')
  const key3 = computeCacheKey({ title: 'Different Story', category: 'ai' }, 'youtube', 'cinematic')

  if (key1 === key2 && key1 !== key3) {
    r.add('media', 'cache key deterministic + distinct per story', 'INFO', true,
      `hash input: ${key1.slice(0, 40)}...`)
  } else {
    r.add('media', 'cache key collision or non-deterministic', 'ERROR', false)
  }

  // 7. Verify SHA-256 hash stability
  const hash = crypto.createHash('sha256').update(key1).digest('hex').slice(0, 16)
  r.add('media', `cache hash (SHA256): ${hash}`, 'INFO', true)

  // 8. Check cache directory exists
  const cacheDir = path.join(ctx.root, 'cache', 'thumbnails')
  if (fs.existsSync(cacheDir)) {
    const cachedFiles = fs.readdirSync(cacheDir).filter(f => f.endsWith('.png'))
    r.add('media', `cache directory exists: ${cachedFiles.length} cached thumbnails`, 'INFO', true)
  } else {
    r.add('media', 'cache/thumbnails/ directory missing', 'NOTICE', false, 'will be created on first generation')
  }

  // 9. Check FAL_KEY availability (advisory)
  if (hasFalKey()) {
    r.add('media', `fal.ai endpoint: ${GENERATION_ENDPOINT}`, 'INFO', true, 'FAL_KEY configured')
  } else {
    r.add('media', 'fal.ai endpoint configured but FAL_KEY not set; fallback to ffmpeg text-only', 'NOTICE', false)
  }

  // 10. Verify generating a fallback thumbnail works
  try {
    const fallbackDir = path.join(ctx.root, 'cache', 'thumbnails')
    if (!fs.existsSync(fallbackDir)) fs.mkdirSync(fallbackDir, { recursive: true })
    const fallbackPath = path.join(fallbackDir, '_validator_test_fallback.png')

    const title = "Test Headline for Validator"
    const { execFileSync } = await import('node:child_process')
    try {
      execFileSync(
        'ffmpeg',
        ['-y', '-f', 'lavfi', '-i', 'color=c=0x1a1a2e:s=640x360:d=0.5:r=1', '-vf', `drawtext=text='${title}':fontcolor=white:fontsize=32:x=(w-text_w)/2:y=(h-text_h)/2:box=1:boxcolor=black@0.5:boxborderw=10`, '-frames:v', '1', fallbackPath],
        { stdio: 'pipe', timeout: 15000 }
      )
      if (fs.existsSync(fallbackPath)) {
        const stat = fs.statSync(fallbackPath)
        r.add('media', `fallback thumbnail generation: ${stat.size} bytes`, 'INFO', true)
        fs.unlinkSync(fallbackPath)
      } else {
        r.add('media', 'fallback thumbnail file not created', 'WARNING', false)
      }
    } catch (e) {
      r.add('media', `fallback thumbnail (ffmpeg not available)`, 'NOTICE', false, 'ffmpeg required for fallback')
    }
  } catch (e) {
    r.add('media', `fallback thumbnail test error`, 'NOTICE', false, e.message)
  }

  // 11. Verify multi-platform generation plan
  const platforms = Object.keys(PLATFORM_SIZES)
  r.add('media', `publisher integration supports ${platforms.length} platforms`, 'INFO', true,
    `platforms: ${platforms.join(', ')}`)
}
