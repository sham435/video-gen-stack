import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { execSync } from 'child_process'
import { SceneEngine } from './video/SceneEngine.mjs'
import { Timeline } from './video/Timeline.mjs'
import { VoiceSync } from './audio/VoiceSync.mjs'
import { SoundFX } from './audio/SoundFX.mjs'
import { NewsAnalyzer } from './ai/NewsAnalyzer.mjs'
import { BRollSelector } from './ai/BRollSelector.mjs'
import { QualityChecker } from './quality/QualityChecker.mjs'
import { AudioMixer } from './audio/AudioMixer.mjs'
import { StoryPlanner } from './ai/StoryPlanner.mjs'
import { ScenePlanner } from './ai/ScenePlanner.mjs'
import { VisualPlanner } from './ai/VisualPlanner.mjs'
import { AssetManager } from './ai/AssetManager.mjs'

const W = 1080, H = 1920
const RENDER_FPS = 10
const OUTPUT_FPS = 30

export class NewsBroadcastEngine {
  constructor(options = {}) {
    this.renderFps = options.renderFps || RENDER_FPS
    this.outputFps = options.outputFps || OUTPUT_FPS
    this.sceneEngine = null
    this.timeline = null
    this.voiceSync = new VoiceSync()
    this.soundFX = new SoundFX()
    this.newsAnalyzer = new NewsAnalyzer()
    this.bRollSelector = new BRollSelector()
    this.qualityChecker = new QualityChecker()
    this.audioMixer = new AudioMixer()
    this.storyPlanner = new StoryPlanner()
    this.scenePlanner = new ScenePlanner()
    this.visualPlanner = new VisualPlanner()
    this.assetManager = new AssetManager()
  }

  getCategoryConfig(category) {
    const configs = {
      technology: { template: 'tech-news.json', duration: 30, visual_style: 'technology, cyberpunk, neon blue cyan, dark cinematic, holographic, 8k' },
      science: { template: 'science.json', duration: 35, visual_style: 'science, space, biology, lab, clean lighting, blue tones, microscopic, 8k' },
      business: { template: 'tech-news.json', duration: 30, visual_style: 'business, corporate, financial, modern office, professional, blue dark tones, 8k' },
    }
    return configs[category] || configs.technology
  }

  injectVariables(template, vars) {
    const str = JSON.stringify(template)
    const injected = str.replace(/\{\{(\w+)\}\}/g, (_, key) => {
      const val = vars[key]
      if (val === undefined) return `{{${key}}}`
      return JSON.stringify(String(val)).slice(1, -1)
    })
    return JSON.parse(injected)
  }

  async loadTemplate(category) {
    const cfg = this.getCategoryConfig(category)
    const raw = fs.readFileSync(`src/templates/${cfg.template}`, 'utf-8')
    return JSON.parse(raw)
  }

  async generateFromArticle(article, outDir = 'output') {
    fs.mkdirSync(outDir, { recursive: true })
    const framesDir = `${outDir}/frames`
    fs.mkdirSync(framesDir, { recursive: true })

    this.audioMixer.ensureMusicExists()

    console.log('Planning story...')
    const story = await this.storyPlanner.plan(article)
    console.log(`Story: ${story.headline} (${story.scenes.length} scenes)`)

    const rawScenes = this.scenePlanner.planScenes(article, story)
    const scenesWithVisuals = await this.visualPlanner.resolveScenes(rawScenes, article)
    const scenes = await this.assetManager.resolve(scenesWithVisuals, article, async (scene, art) => {
      return await this.visualPlanner.resolveSceneVisual(scene, art)
    })
    const timedScenes = this.scenePlanner.assignTimestamps(scenes)
    this.validateTemplate(timedScenes)

    this.sceneEngine = new SceneEngine(timedScenes)
    this.timeline = new Timeline(timedScenes, this.renderFps)

    const captionScript = this.scenePlanner.buildNarrationScript(timedScenes)
    const rawDuration = timedScenes.length > 0 ? timedScenes[timedScenes.length - 1].end : 30
    const totalDuration = (!rawDuration || isNaN(rawDuration) || Number(rawDuration) < 15) ? 30 : Number(rawDuration)
    const voicePath = `${outDir}/narration.mp3`
    await this.voiceSync.generateTTS(captionScript, voicePath)

    const voiceDur = this.voiceSync.getDuration(voicePath)
    const voiceSize = fs.existsSync(voicePath) ? fs.statSync(voicePath).size : 0
    console.log(`Narration: ${voiceDur.toFixed(1)}s, ${(voiceSize / 1024).toFixed(0)}KB (template: ${totalDuration}s)`)

    if (voiceSize < 1024 || voiceDur < 1) {
      console.warn('Voice file too small or empty, falling back to espeak')
      await this.voiceSync.fallbackTTS(captionScript, voicePath)
    }

    const totalFrames = Math.ceil(totalDuration * this.renderFps)
    const reportEvery = Math.max(1, Math.floor(totalFrames / 20))
    console.log(`Rendering ${totalFrames} frames at ${this.renderFps}fps (output: ${this.outputFps}fps)...`)

    for (let frame = 0; frame < totalFrames; frame++) {
      const { scene, progress, time } = this.timeline.getSceneForFrame(frame)

      const sceneDuration = scene.end - scene.start
      const sceneTime = time - scene.start
      const wordTimings = this.timeline.getActiveWordTimings(scene.caption || '', sceneDuration)
      const wordIndex = this.timeline.getActiveWordIndex(wordTimings, sceneTime)

      const png = await this.sceneEngine.renderSceneFrame(scene, progress, wordTimings, wordIndex)

      const framePath = `${framesDir}/f${String(frame).padStart(5, '0')}.png`
      fs.writeFileSync(framePath, png)

      if (frame % reportEvery === 0 || frame === totalFrames - 1) {
        process.stdout.write(`  Frame ${frame + 1}/${totalFrames} (${((frame + 1) / totalFrames * 100).toFixed(0)}%)\r`)
      }
    }
    process.stdout.write('\n')

    const videoPath = await this.assembleVideo(framesDir, voicePath, timedScenes, totalDuration, outDir)
    await this.qualityChecker.analyzeRenderedVideo(videoPath)

    return videoPath
  }

