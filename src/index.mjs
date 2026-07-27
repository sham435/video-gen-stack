import fs from 'fs'
import path from 'path'
import { execSync } from 'child_process'
import { SceneEngine } from './video/SceneEngine.mjs'
import { Timeline } from './video/Timeline.mjs'
import { VoiceSync } from './audio/VoiceSync.mjs'
import { SoundFX } from './audio/SoundFX.mjs'
import { NewsAnalyzer } from './ai/NewsAnalyzer.mjs'
import { BRollSelector } from './ai/BRollSelector.mjs'
import { QualityChecker } from './quality/QualityChecker.mjs'
import { AudioMixer } from './audio/AudioMixer.mjs'

const W = 1080, H = 1920
const FPS = 30

export class NewsBroadcastEngine {
  constructor() {
    this.sceneEngine = null
    this.timeline = null
    this.voiceSync = new VoiceSync()
    this.soundFX = new SoundFX()
    this.newsAnalyzer = new NewsAnalyzer()
    this.bRollSelector = new BRollSelector()
    this.qualityChecker = new QualityChecker()
    this.audioMixer = new AudioMixer()
  }

  async loadTemplate(templatePath) {
    const raw = fs.readFileSync(templatePath, 'utf-8')
    return JSON.parse(raw)
  }

  async generateFromArticle(article, outDir = 'output') {
    fs.mkdirSync(outDir, { recursive: true })
    const framesDir = `${outDir}/frames`
    fs.mkdirSync(framesDir, { recursive: true })

    this.audioMixer.ensureMusicExists()

    const analysis = this.newsAnalyzer.analyze(article)
    const template = await this.loadTemplate('src/templates/breaking-news.json')

    const scenes = this.buildScenesFromAnalysis(template, article, analysis)
    this.validateTemplate(scenes)

    this.sceneEngine = new SceneEngine(template)
    this.timeline = new Timeline(scenes, FPS)

    const captionScript = this.voiceSync.buildNarrationScript(scenes)
    const totalDuration = scenes[scenes.length - 1].end
    const voicePath = `${outDir}/narration.mp3`
    await this.voiceSync.generateTTS(captionScript, voicePath)

    const voiceDur = this.voiceSync.getDuration(voicePath)
    console.log(`Narration duration: ${voiceDur.toFixed(1)}s, template: ${totalDuration}s`)

    const totalFrames = Math.ceil(totalDuration * FPS)
    console.log(`Rendering ${totalFrames} frames...`)

    for (let frame = 0; frame < totalFrames; frame++) {
      const { scene, progress, time } = this.timeline.getSceneForFrame(frame)

      const sceneDuration = scene.end - scene.start
      const sceneTime = time - scene.start
      const wordTimings = this.timeline.getActiveWordTimings(scene.caption || '', sceneDuration)
      const wordIndex = this.timeline.getActiveWordIndex(wordTimings, sceneTime)

      const png = await this.sceneEngine.renderSceneFrame(scene, progress, wordTimings, wordIndex)

      const framePath = `${framesDir}/f${String(frame).padStart(5, '0')}.png`
      fs.writeFileSync(framePath, png)

      if (frame % 60 === 0 || frame === totalFrames - 1) {
        process.stdout.write(`  Frame ${frame + 1}/${totalFrames} (${((frame + 1) / totalFrames * 100).toFixed(0)}%)\r`)
      }
    }
    process.stdout.write('\n')

    const videoPath = await this.assembleVideo(framesDir, voicePath, scenes, totalDuration, outDir)
    await this.qualityChecker.analyzeRenderedVideo(videoPath)

    return videoPath
  }

