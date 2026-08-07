import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { execFileSync } from 'child_process'
import { SceneEngine } from './video/SceneEngine.mjs'
import { Timeline } from './video/Timeline.mjs'
import { VisualDirector } from './video/VisualDirector.mjs'
import { SceneCompositionScore } from './video/SceneCompositionScore.mjs'
import { CategoryProductionProfiles } from './video/CategoryProductionProfiles.mjs'
import { SelfHealingExecutor } from './ai/SelfHealingExecutor.mjs'
import { ProductionGuardian } from './ai/ProductionGuardian.mjs'
import { ProductionPreflight } from './ai/ProductionPreflight.mjs'
import { SceneTextManifest } from './pipeline/SceneTextManifest.mjs'
import { TextConflictResolver } from './pipeline/TextConflictResolver.mjs'
import { resolveRenderManifest, resolveRenderGates } from './pipeline/RenderManifest.mjs'
import { TextLayoutEngine } from './layout/TextLayoutEngine.mjs'
import { TextLayoutPreflight } from './layout/TextLayoutPreflight.mjs'
import { LayoutPolicy } from './layout/LayoutPolicy.mjs'
import { LayoutSnapshotStore } from './layout/LayoutSnapshotStore.mjs'
import { VisualIntentEngine } from './pipeline/VisualIntentEngine.mjs'
import { SemanticVisualRankerV2 } from './pipeline/SemanticVisualRankerV2.mjs'
import { ProductionMemory } from './pipeline/ProductionMemory.mjs'
import { HookAnalyzer } from './quality/HookAnalyzer.mjs'
import { CompositionJudge } from './quality/CompositionJudge.mjs'
import { RetentionSimulator } from './quality/RetentionSimulator.mjs'
import { FrameVisionAnalyzer } from './quality/FrameVisionAnalyzer.mjs'
import { QualityGuardian } from './quality/QualityGuardian.mjs'
import { BrandPerformanceMemory } from './pipeline/BrandPerformanceMemory.mjs'
import { ThumbnailBrandOptimizer } from './ai/thumbnail/ThumbnailBrandOptimizer.mjs'
import { ProductionEffectEngine } from './video/effects/ProductionEffectEngine.mjs'
import { RetentionDirector } from './video/RetentionDirector.mjs'
import { SceneProductionScore } from './video/scoring/SceneProductionScore.mjs'
import { CoverGenerator } from './video-studio/CoverGenerator.mjs'
import { ProductionJob } from './video-studio/ProductionJob.mjs'
import { ScriptContract } from './video-studio/ScriptContract.mjs'
import { VoiceSync } from './audio/VoiceSync.mjs'
import { SoundFX } from './audio/SoundFX.mjs'
import { QualityChecker } from './quality/QualityChecker.mjs'
import { AudioMixer } from './audio/AudioMixer.mjs'
import { ScenePlanner } from './ai/ScenePlanner.mjs'
import { StoryDirector } from './ai/StoryDirector.mjs'
import { VisualReasoner } from './ai/VisualReasoner.mjs'
import { MotionPlanner, TransitionPlanner } from './ai/StoryAnalyzer.mjs'
import { VisualSearchEngine, ENTITY_EXPANSIONS } from './assets/VisualSearchEngine.mjs'
import { ImageDatabase } from './assets/ImageDatabase.mjs'
import { ImageRanker } from './assets/ImageRanker.mjs'
import { AssetUsageTracker } from './assets/AssetUsageTracker.mjs'
import { ImagePerformanceMemory } from './analytics/ImagePerformanceMemory.mjs'
import { SceneVisualPlanner } from './assets/SceneVisualPlanner.mjs'

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
    this.qualityChecker = new QualityChecker()
    this.audioMixer = new AudioMixer()
    this.scenePlanner = new ScenePlanner()
    this.storyDirector = new StoryDirector()
    this.visualReasoner = new VisualReasoner()
    this.coverGenerator = new CoverGenerator(null)
    this.scriptContract = new ScriptContract()
    this.visualDirector = new VisualDirector()
    this.compositionScorer = new SceneCompositionScore()
    this.categoryProfiles = CategoryProductionProfiles
    this.effectEngine = ProductionEffectEngine
    this.retentionDirector = new RetentionDirector()
    this.productionScorer = new SceneProductionScore()
    this.guardian = new ProductionGuardian()
    this.executor = new SelfHealingExecutor(this.guardian)
    this.textResolver = new TextConflictResolver()
    this.visualIntentEngine = new VisualIntentEngine()
    this.visualRankerV2 = new SemanticVisualRankerV2({ memory: this.productionMemory })
    this.productionMemory = new ProductionMemory()
    this.hookAnalyzer = new HookAnalyzer()
    this.compositionJudge = new CompositionJudge({ memory: this.productionMemory })
    this.retentionSimulator = new RetentionSimulator({ memory: this.productionMemory })
    this.frameVision = new FrameVisionAnalyzer()
    this.qualityGuardian = new QualityGuardian()
    this.brandPerformance = new BrandPerformanceMemory()
    this.thumbnailBrandOptimizer = new ThumbnailBrandOptimizer({ brandMemory: this.brandPerformance })
    this.motionPlanner = new MotionPlanner()
    this.transitionPlanner = new TransitionPlanner()
    this.imageDb = null
    this.visualSearchEngine = null
    this.imageRanker = null
    this.assetUsage = null
    this.performanceMemory = null
    this.sceneVisualPlanner = new SceneVisualPlanner()
    this.thumbnailPath = null
  }

  _ensureVisualIntelligence() {
    if (this.imageDb) return true
    try {
      this.imageDb = new ImageDatabase()
      this.assetUsage = new AssetUsageTracker(this.imageDb)
      this.performanceMemory = new ImagePerformanceMemory(this.imageDb.dbPath)
      this.imageRanker = new ImageRanker({ usageTracker: this.assetUsage, performanceMemory: this.performanceMemory })
      this.visualSearchEngine = new VisualSearchEngine({ database: this.imageDb })
      return true
    } catch (e) {
      console.warn(`[VisualIntelligence] disabled: ${e.message}`)
      this.imageDb = null
      return false
    }
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

  async generateFromArticle(article, outDir = 'output', job = null, options = {}) {
    // Stage 1: Article preflight — verify the source data before any work.
    const preflight = await ProductionPreflight.check({ article, category: article?.category }, { outDir, bypassYoutube: true, stage: 'article' })
    if (!preflight.ready) {
      console.error(`[Preflight] blocked: ${preflight.errors.join(', ')}`)
      if (job) job.markFailed('collector', `preflight: ${preflight.errors.join(', ')}`)
      throw new Error(`Production preflight failed: ${preflight.errors.join(', ')}`)
    }

    fs.mkdirSync(outDir, { recursive: true })
    const framesDir = `${outDir}/frames`
    fs.mkdirSync(framesDir, { recursive: true })
    if (!job) job = new ProductionJob(article)

    // Deterministic music pick: the article title seeds the track index and
    // the article mood maps the cinematic family — every video gets a
    // DIFFERENT track from the right mood family (see MusicFamily).
    this.audioMixer.setMusicContext(article)

    await this.audioMixer.ensureMusicExists()

    console.log('StoryDirector planning...')
    job.markStart('story')
    const directorStory = await this.storyDirector.plan(article)
    console.log(`Story: ${directorStory.headline} (${directorStory.scenePlan.length} scenes, hook: ${directorStory.hookStrategy})`)
    job.markDone('story', { detail: `${directorStory.scenePlan.length} scenes planned`, score: 80 })

    // Channel Growth Optimizer — ThumbnailBrandOptimizer packaging judge.
    // Detects repetitive brand patterns (HIDDEN/REVEALED/SECRET/SHOCKING),
    // scores alternatives with the CTR predictor + brand safety + novelty,
    // and swaps in the strongest curiosity-gap title before the contract,
    // cover, and publish title are built. BrandPerformanceMemory makes the
    // avoidance automatic once real CTR data proves a pattern weak.
    job.markStart('packaging')
    const packaging = this.thumbnailBrandOptimizer.judge(article, this.contract?.cover || null, article.title)
    if (packaging.selected && packaging.selected.title !== article.title) {
      console.log(`Packaging: "${article.title}" → "${packaging.selected.title}" (${packaging.selected.score}/100, ${packaging.selected.angle || 'curiosity'})`)
      article.title = packaging.selected.title
      directorStory.headline = packaging.selected.title
    } else if (packaging.analysis.brandRisk !== 'LOW') {
      console.warn(`Packaging: ${packaging.analysis.brandRisk} risk${packaging.analysis.detected.length ? ` — ${packaging.analysis.detected.join(', ')}` : ''} (best candidate ${packaging.score}/100)`)
    } else {
      console.log(`Packaging: "${article.title}" cleared (${packaging.score}/100)`)
    }
    this.packaging = packaging
    job.markDone('packaging', { detail: packaging.selected ? `selected "${packaging.selected.title.slice(0, 60)}" ${packaging.score}/100` : `no replacement (${packaging.score}/100)`, score: packaging.score })

    // Structured Script Contract — single source of truth for all downstream engines
    // Use the pre-built optimized contract when provided (from AutonomousOrchestrator/AIOptimizer)
    if (options.contract) {
      this.contract = options.contract
    } else {
      this.contract = this.scriptContract.build(article, directorStory)
    }
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
    // Phase 6: Agent Council scoring gate (skip re-score if contract already carries council)
    if (!this.contract.council) {
      const council = new AgentCouncil()
      const scores = council.score(this.contract, article)
      this.contract.council = scores
      job.contract = this.contract
      console.log(`Council: story ${scores.story_score} / ctr ${scores.ctr_score} / retention ${scores.retention_score} → final ${scores.final_score} (${scores.passed ? 'PASS' : 'BELOW THRESHOLD'})`)
    }

    const sceneDefs = directorStory.scenePlan.map((s, i) => ({
      id: i + 1,
      type: s.type,
      purpose: s.type === 'hook' ? 'stop scroll' : s.type === 'close' ? 'call to action' : 'inform',
      duration: s.duration,
      narration: s.narration,
      visual_prompt: `${s.visual?.subject || ''}, ${s.visual?.style || 'cinematic'}, ${s.visual?.composition || 'wide'}`,
      visual_subject: s.visual?.subject || '',
      visual_style: s.visual?.style || 'cinematic',
      visual_composition: s.visual?.composition || 'wide',
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
    const usedAssets = []
    const entityCounts = new Map()
    for (const scene of rawScenes) {
      const visualPlan = await this.visualReasoner.select(scene, article, article.category) || { primary: null, images: [], colors: {}, category: article.category }
      // V4 Visual Intent — build scene meaning, score candidates by relevance
      const visualIntent = this.visualIntentEngine.buildIntent(scene, article)
      const intentRanked = this.visualIntentEngine.rankCandidates(visualPlan.images || [], visualIntent)
      const topScore = intentRanked[0]?.score ?? null

      // Visual Intelligence: entity-aware search + DB-first cache + ranker +
      // cross-scene diversity. Falls back to visualPlan when unavailable.
      let chosenUrls = []
      let chosenMeta = null
      const viaVisualIntel = this._ensureVisualIntelligence() && this.sceneVisualPlanner && scene.visual?.subject
      if (viaVisualIntel) {
        try {
          const intent = {
            subject: scene.visual.subject,
            entity: visualIntent.brand || article.category === 'technology' ? (visualIntent.brand || null) : null,
            entities: visualIntent.brand ? [visualIntent.brand] : [],
            keywords: visualPlan.keywords || [],
            sceneType: scene.type,
            emotion: scene.emotion,
          }
          const candidates = await this.visualSearchEngine.search(intent)
          if (candidates?.length) {
            const ranked = this.imageRanker.rank(candidates, { subject: scene.visual.subject, entities: intent.entities, keywords: intent.keywords }, { cooldownDays: 7 })
            const diversity = this.sceneVisualPlanner.pick(
              { index: scene.id, entity: visualIntent.brand, images: ranked },
              { usedScenes: usedAssets, entityCounts }
            )
            chosenMeta = diversity.asset || null
            chosenUrls = chosenMeta ? [chosenMeta.url] : []
            if (chosenMeta?.sha256) {
              this.imageDb.recordUsage(chosenMeta.sha256, { videoId: null, sceneIndex: scene.id })
              usedAssets.push(chosenMeta)
            } else if (chosenMeta?.url) {
              usedAssets.push({ url: chosenMeta.url })
            }
            const ent = visualIntent.brand
            if (ent && entityCounts) entityCounts.set(ent, (entityCounts.get(ent) || 0) + 1)
            // Milestone B: carry the asset identity onto the scene so the
            // learning layer can map scene→asset → performance attribution.
            chosenMeta && (chosenMeta.assetId = chosenMeta.sha256)
            chosenMeta && (chosenMeta.entity = chosenMeta.entity || ent || null)
            console.log(`[VisualIntelligence] scene ${scene.id}: ${chosenUrls[0] || 'none'} (${candidates.length} candidates)${chosenMeta?.sha256 ? ' ✓indexed' : ''}`)
          }
        } catch (e) {
          console.warn(`[VisualIntelligence] scene ${scene.id} skipped: ${e.message}`)
        }
      }

      // Cinematic Visual Director: rank images, drop near-duplicates, assign camera
      const ranked = this.visualDirector.rank(intentRanked.map(r => r.url), article)
      const categoryCamera = this.categoryProfiles.getCamera(article.category, scene.type)
      const cameraPlan = { ...this.visualDirector.getCameraPlan(scene.type), motion: scene.camera || categoryCamera }
      const effects = this.effectEngine.buildSceneEffects(scene, article.category)
      const rankedUrls = chosenUrls.length ? chosenUrls : ranked.map(r => r.url).filter(Boolean)
      const fallbackUrls = visualPlan.primary?.url ? [visualPlan.primary.url] : []
      scenes.push({
        ...scene,
        category: visualPlan.category || article.category,
        image: rankedUrls[0] || visualPlan.primary?.url || null,
        bRoll: rankedUrls[0] || visualPlan.primary?.url || null,
        images: rankedUrls.length ? rankedUrls : fallbackUrls,
        assetId: chosenMeta?.sha256 || null,
        assetEntity: chosenMeta?.entity || visualIntent.brand || null,
        camera: cameraPlan.motion,
        cameraPlan,
        layoutStyle: this.categoryProfiles.getLayout(article.category),
        effects,
        visualPlan,
        visualIntent,
        visualRelevanceScore: topScore,
        colors: visualPlan.colors || {},
        directorLayout: visualPlan.layout,
        directorCaption: visualPlan.caption,
      })
    }

    // Retention Director: plan a visual/motion/information change every ~2.5s
    this.retentionDirector.plan(scenes).forEach(plan => {
      const sc = scenes.find(s => (s.id || 0) === plan.sceneId)
      if (sc) sc.retentionPlan = plan.plan
    })

    // Hook Analyzer — evaluate the opening scene for Shorts retention
    const hookScene = scenes.find(s => s.type === 'hook')
    if (hookScene) {
      const hook = this.hookAnalyzer.analyze(hookScene, article)
      hookScene.hookScore = hook.hookScore
      hookScene.hookAnalysis = hook
      console.log(`Hook: ${hook.hookScore}/100 ${hook.passed ? '(strong)' : `— ${hook.recommendation}`}`)
      this.productionMemory.learn('hook_opening', { preventedBy: 'HookAnalyzer' })
    }

    // Text Intent Engine — single source of truth for scene text.
    // Build a manifest per scene, resolve duplicate emphasis/caption words,
    // then lay out every layer (lines, font size, position) against its safe
    // zone so the renderer never duplicates, wraps by guesswork, or clips.
    // Emphasis runs 20%+ larger than the caption (72 vs 58) per the
    // hierarchy: keyword > headline > caption.
    const LAYER_FONT_SIZE = { emphasis: 72, headline: 84, caption: 58, source: 44 }
    for (const sc of scenes) {
      sc.textManifest = SceneTextManifest.build(sc)
      const resolved = this.textResolver.process(sc.textManifest)
      const captionLayer = resolved.text_layers.find(l => l.type === 'caption')
      // Write resolved caption back to the scene (empty = hidden)
      sc.caption = captionLayer && captionLayer.visible !== false ? captionLayer.text : ''
      sc.captionHidden = captionLayer?.visible === false
      // Layout every text layer (priority order: emphasis > headline > caption)
      // Retention signals (ViewerBehaviorModel) tune parameters; the layout
      // engine still guarantees the safe zone and legibility floors.
      const layoutPolicy = this.retentionSimulator?.model ? LayoutPolicy.policyFor(sc, this.retentionSimulator.model) : LayoutPolicy.defaults()
      for (const layer of [...resolved.text_layers].sort((a, b) => {
        const prio = { emphasis: 3, headline: 2, caption: 1, source: 0 }
        return (prio[b.type] ?? 0) - (prio[a.type] ?? 0)
      })) {
        const rolePolicy = layoutPolicy[layer.type] || {}
        const layout = TextLayoutEngine.layout({
          text: layer.text,
          role: layer.type,
          fontFamily: layer.type === 'headline' || layer.type === 'emphasis' ? 'Anton' : 'Inter',
          preferredFontSize: rolePolicy.preferredFontSize || LAYER_FONT_SIZE[layer.type] || 58,
          maxLines: rolePolicy.maxLines,
        })
        layer.fontSize = layout.fontSize
        layer.scale = layout.scalePercent
        sc[`${layer.type}Layout`] = layout
        sc[`${layer.type}FontSize`] = layout.fontSize
      }
    }
    // Hard failure gate: abort before FFmpeg if any layout still overflows
    for (const sc of scenes) TextLayoutPreflight.validateScene(sc)
    // Layout snapshots for regression testing (LAYOUT_SNAPSHOTS=1 to record)
    if (process.env.LAYOUT_SNAPSHOTS === '1') LayoutSnapshotStore.capture(scenes)

    const timedScenes = this.scenePlanner.assignTimestamps(scenes)
    this.validateTemplate(timedScenes)

    // Stage 2: Scene preflight — scenes must exist before scoring/render prep
    const scenePreflight = await ProductionPreflight.check({ article, category: article?.category, scenes: timedScenes }, { stage: 'scene' })
    if (!scenePreflight.ready) {
      throw new Error(`Scene preflight failed: ${scenePreflight.errors.join(', ')}`)
    }

    // Phase 9: AI Composition Judge — overall production critique per scene.
    // Applies known remediation from ProductionMemory automatically.
    const judgeRun = await this.compositionJudge.evaluate(timedScenes, article)
    timedScenes.forEach(sc => {
      const j = judgeRun.results.find(r => r.scene === sc.id)
      if (j) sc.judge = j
    })
    const judgeFailed = judgeRun.failed
    if (judgeFailed.length > 0) {
      console.warn(`Composition Judge: ${judgeRun.results.length - judgeFailed.length}/${judgeRun.results.length} passed (avg ${judgeRun.avg}/100) — ${judgeFailed.map(f => `scene ${f.scene}: ${f.recommendation}`).join(' | ')}`)
    } else {
      console.log(`Composition Judge: all ${judgeRun.results.length} scenes passed (avg ${judgeRun.avg}/100)${judgeRun.aiUsed ? ' [AI]' : ''}`)
    }

    // Phase 9b: Semantic Visual Ranking V2 — judge feedback re-selects visuals.
    // A visual_unrelated verdict triggers a semantic re-rank of the candidate
    // pool (excluding the current selection), making the judge an active
    // visual optimizer instead of a passive gate.
    for (const sc of timedScenes) {
      const reranked = this.visualRankerV2.applyFeedback(sc, article)
      if (reranked) {
        console.log(`Visual Rerank: scene ${sc.id} → ${String(reranked.url).split('/').pop().slice(0, 30)} (${reranked.score}/100)`)
      }
    }

    // Phase 10: Viewer Retention Simulator — predict drop-off, then optimize.
    // Answers "will a viewer stay?" — trims long scenes, promotes the
    // strongest caption into the hook when completion is predicted low.
    const retentionRun = this.retentionSimulator.evaluate(timedScenes)
    const retentionChanges = this.retentionSimulator.optimize(timedScenes, retentionRun)
    if (retentionChanges.changes.length > 0) {
      // Duration trims invalidate timestamps — re-sync before narration/render
      timedScenes = this.scenePlanner.assignTimestamps(timedScenes)
      console.log(`Retention Optimizer: ${retentionChanges.changes.join('; ')}`)
    }
    const dropInfo = retentionRun.dropZones.length
      ? `drops at ${retentionRun.dropZones.map(z => `~${z.second}s (scene ${z.sceneId})`).join(', ')}`
      : 'no significant drop zones'
    const topRisk = retentionRun.dropRisks[0]
    console.log(`Retention: score ${retentionRun.retentionScore}/100, ${retentionRun.completionRate}% completion, ${retentionRun.avgWatch}s avg watch — ${dropInfo}${topRisk ? ` | top risk: ${topRisk.risk}@scene${topRisk.scene} (${topRisk.confidence})` : ''}`)
    // Stash the prediction for the RetentionPatternLearner at publish time
    this.lastRetention = {
      retentionScore: retentionRun.retentionScore,
      completionRate: retentionRun.completionRate,
      avgWatch: retentionRun.avgWatch,
      dropRisks: retentionRun.dropRisks,
      recommendations: retentionRun.recommendations,
      appliedFixes: retentionChanges.changes,
    }

    // Phase 8: Scene composition quality + AI Production Score
    const scored = timedScenes.map(s => ({ scene: s, comp: this.compositionScorer.score(s) }))
    const prodScored = timedScenes.map(s => ({ scene: s, prod: this.productionScorer.score(s) }))
    const failing = scored.filter(x => !x.comp.passed)
    const prodFailing = prodScored.filter(x => !x.prod.passed)
    if (failing.length > 0 || prodFailing.length > 0) {
      const reasons = [
        ...failing.map(f => `scene ${f.scene.id}: ${f.comp.reason}`),
        ...prodFailing.map(f => `scene ${f.scene.id}: ${f.prod.reason}`),
      ].join(' | ')
      console.warn(`Scene production: ${scored.length - prodFailing.length}/${scored.length} passed (${reasons})`)
      job.markDone('assets', { ok: prodFailing.length === 0, detail: reasons.slice(0, 120), score: Math.round(((scored.length - prodFailing.length) / scored.length) * 100) })
    } else {
      const avgProd = Math.round(prodScored.reduce((s, x) => s + x.prod.overall, 0) / prodScored.length)
      console.log(`Scene production: all ${scored.length} scenes passed (avg ${avgProd}/100)`)
      job.markDone('assets', { detail: `${scenes.length} scenes, production ${avgProd}`, score: avgProd })
    }

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
      // 16:9 YouTube thumbnail (1280x720) — landscape variant for uploads
      try {
        const thumbPath = `${outDir}/thumbnail.png`
        await this.coverGenerator.generateThumbnail(coverArticle, thumbPath, { style: coverResult.winner || 'breaking' })
        this.thumbnailPath = thumbPath
      } catch (e) {
        console.warn(`Thumbnail variant skipped: ${e.message}`)
        this.thumbnailPath = null
      }
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
    let totalDuration = (!rawDuration || isNaN(rawDuration) || Number(rawDuration) < 15) ? 30 : Number(rawDuration)
    job.markStart('voice')
    const voicePath = `${outDir}/narration.mp3`
    // Premium narration or FAIL. generateTTS refuses espeak — a robotic voice
    // must never reach the render/publish stage (see src/audio/VoiceSync.mjs).
    try {
      await this.voiceSync.generateTTS(captionScript, voicePath)
    } catch (e) {
      console.error(`[VOICE] narration failed: ${e.message}`)
      throw new Error(`Voice generation failed — ${e.message}`)
    }

    const voiceDur = this.voiceSync.getDuration(voicePath)
    const voiceSize = fs.existsSync(voicePath) ? fs.statSync(voicePath).size : 0
    const voiceReport = this.voiceSync.lastReport || {}
    if (voiceReport.provider === 'espeak') {
      throw new Error('Voice QA gate: espeak narration produced — refusing to render robotic audio')
    }
    console.log(`Narration: ${voiceDur.toFixed(1)}s, ${(voiceSize / 1024).toFixed(0)}KB via ${voiceReport.provider || 'tts'} (template: ${totalDuration}s)`)

    if (voiceSize < 1024 || voiceDur < 1) {
      throw new Error('Voice QA: narration file is empty/invalid — refusing to publish')
    }

    // The closing tagline is the LAST words of the narration track. If the
    // narrator runs longer than the scene timeline, mixAudio's `-t totalDuration`
    // would slice them off — the outro would never be read. Extend the video
    // timeline to cover the full narration so the brand outro is always spoken.
    if (voiceDur > totalDuration) {
      const templateDur = totalDuration
      totalDuration = Math.ceil(voiceDur) + 0.5
      console.log(`Narration ${voiceDur.toFixed(1)}s > template ${templateDur}s — extending video to ${totalDuration.toFixed(1)}s so the closing tagline is fully read`)
    }

    // Pad short narration with silence so platforms don't reject the video
    const finalVoiceDur = this.voiceSync.getDuration(voicePath)
    if (finalVoiceDur < totalDuration) {
      const paddedVoice = `${outDir}/narration_padded.mp3`
      const padSecs = (totalDuration - finalVoiceDur).toFixed(2)
      try {
        execFileSync(
          'ffmpeg',
          ['-y', '-i', voicePath, '-af', `apad=pad_dur=${padSecs}`, '-t', String(totalDuration), '-c:a', 'libmp3lame', '-b:a', '128k', paddedVoice],
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
    job.markDone('voice', { detail: `${totalDuration.toFixed(1)}s narration (${voiceReport.provider || 'tts'})`, score: finalVoiceDur >= 1 ? 85 : 40 })

    const totalFrames = Math.ceil(totalDuration * this.renderFps)
    const reportEvery = Math.max(1, Math.floor(totalFrames / 20))

    // Stage 3: Render preflight — environment + narration ready before the loop
    const renderPreflight = await ProductionPreflight.check({ article }, { outDir, stage: 'render' })
    if (!renderPreflight.ready) {
      throw new Error(`Render preflight failed: ${renderPreflight.errors.join(', ')}`)
    }

    // RenderManifest: the canvas pipeline is the single text authority.
    // FFmpeg-level compositing (SRT burn, footer.png) is opt-in and
    // mutually exclusive with the canvas layer that owns the same element.
    const renderManifest = resolveRenderManifest(options)
    const renderGates = resolveRenderGates(options, renderManifest)
    console.log(`Rendering ${totalFrames} frames at ${this.renderFps}fps (output: ${this.outputFps}fps)...`)
    job.markStart('render')

    for (let frame = 0; frame < totalFrames; frame++) {
      const { scene, progress, time } = this.timeline.getSceneForFrame(frame)

      const sceneDuration = scene.end - scene.start
      const sceneTime = time - scene.start
      const wordTimings = this.timeline.getActiveWordTimings(scene.caption || '', sceneDuration)
      const wordIndex = this.timeline.getActiveWordIndex(wordTimings, sceneTime)

      const png = await this.sceneEngine.renderSceneFrame({ ...scene, quickRender: options.quick }, progress, wordTimings, wordIndex, renderManifest)

      const framePath = `${framesDir}/f${String(frame).padStart(5, '0')}.png`
      fs.writeFileSync(framePath, png)

      if (frame % reportEvery === 0 || frame === totalFrames - 1) {
        process.stdout.write(`  Frame ${frame + 1}/${totalFrames} (${((frame + 1) / totalFrames * 100).toFixed(0)}%)\r`)
      }
    }
    process.stdout.write('\n')

    const videoPath = await this.executor.execute(
      () => this.assembleVideo(framesDir, voicePath, timedScenes, totalDuration, outDir, renderManifest, renderGates),
      { jobId: job?.id, category: article?.category }
    )
    job.markDone('render', { detail: `${totalFrames} frames → ${path.basename(videoPath)}`, score: 88 })

    job.markStart('quality')
    const qc = await this.qualityChecker.analyzeRenderedVideo(videoPath)
    const qScore = qc?.overallScore
      ?? (typeof qc?.checks === 'object' ? (qc.checks.score ?? qc.checks.overall ?? 80) : 80)
      ?? 80
    job.markDone('quality', { detail: `Quality ${qScore}/100`, score: qScore })

    // Post-render Quality Guardian — pixel-level verification of what
    // actually rendered (contrast, safe margins, subject presence, blank
    // frames). Rejections are learned into ProductionMemory so the same
    // class of failure never ships twice.
    try {
      const frameAnalysis = await this.frameVision.analyze(videoPath, timedScenes)
      const guardian = this.qualityGuardian.evaluate(frameAnalysis)
      if (!guardian.passed) {
        this.productionMemory.learn('frame_quality_reject', { status: 'detected', introducedIn: 'V4', preventedBy: null, preferredFix: 're_render_with_fixes', retentionImpact: -8 })
        console.warn(`Quality Guardian: frame analysis ${guardian.score}/100 — ${guardian.issues.join('; ') || 'below threshold'}`)
      } else {
        console.log(`Quality Guardian: frame analysis passed (${guardian.score}/100)`)
      }
      job.markDone('quality', { detail: `Guardian ${guardian.score}/100`, score: guardian.score })
    } catch (e) {
      console.warn(`Quality Guardian skipped: ${e.message}`)
    }

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

  async assembleVideo(framesDir, voicePath, scenes, totalDuration, outDir, renderManifest = null, renderGates = null) {
    const gates = renderGates ?? resolveRenderGates({}, renderManifest ?? resolveRenderManifest())
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
      execFileSync(
        'ffmpeg',
        ['-y', '-f', 'concat', '-safe', '0', '-i', listPath, '-vf', `scale=1080:1920:force_original_aspect_ratio=decrease,pad=1080:1920:(ow-iw)/2:(oh-ih)/2,format=yuv420p,fps=${this.outputFps}`, '-pix_fmt', 'yuv420p', silentVideo],
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

    // Burn subtitles from narration beat timings (SRT).
    // Single-owner rule: only when the manifest hands the subtitle layer to
    // ffmpeg (options.burnSubtitles: true). Off by default — the canvas
    // CaptionLayer is the narration authority.
    if (gates.burnSubtitles) {
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
    }

    // Footer composite: only when explicitly requested AND the canvas
    // BrandingLayer footer is disabled — mutual exclusion (one owner).
    if (gates.overlayFooter) {
      const footerWith = `${outDir}/broadcast_final.mp4`
      this.audioMixer.overlayFooter(videoPath, 'assets/footer.png', footerWith)
      if (fs.existsSync(footerWith)) {
        fs.copyFileSync(footerWith, videoPath)
      }
    }
    // Milestone B: persist the scene→asset mapping so the analytics job can
    // attribute performance to the exact images used (scene_assets table).
    try {
      const sceneAssets = scenes.map((s, i) => ({
        sceneIndex: i,
        assetId: s.assetId || null,
        entity: s.assetEntity || null,
        url: s.image || null,
      })).filter(s => s.assetId || s.url)
      fs.writeFileSync(path.join(outDir, 'scene-assets.json'), JSON.stringify(sceneAssets, null, 2))
    } catch { /* best-effort */ }

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