  buildScenesFromAnalysis(template, article, analysis) {
    const title = article.title || 'Tech News Update'
    const brand = analysis.detectBrand?.(title) || 'TECH'

    const scenes = template.scenes.map((s, i) => ({
      ...s,
      subheadline: s.type === 'hook' ? title : s.subheadline,
      text: s.type === 'hook' ? `BREAKING: ${title.slice(0, 50)}` : s.text,
      visual: article.imageUrl || s.visual,
    }))

    return scenes
  }

  validateTemplate(scenes) {
    if (!scenes || scenes.length === 0) {
      throw new Error('No scenes generated')
    }
    for (const scene of scenes) {
      if (scene.start >= scene.end) {
        throw new Error(`Scene ${scene.id}: start (${scene.start}) >= end (${scene.end})`)
      }
    }
    for (let i = 1; i < scenes.length; i++) {
      const prevEnd = scenes[i - 1].end
      const currStart = scenes[i].start
      if (Math.abs(prevEnd - currStart) > 0.1) {
        console.warn(`Warning: gap between scene ${scenes[i - 1].id} (end=${prevEnd}) and ${scenes[i].id} (start=${currStart})`)
      }
    }
  }

  async assembleVideo(framesDir, voicePath, scenes, totalDuration, outDir) {
    const videoPath = `${outDir}/broadcast.mp4`

    const listPath = `${outDir}/scene_list.txt`
    let listContent = ''
    const frameFiles = fs.readdirSync(framesDir)
      .filter(f => f.endsWith('.png'))
      .sort()
      .map(f => path.resolve(`${framesDir}/${f}`))

    const perFrame = isNaN(totalDuration) || totalDuration <= 0 ? 0.1 : totalDuration / frameFiles.length
    for (const f of frameFiles) {
      listContent += `file '${f}'\nduration ${perFrame.toFixed(4)}\n`
    }
    if (frameFiles.length > 0) {
      listContent += `file '${frameFiles[frameFiles.length - 1]}'\n`
    }
    fs.writeFileSync(listPath, listContent)

    const silentVideo = `${outDir}/silent_broadcast.mp4`
    console.log('FFmpeg concat frames to video...')
    try {
      execSync(
        `ffmpeg -y -f concat -safe 0 -i "${listPath}" -vf "scale=1080:1920:force_original_aspect_ratio=decrease,pad=1080:1920:(ow-iw)/2:(oh-ih)/2,format=yuv420p,fps=${this.outputFps}" -pix_fmt yuv420p "${silentVideo}" 2>&1`,
        { stdio: 'inherit', timeout: 120000 }
      )
    } catch (e) {
      console.error('FFmpeg concat failed. Checking frames...')
      const frameCount = fs.readdirSync(framesDir).filter(f => f.endsWith('.png')).length
      console.error(`Frames found: ${frameCount} in ${framesDir}`)
      console.error(`List file exists: ${fs.existsSync(listPath)}, size: ${fs.existsSync(listPath) ? fs.statSync(listPath).size : 0}`)
      if (fs.existsSync(listPath)) {
        const lines = fs.readFileSync(listPath, 'utf-8').split('\n').filter(Boolean)
        console.error(`List file lines: ${lines.length}, first: ${lines[0]?.slice(0, 80)}`)
      }
      throw e
    }

    const musicPath = this.audioMixer.getRandomMusic()

    this.audioMixer.mixAudio(silentVideo, voicePath, musicPath, totalDuration, videoPath)

    console.log('Broadcast video:', videoPath)

    const footerWith = `${outDir}/broadcast_final.mp4`
    this.audioMixer.overlayFooter(videoPath, 'assets/footer.png', footerWith)
    if (fs.existsSync(footerWith)) {
      fs.copyFileSync(footerWith, videoPath)
    }

    return videoPath
  }

  async verifyQuality(videoPath) {
    const result = await this.qualityChecker.analyzeRenderedVideo(videoPath)
    console.log('Quality check:', result.checks)
    if (result.warnings.length > 0) {
      console.log('Warnings:', result.warnings)
    }
    return result
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const engine = new NewsBroadcastEngine()

  const run = async () => {
    const article = {
      title: process.argv[2] || 'Apple releases groundbreaking AI model that changes everything',
      description: process.argv[3] || 'Apple has announced a revolutionary new AI model that can process images, video, and text simultaneously. The model is ten times faster than the previous version and runs entirely on-device. Industry analysts call this the biggest shift since the iPhone.',
      source: process.argv[4] || 'Tech News',
      url: process.argv[5] || '',
      imageUrl: process.argv[6] || null,
      category: 'technology',
    }

    console.log('Generating broadcast for:', article.title)
    const videoPath = await engine.generateFromArticle(article)
    await engine.verifyQuality(videoPath)
    console.log('Done:', videoPath)
  }

  run().catch(e => {
    console.error('Fatal:', e)
    process.exit(1)
  })
}
