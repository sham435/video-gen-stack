import { createCanvas, GlobalFonts } from '@napi-rs/canvas'
import { applyMotionEffect } from './MotionEngine.mjs'
import { Compositor } from './Compositor.mjs'
import { DesignSystem } from '../visuals/DesignSystem.mjs'
import { pickAlgorithm } from '../ai/StoryAlgorithmRegistry.mjs'
import fs from 'fs'

let fontsRegistered = false
function registerPipelineFonts() {
  if (fontsRegistered) return
  fontsRegistered = true
  try {
    if (fs.existsSync('assets/fonts/Montserrat-ExtraBold.ttf')) {
      GlobalFonts.registerFromPath('assets/fonts/Montserrat-ExtraBold.ttf', 'Montserrat ExtraBold')
    }
    if (fs.existsSync('assets/fonts/Anton-Regular.ttf')) {
      GlobalFonts.registerFromPath('assets/fonts/Anton-Regular.ttf', 'Anton')
    }
  } catch (e) {
    console.warn('[fonts] registration skipped:', e.message)
  }
}

// 3-act visual diversity: each scene gets a different Pexels photo + visual
// style from the algorithm so no two scenes share the same look.
const ACT_STYLE_OVERRIDES = {
  hook:       { mood: 'dramatic',   bias: 'dark dramatic breaking' },
  tragedy:    { mood: 'rainy',      bias: 'rain lonely dark sad' },
  courage:    { mood: 'determined', bias: 'hands working building hope' },
  win:        { mood: 'golden',     bias: 'golden hour celebration light' },
  reveal:     { mood: 'shock',      bias: 'explosive reveal dramatic' },
  explanation:{ mood: 'analytical', bias: 'documentary data analysis' },
  reaction:   { mood: 'impact',     bias: 'spotlight impact reaction' },
  fact:       { mood: 'serious',    bias: 'documentary evidence serious' },
  close:      { mood: 'brand',      bias: 'newsroom anchor desk brand' },
}

export class SceneEngine {
  constructor(config) {
    this.config = config
    this.compositor = new Compositor()
    this._heroCache = new Map()
    registerPipelineFonts()
  }

  // Resolve a per-scene hero image using the algorithm's Pexels seed + scene
  // type bias. Each scene gets a distinct photo so the video never feels like
  // a static image with subtitles.
  async resolveSceneHero(scene, article, algorithm) {
    const key = `${scene.type || 'fact'}_${scene.id || scene.narration?.slice(0, 30) || 'x'}`
    if (this._heroCache.has(key)) return this._heroCache.get(key)

    const actBias = ACT_STYLE_OVERRIDES[scene.type] || ACT_STYLE_OVERRIDES.fact
    const sceneSeed = (algorithm?.seed || 0) + (scene.id?.charCodeAt?.(scene.id.length - 1) || 0)
    const sceneIndex = scene.id ? parseInt(scene.id.replace(/\D/g, '') || '0', 10) : 0
    const pexelsQuery = `${actBias.bias} ${article?.category || 'news'}`

    const key2 = process.env.PEXELS_API_KEY
    if (!key2) return null

    try {
      const page = ((sceneSeed + sceneIndex * 7) % 10) + 1
      const res = await fetch(
        `https://api.pexels.com/v1/search?query=${encodeURIComponent(pexelsQuery)}&per_page=15&page=${page}&orientation=portrait`,
        { headers: { Authorization: key2 }, signal: AbortSignal.timeout(5000) }
      )
      if (!res.ok) return null
      const data = await res.json()
      const photos = data.photos || []
      if (!photos.length) return null
      // Slot-shuffle: different scene types get different index offsets
      const offsetMap = { hook: 0, tragedy: 3, courage: 6, win: 9, reveal: 2, explanation: 5, reaction: 8, fact: 1, close: 4 }
      const offset = offsetMap[scene.type] || 0
      const idx = (offset + sceneIndex) % photos.length
      const url = photos[idx]?.src?.large2x || photos[idx]?.src?.large || null
      if (url) this._heroCache.set(key, url)
      return url
    } catch {
      return null
    }
  }

  async renderSceneFrame(scene, progress, wordTimings, wordIndex, renderManifest = null) {
    const canvas = createCanvas(DesignSystem.W, DesignSystem.H)
    const ctx = canvas.getContext('2d')

    applyMotionEffect(ctx, 'camera_shake', progress)

    const category = scene.category || this.config.category || 'technology'

    // 3-act diversity: attach a per-scene visual override from the algorithm
    // so each act feels visually distinct (dark→building→golden)
    const actStyle = ACT_STYLE_OVERRIDES[scene.type] || null
    const enrichedScene = actStyle ? { ...scene, visualBias: actStyle, mood: actStyle.mood } : scene

    await this.compositor.compose(ctx, enrichedScene, progress, wordIndex, category, renderManifest)

    return canvas.toBuffer('image/png')
  }
}