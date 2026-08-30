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

const EMOJI_MAP = { tragedy: '\uD83D\uDE2D', courage: '\uD83D\uDCAA', win: '\u2728\uD83D\uDD25', hook: '\uD83D\uDEA8' }

const ARC_SCRIPTS = {
  RAIN_SHELTER_LOVE: {
    tragedy: (t) => `The system was broken. ${t.slice(0,50)}... left in rain, shivering, no hope \uD83D\uDE2D`,
    courage: (t) => `But courage. Built shelter from leaves and sticks, one review at a time, principle over politics \uD83D\uDCAA`,
    win: (t) => `Transformation. License approved. Family finds him under safe shelter. From blocked to breakthrough \u2764\u2728`,
  },
  HUNGER_SHARE_HERO: {
    tragedy: (t) => `Starving for access. Industry hungry, stealing scraps, banks said no \uD83D\uDE2D`,
    courage: (t) => `Instead of eating alone, shared half with birds. Regulator shared license path with whole industry \uD83D\uDCAA`,
    win: (t) => `Villagers saw kindness. Now fed every day. Hero moment. License opens doors \u2728\uD83D\uDD25`,
  },
  BULLY_STUDY_SUCCESS: {
    tragedy: (t) => `Bullied in school. Other monkeys laughed. Regulators laughed at crypto \uD83D\uDE2D`,
    courage: (t) => `Studied hard under streetlights. Reviewed 1000 pages, did the work others wouldn't \uD83D\uDCAA`,
    win: (t) => `Shocks everyone with success. First prize. License approved. From mocked to master \uD83C\uDF89\u2728`,
  },
  RIVER_SAVE_FISH: {
    tragedy: (t) => `Fell in river, nearly drowned. Market crashed, nearly died \uD83C\uDF0A\uD83D\uDE2D`,
    courage: (t) => `While drowning, still pushed small fish to safety. Saved customers while sinking \u2764\uD83D\uDCAA`,
    win: (t) => `Fisherman sees and rescues. Fish saves him back. Regulator saves industry, industry saves economy \uD83D\uDD25`,
  },
  BROKEN_FIX_INSPIRE: {
    tragedy: (t) => `His only toy broke. System broken, license impossible \uD83D\uDE2D`,
    courage: (t) => `Collected waste, fixed with creativity. Rewrote rules with innovation \uD83D\uDEE0\uD83D\uDCAA`,
    win: (t) => `Other kids love it, play together happily. Whole village inspired by new model \uD83C\uDF1F\u2728`,
  },
  LEFT_RUN_REUNION: {
    tragedy: (t) => `Bus left while eating outside. Left behind by banks, regulation left him \uD83D\uDE2D`,
    courage: (t) => `Runs miles with determination. Ran through red tape, miles of paperwork \uD83D\uDEB6\uD83D\uDCA8\uD83D\uDCAA`,
    win: (t) => `Finds mother waiting at bus stop. Emotional reunion. Crypto finds home in banking \u2764\u2728`,
  },
}

export function buildScenesForAlgorithm(article, algorithm) {
  const arc = ARC_SCRIPTS[algorithm.arc] || ARC_SCRIPTS.RAIN_SHELTER_LOVE
  const hookText = `Nobody expected this move - ${article.title}. ${EMOJI_MAP.hook}`

  const sceneDefs = algorithm.structure.order.map((type, idx) => {
    let text = ''
    if (type === 'hook') text = hookText
    else if (type === 'tragedy') text = arc.tragedy(article.title)
    else if (type === 'courage') text = arc.courage(article.title)
    else if (type === 'win') text = `${arc.win(article.title)} Source: ${article.source || 'Politico'} | NEWS-MONSTER`

    const visualVariant = idx % 2 === 0 ? algorithm.visual.prompt : `${algorithm.visual.prompt}, ${type} emotion ${EMOJI_MAP[type] || ''}`

    return {
      id: `scene-${idx}-${type}`,
      index: idx,
      type,
      text,
      emoji: EMOJI_MAP[type] || '',
      visualStyle: visualVariant,
      pexelsQuery: `${algorithm.visual.pexels} ${type}`,
      tone: algorithm.tone.voice,
      duration: type === 'hook' ? 3 : type === 'tragedy' ? 8 : type === 'courage' ? 10 : 7,
      caption: `${type.toUpperCase()} ${EMOJI_MAP[type] || ''}`,
      algorithmNumber: algorithm.number,
    }
  })

  const seen = new Set()
  sceneDefs.forEach(s => {
    let q = s.pexelsQuery
    let c = 0
    while (seen.has(q) && c < 10) { q = `${s.pexelsQuery} ${c}`; c++ }
    seen.add(q)
    s.pexelsQuery = q
  })

  return { algorithm, hook: hookText, scenes: sceneDefs, totalDuration: sceneDefs.reduce((sum, s) => sum + s.duration, 0), niche: algorithm.niche, storyTitle: `${algorithm.hook} - ${article.title}` }
}

export class SceneEngine {
  constructor(config) {
    this.config = config
    this.compositor = new Compositor()
    this._heroCache = new Map()
    registerPipelineFonts()
  }

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
      // Source imagery matches the active canvas aspect: portrait for 9:16
      // Shorts, landscape for 16:9 video.
      const isWide = DesignSystem.W >= DesignSystem.H
      const orientation = isWide ? 'landscape' : 'portrait'
      const res = await fetch(
        `https://api.pexels.com/v1/search?query=${encodeURIComponent(pexelsQuery)}&per_page=15&page=${page}&orientation=${orientation}`,
        { headers: { Authorization: key2 }, signal: AbortSignal.timeout(5000) }
      )
      if (!res.ok) return null
      const data = await res.json()
      const photos = data.photos || []
      if (!photos.length) return null
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

    const actStyle = ACT_STYLE_OVERRIDES[scene.type] || null
    const enrichedScene = actStyle ? { ...scene, visualBias: actStyle, mood: actStyle.mood } : scene

    await this.compositor.compose(ctx, enrichedScene, progress, wordIndex, category, renderManifest)

    return canvas.toBuffer('image/png')
  }
}
