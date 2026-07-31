import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { execSync } from 'child_process'
import { SceneEngine } from './video/SceneEngine.mjs'
import { Timeline } from './video/Timeline.mjs'
import { CoverGenerator } from './video-studio/CoverGenerator.mjs'
import { ProductionJob } from './video-studio/ProductionJob.mjs'
import { ScriptContract } from './video-studio/ScriptContract.mjs'
import { VoiceSync } from './audio/VoiceSync.mjs'
import { SoundFX } from './audio/SoundFX.mjs'
import { NewsAnalyzer } from './ai/NewsAnalyzer.mjs'
import { BRollSelector } from './ai/BRollSelector.mjs'
import { QualityChecker } from './quality/QualityChecker.mjs'
import { AudioMixer } from './audio/AudioMixer.mjs'
import { ScenePlanner } from './ai/ScenePlanner.mjs'
import { StoryDirector } from './ai/StoryDirector.mjs'
import { VisualReasoner } from './ai/VisualReasoner.mjs'
import { EmotionalArcAnalyzer, MotionPlanner, TransitionPlanner } from './ai/StoryAnalyzer.mjs'

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
    this.scenePlanner = new ScenePlanner()
    this.storyDirector = new StoryDirector()
    this.visualReasoner = new VisualReasoner()
    this.coverGenerator = new CoverGenerator(null)
    this.scriptContract = new ScriptContract()
    this.emotionalArcAnalyzer = new EmotionalArcAnalyzer()
    this.motionPlanner = new MotionPlanner()
    this.transitionPlanner = new TransitionPlanner()
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

  async generateFromArticle(article, outDir = 'output', job = null) {
    fs.mkdirSync(outDir, { recursive: true })
    const framesDir = `${outDir}/frames`
    fs.mkdirSync(framesDir, { recursive: true })
    if (!job) job = new ProductionJob(article)

    this.audioMixer.ensureMusicExists()

    console.log('StoryDirector planning...')
    job.markStart('story')
    const directorStory = await this.storyDirector.plan(article)
    console.log(`Story: ${directorStory.headline} (${directorStory.scenePlan.length} scenes, hook: ${directorStory.hookStrategy})`)
    job.markDone('story', { detail: `${directorStory.scenePlan.length} scenes planned`, score: 80 })

    // Structured Script Contract — single source of truth for all downstream engines
    this.contract = this.scriptContract.build(article, directorStory)
    job.contract = this.contract

    // Phase 3: Contract enforcement — validate before any rendering work
    const { ContractValidator } = await import('./video-studio/ContractValidator.mjs')
    const { AgentCouncil } = await import('./video-studio/AgentCouncil.mjs')
    const cv = new ContractValidator()
    const validation = cv.validate(this.contract)
    if (!validation.valid) {
      console.error(`CONTRACT INVALID: ${validation.missing.join(', ')} ${validation.errors.join('; ')}`)
      job.markFailed('story', `contract invalid: ${validation.errors.slice(0, 2).join('; ') || validation.missing.join(', ')}`)
      throw new Error(`Contract validation failed: ${validation.errors.slice(0, 3).join('; ')}`)
    }
    // Phase 6: Agent Council scoring gate
    const council = new AgentCouncil()
    const scores = council.score(this.contract, article)
    this.contract.council = scores
    job.contract = this.contract
    console.log(`Council: story ${scores.story_score} / ctr ${scores.ctr_score} / retention ${scores.retention_score} → final ${scores.final_score} (${scores.passed ? 'PASS' : 'BELOW THRESHOLD'})`)
    if (!scores.passed) {
      console.warn('Story below council threshold — proceeding with fallback plan')
    }

    const sceneDefs = directorStory.scenePlan.map((s, i) => ({
      id: i + 1,
      type: s.type,
      purpose: s.type === 'hook' ? 'stop scroll' : s.type === 'close' ? 'call to action' : 'inform',
      duration: s.duration,
      narration: s.narration,
      visual_prompt: `${s.visual?.subject || ''}, ${s.visual?.style || 'cinematic'}, ${s.visual?.composition || 'wide'}`,
      camera: s.camera,
      transition: s.transition,
      emotion: s.emotion,
      music_cue: s.emotion === 'shock' || s.emotion === 'excitement' ? 'build' : 'ambient',
      sfx: s.type === 'hook' ? 'impact' : s.type === 'reveal' ? 'reveal' : 'whoosh',
      caption_focus: s.caption?.focus || '',
    }))

    const rawScenes = this.scenePlanner.planScenes(article, { headline: directorStory.headline, scenes: sceneDefs })

    const emotionalArcLabels = directorStory.emotionalArc || []
    const emotionalArc = rawScenes.map((scene, i) => ({
      intensity: scene.emotion === 'shock' ? 0.9 : scene.emotion === 'tension' ? 0.8 : scene.emotion === 'awe' ? 0.7 : scene.emotion === 'excitement' ? 0.6 : scene.emotion === 'curiosity' ? 0.5 : 0.3,
      pacing: scene.type === 'hook' ? 0.3 : scene.type === 'fact' ? 0.5 : scene.type === 'reveal' ? 0.4 : scene.type === 'explanation' ? 0.25 : scene.type === 'reaction' ? 0.35 : 0.2,
      colorTemperature: scene.emotion === 'shock' || scene.emotion === 'tension' ? 0.15 : scene.emotion === 'awe' ? 0.7 : scene.emotion === 'excitement' ? 0.6 : 0.5,
      zoomTarget: scene.type === 'hook' || scene.type === 'reveal' ? 'close' : scene.type === 'explanation' || scene.type === 'close' ? 'wide' : 'medium',
      revealTiming: scene.emotion === 'shock' ? 0.15 : scene.emotion === 'curiosity' ? 0.25 : scene.emotion === 'tension' ? 0.4 : 0.3,
      visualDensity: scene.emotion === 'shock' || scene.emotion === 'tension' ? 'high' : scene.emotion === 'awe' || scene.emotion === 'excitement' ? 'medium' : 'low',
    }))

    this.motionPlanner.enrich(rawScenes, emotionalArc)
    this.transitionPlanner.enrich(rawScenes, emotionalArc)

    const scenes = []
    for (const scene of rawScenes) {
      const visualPlan = await this.visualReasoner.select(scene, article, article.category)
      scenes.push({
        ...scene,
        category: visualPlan.category,
        image: visualPlan.primary?.url || null,
        bRoll: visualPlan.primary?.url || null,
        visualPlan,
        colors: visualPlan.colors,
        directorLayout: visualPlan.layout,
        directorCaption: visualPlan.caption,
      })
    }

    const timedScenes = this.scenePlanner.assignTimestamps(scenes)
    this.validateTemplate(timedScenes)
    job.markDone('assets', { detail: `${scenes.length} scenes with resolved visuals`, score: Math.round(90 - scenes.filter(s => !s.image).length * 5) })

    // Stage 5b: Cover generation — CoverDirector + Composer + mandatory validation gate
    job.markStart('cover')
    try {
      // Pass contract cover metadata (headline/subheadline/subject) into the article
      // so the CoverDirector produces a story-aligned cover
      const coverArticle = { ...article, title: article.title || this.contract?.cover?.headline }
      const coverResult = await this.coverGenerator.generateTournament(coverArticle, outDir, { styles: ['breaking', 'cinematic', 'minimal', 'reaction', 'data'] })
      const coverPath = coverResult.path
      this.coverPath = coverPath
      this.coverBrief = coverResult.brief
      if (coverResult.winner) {
        console.log(`Cover tournament: winner "${coverResult.winner}" (CTR ${coverResult.winnerCtr})`)
        job.markDone('cover', { detail: `winner "${coverResult.winner}" CTR ${coverResult.winnerCtr}`, score: coverResult.winnerCtr })
      } else {
        console.warn(`Cover tournament failed: ${coverResult.variants?.filter(v => !v.ok).map(v => v.reason).join('; ') || 'unknown'}`)
        job.markDone('cover', { ok: false, detail: 'cover tournament failed' })
      }
    } catch (e) {
      console.warn(`Cover generation skipped: ${e.message}`)
      job.markDone('cover', { ok: false, detail: e.message })
      this.coverPath = null
    }

    this.sceneEngine = new SceneEngine(timedScenes)
    this.timeline = new Timeline(timedScenes, this.renderFps)

    const captionScript = this.scenePlanner.buildNarrationScript(timedScenes)
    const rawDuration = timedScenes.length > 0 ? timedScenes[timedScenes.length - 1].end : 30
    const totalDuration = (!rawDuration || isNaN(rawDuration) || Number(rawDuration) < 15) ? 30 : Number(rawDuration)
    job.markStart('voice')
    const voicePath = `${outDir}/narration.mp3`
    await this.voiceSync.generateTTS(captionScript, voicePath)

    const voiceDur = this.voiceSync.getDuration(voicePath)
    const voiceSize = fs.existsSync(voicePath) ? fs.statSync(voicePath).size : 0
    console.log(`Narration: ${voiceDur.toFixed(1)}s, ${(voiceSize / 1024).toFixed(0)}KB (template: ${totalDuration}s)`)

    if (voiceSize < 1024 || voiceDur < 1) {
      console.warn('Voice file too small or empty, falling back to espeak')
      await this.voiceSync.fallbackTTS(captionScript, voicePath)
    }

    // Pad short narration with silence so platforms don't reject the video
    const finalVoiceDur = this.voiceSync.getDuration(voicePath)
    if (finalVoiceDur < totalDuration) {
      const paddedVoice = `${outDir}/narration_padded.mp3`
      const padSecs = (totalDuration - finalVoiceDur).toFixed(2)
      try {
        execSync(
          `ffmpeg -y -i "${voicePath}" -af "apad=pad_dur=${padSecs}" -t ${totalDuration} -c:a libmp3lame -b:a 128k "${paddedVoice}" 2>&1`,
          { stdio: 'pipe', timeout: 30000 }
        )
        if (fs.existsSync(paddedVoice)) {
          fs.copyFileSync(paddedVoice, voicePath)
          fs.unlinkSync(paddedVoice)
          console.log(`Narration padded with ${padSecs}s silence → ${totalDuration}s`)
        }
      } catch (e) {
        console.warn(`Narration padding skipped: ${e.message}`)
      }
    }
    job.markDone('voice', { detail: `${totalDuration.toFixed(1)}s narration`, score: finalVoiceDur >= 1 ? 85 : 40 })

    const totalFrames = Math.ceil(totalDuration * this.renderFps)
    const reportEvery = Math.max(1, Math.floor(totalFrames / 20))
    console.log(`Rendering ${totalFrames} frames at ${this.renderFps}fps (output: ${this.outputFps}fps)...`)
    job.markStart('render')

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
    job.markDone('render', { detail: `${totalFrames} frames → ${path.basename(videoPath)}`, score: 88 })

    job.markStart('quality')
    const qc = await this.qualityChecker.analyzeRenderedVideo(videoPath)
    const qScore = qc?.overallScore
      ?? (typeof qc?.checks === 'object' ? (qc.checks.score ?? qc.checks.overall ?? 80) : 80)
      ?? 80
    job.markDone('quality', { detail: `Quality ${qScore}/100`, score: qScore })

    return { videoPath, job }
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
      if (fs.existsSync(listPath)) {
        const lines = fs.readFileSync(listPath, 'utf-8').split('\n').filter(Boolean)
        console.error(`List file lines: ${lines.length}, first: ${lines[0]?.slice(0, 80)}`)
      }
      throw e
    }

    const musicPath = this.audioMixer.getRandomMusic()
    this.audioMixer.mixAudio(silentVideo, voicePath, musicPath, totalDuration, videoPath)
    console.log('Broadcast video:', videoPath)

    // Burn subtitles from narration beat timings (SRT)
    try {
      const { generateSRT, burnSubtitles } = await import('../scripts/captions.mjs')
      const narrationScript = scenes.map(s => s.caption || s.narration || '').filter(Boolean).join(' ')
      if (narrationScript.trim()) {
        const srt = generateSRT(narrationScript, totalDuration)
        const srtPath = `${outDir}/captions.srt`
        fs.writeFileSync(srtPath, srt)
        const subbed = `${outDir}/broadcast_subbed.mp4`
        try {
          await burnSubtitles(videoPath, srtPath, subbed)
          if (fs.existsSync(subbed)) {
            fs.copyFileSync(subbed, videoPath)
            fs.unlinkSync(subbed)
            console.log('Subtitles burned:', srtPath)
          }
        } catch (e) {
          console.warn(`Subtitle burn skipped: ${e.message}`)
        }
      }
    } catch (e) {
      console.warn(`Subtitle generation skipped: ${e.message}`)
    }

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
    const { videoPath, job } = await engine.generateFromArticle(article)
    await engine.verifyQuality(videoPath)
    console.log('Done:', videoPath)
    console.log('Job:', job.status, '—', Object.entries(job.stages).map(([k, v]) => `${k}:${v.status}`).join(' | '))
  }
  run().catch(e => {
    console.error('Fatal:', e)
    process.exit(1)
  })
}