  buildScenesFromAnalysis(template, article, analysis) {
    const scenes = []
    const title = article.title || 'Tech News Update'
    const desc = article.description || 'Latest technology update'

    const hook = template.scenes.find(s => s.type === 'hook') || {
      id: 'hook', type: 'hook', start: 0, end: 3,
      text: `BREAKING: ${title.slice(0, 40)}`,
      headline: 'BREAKING', subheadline: title,
      visual: 'logo', effect: 'glitch_red', audio: 'impact',
    }

    scenes.push({
      ...hook,
      subheadline: title,
      visual: article.imageUrl || 'logo',
    })

    const brand = analysis.detectBrand?.(title)
    const words = title.replace(/[^a-zA-Z0-9 ]/g, ' ').split(/\s+/).filter(w => w.length > 0)
    const factTexts = [
      brand || (words[0] || 'TECH').toUpperCase(),
      (words.slice(1, 3).join(' ') || 'MAJOR ANNOUNCEMENT').toUpperCase(),
      'GLOBAL RELEASE',
      analysis.extractTimeframe?.(desc) || 'LATEST UPDATE',
    ]

    let timeCursor = 3
    for (let i = 0; i < Math.min(4, factTexts.length); i++) {
      scenes.push({
        id: `fact_${i}`,
        type: 'fact',
        start: timeCursor,
        end: timeCursor + 3,
        text: factTexts[i],
        caption: factTexts[i],
        visual: article.imageUrl || 'logo',
        effect: 'slide_up',
        audio: 'whoosh',
      })
      timeCursor += 3
    }

    const explanations = analysis.generateExplanation?.(desc, title) || [`${title}. This is a major development in technology.`]
    const expDuration = Math.max(3, Math.min(5, Math.floor(20 / Math.max(1, explanations.length))))

    for (let i = 0; i < Math.min(4, explanations.length); i++) {
      scenes.push({
        id: `explain_${i}`,
        type: 'explanation',
        start: timeCursor,
        end: timeCursor + expDuration,
        text: explanations[i],
        caption: explanations[i].slice(0, 40),
        visual: article.imageUrl || 'logo',
        effect: i % 2 === 0 ? 'cinematic_zoom' : 'data_panel',
        audio: 'narration',
      })
      timeCursor += expDuration
    }

    const retentionHook = analysis.generateRetentionHook?.(title, desc) || 'But there is one hidden detail nobody noticed...'
    const retentionText = `${retentionHook} ${title}.`
    scenes.push({
      id: 'retention_1',
      type: 'retention',
      start: timeCursor,
      end: timeCursor + 7,
      text: retentionHook,
      caption: 'One hidden detail...',
      visual: article.imageUrl || 'logo',
      effect: 'dramatic_zoom',
      audio: 'suspense',
    })
    timeCursor += 7

    const revealText = `This is ${brand || 'a major'} development that changes the technology landscape forever.`
    scenes.push({
      id: 'retention_2',
      type: 'retention',
      start: timeCursor,
      end: timeCursor + 5,
      text: revealText,
      caption: 'Changes the landscape forever',
      visual: article.imageUrl || 'logo',
      effect: 'light_sweep',
      audio: 'reveal',
    })
    timeCursor += 5

    scenes.push({
      id: 'close',
      type: 'brand_close',
      start: timeCursor,
      end: timeCursor + 8,
      text: '',
      caption: 'Follow for daily AI & tech breakthroughs',
      visual: 'brand_card',
      effect: 'brand_reveal',
      audio: 'outro',
    })

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

    const perFrame = totalDuration / frameFiles.length
    for (const f of frameFiles) {
      listContent += `file '${f}'\nduration ${perFrame.toFixed(4)}\n`
    }
    if (frameFiles.length > 0) {
      listContent += `file '${frameFiles[frameFiles.length - 1]}'\n`
    }
    fs.writeFileSync(listPath, listContent)

    const silentVideo = `${outDir}/silent_broadcast.mp4`
    execSync(
      `ffmpeg -y -f concat -safe 0 -i "${listPath}" -vf "scale=1080:1920:force_original_aspect_ratio=decrease,pad=1080:1920:(ow-iw)/2:(oh-ih)/2,format=yuv420p,fps=${FPS}" -pix_fmt yuv420p "${silentVideo}"`,
      { stdio: 'inherit' }
    )

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

if (process.argv[1] && import.meta.url.endsWith('index.mjs')) {
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
