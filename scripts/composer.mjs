import fs from 'fs'
import path from 'path'
import { execFileSync } from 'child_process'
import { ensureMusicExists } from './audio.mjs'
import { fetchBestImage } from './pexels.mjs'
import { NewsBroadcastEngine } from '../src/index.mjs'
import { validateRenderOutput } from '../src/video/validateOutput.mjs'
import { resolveRenderManifest, resolveRenderGates } from '../src/pipeline/RenderManifest.mjs'
import { ChannelController } from '../src/governor/ChannelController.mjs'

// ── Experiment + Metrics + Manifest (loaded per-run when enabled) ─────

async function assertValidRender(file, stage) {
  const res = await validateRenderOutput(file, { requireAudio: true })
  if (res.ok) {
    console.log(`[RENDER-001] ${stage} OK ${(res.diagnostics.size / 1024).toFixed(0)}KB ${res.diagnostics.duration}s v=${res.diagnostics.hasVideo} a=${res.diagnostics.hasAudio}`)
    return res
  }
  const { diagnostics } = res
  const detail = [
    `stage=${stage}`,
    res.errors.join(','),
    `size=${diagnostics.size}`,
    `duration=${diagnostics.duration ?? 'n/a'}`,
    `moov=${diagnostics.moovDetected ?? 'n/a'}`,
  ].join(' | ')
  throw new Error(`Render validation failed: ${detail}`)
}

export async function composeVideo(articles, outDir = 'output', options = {}) {
  fs.mkdirSync(outDir, { recursive: true })
  const article = articles[0]
  if (!article) throw new Error('No articles')

  if (!article.imageUrl) {
    await fetchBestImage(article)
  }

  const engine = new NewsBroadcastEngine()
  const result = await engine.generateFromArticle(article, outDir, { ...options, quick: !!process.env.QUICK_RENDER })
  const broadcastPath = typeof result === 'string' ? result : result.videoPath

  const finalPath = `${outDir}/final.mp4`
  fs.copyFileSync(broadcastPath, finalPath)
  await assertValidRender(finalPath, 'final-copy')

  return {
    engine,
    finalPath,
    hooks: [],
    retention: engine.lastRetention || null,
    musicTrack: engine.audioMixer.lastTrack?.file || null,
    musicFamily: engine.audioMixer.lastTrack?.family || engine.audioMixer.musicFamily || null,
  }
}

async function applyFooterOverlay(outDir) {
  const manifest = resolveRenderManifest({})
  const gates = resolveRenderGates({}, manifest)
  const footerPath = 'assets/footer.png'
  if (gates.overlayFooter && fs.existsSync(footerPath)) {
    const finalPath = `${outDir}/final.mp4`
    const withFooter = `${outDir}/final_with_footer.mp4`
    execFileSync(
      'ffmpeg',
      ['-y', '-i', finalPath, '-i', footerPath, '-filter_complex', '[0:v][1:v]overlay=0:main_h-overlay_h:format=auto,format=yuv420p[v]', '-map', '[v]', '-map', '0:a', '-c:a', 'copy', withFooter],
      { stdio: 'inherit' }
    )
    fs.copyFileSync(withFooter, finalPath)
    await assertValidRender(finalPath, 'footer-overlay')
  }
}

// Guard: only self-execute when run directly (`node scripts/composer.mjs`),
// never when imported by another script/tool (import.meta.url always ends
// with the module filename, so a filename check alone is wrong).
if (process.argv[1] && import.meta.url.endsWith(process.argv[1])) {
  const runFull = async () => {
    // Production preflight — validate all invariants before accepting traffic
    const { ProductionPreflight } = await import('../src/pipeline/ProductionPreflight.mjs')
    const preflight = await ProductionPreflight.run()
    if (!preflight.ok) {
      console.error('[PREFLIGHT] BLOCKED — production invariants not met:')
      for (const e of preflight.errors) console.error(`  - ${e}`)
      process.exit(1)
    }

    const { ProductionJob } = await import('../src/orchestrator/ProductionJob.mjs')
    const { ResourceGovernor } = await import('../src/governor/ResourceGovernor.mjs')
    const governor = new ResourceGovernor()

    const category = process.env.INPUT_CATEGORY || process.argv[2] || 'technology'
    const outDir = 'output'
    fs.mkdirSync(outDir, { recursive: true })

    await ensureMusicExists()

    let articles
    let preset = null

    // NewsData.io is the primary source (enforces a 3-hour fetch gap); the
    // RapidAPI Real-Time News Data provider is the second tier (100 req/day
    // free), and NewsAPI remains the final fallback.
    if (!articles) {
      try {
        const newsDataSvc = await import('../src/news/NewsDataProvider.mjs')
        if (newsDataSvc.isConfigured()) {
          articles = await newsDataSvc.fetchTopHeadlines({ category })
        }
      } catch (e) { console.log('NewsData error:', e.message) }
    }

    if (!articles) {
      try {
        const rapidSvc = await import('../src/news/RapidNewsProvider.mjs')
        if (rapidSvc.isConfigured()) {
          const rapidResult = await rapidSvc.fetchTopHeadlines({ category })
          if (rapidResult.skipped) {
            console.log(`[NEWS] RapidAPI skipped: ${rapidResult.reason}`)
          } else {
            articles = rapidResult.articles
            if (articles?.length) console.log(`[NEWS] RapidAPI "${category}" returned ${articles.length} articles`)
          }
        }
      } catch (e) { console.log('RapidNews error:', e.message) }
    }

    if (!articles && process.env.NEWSAPI_KEY) {
      try {
        const newsSvc = await import('../apps/api/services/news.js')
        const yesterday = new Date(Date.now() - 864e5).toISOString().slice(0, 10)
        const CATEGORY_QUERY = {
          tesla: ['search', 'tesla', { pageSize: 3, sortBy: 'publishedAt' }],
          apple: ['search', 'apple', { pageSize: 3, sortBy: 'popularity', from: yesterday, to: yesterday }],
          wsj: ['search', '', { pageSize: 3, sortBy: 'publishedAt', domains: 'wsj.com' }],
          techcrunch: ['headlines', { sources: 'techcrunch', pageSize: 3 }],
          business: ['headlines', { category: 'business', country: 'us', pageSize: 3 }],
        }
        // Try the requested category first, then fall back through the reliable
        // NewsAPI categories. Never abort on a single empty/rate-limited result.
        const FALLBACK_ORDER = [category, 'business', 'technology', 'general', 'science', 'health', 'sports']
        const tried = new Set()
        for (const cat of FALLBACK_ORDER) {
          if (tried.has(cat)) continue
          tried.add(cat)
          preset = CATEGORY_QUERY[cat]
          try {
            if (preset) {
              if (preset[0] === 'search') {
                articles = await newsSvc.searchNews(preset[1], preset[2])
                if (!articles.length && preset[2].from) {
                  console.log(`[NEWS] ${cat}: empty date-filtered result, retrying without date range`)
                  const { from, to, ...rest } = preset[2]
                  articles = await newsSvc.searchNews(preset[1], rest)
                }
              } else {
                articles = await newsSvc.fetchTopHeadlines(preset[1])
              }
            } else {
              articles = await newsSvc.fetchTopHeadlines({ category: cat, pageSize: 3 })
            }
            if (articles?.length) {
              if (cat !== category) console.log(`[NEWS] category "${category}" empty — fell back to "${cat}" (${articles.length} articles)`)
              break
            }
            console.log(`[NEWS] ${cat}: no articles, trying next fallback`)
            articles = null
          } catch (e) {
            console.log(`[NEWS] ${cat} error: ${e.message}`)
            articles = null
          }
        }
      } catch (e) { console.log('NewsAPI error:', e.message) }
    }

    if (articles?.length && !preset) {
      const techKeywords = ['ai', 'apple', 'google', 'microsoft', 'meta', 'tesla', 'nvidia', 'openai', 'chatgpt', 'iphone', 'samsung', 'robot', 'chip', 'software', 'update', 'launch', 'cyber', 'quantum', 'space', 'data', 'cloud', 'app', 'digital', 'tech', 'computer', 'phone', 'electric', 'gaming', 'console', 'startup', 'algorithm', 'neural', 'blockchain', 'autonomous', 'drone', 'satellite', 'battery', 'solar', 'ai', 'vr', 'ar', '5g', '6g', 'processor', 'gpu', 'cpu', 'security', 'privacy']
      articles = articles.filter(a => {
        const t = (a.title || '').toLowerCase()
        return techKeywords.some(k => t.includes(k))
      })
      if (articles.length === 0) {
        console.log('No tech articles found, using fallback')
        articles = null
      }
    }

    // Dedup: skip articles already published in the last 24h (stale free-plan
    // feeds like TechCrunch keep returning the same headlines — the channel
    // should not repost the identical story every 30 minutes).
    try {
      const { PublishEventsStore } = await import('../src/publishing/PublishEventsStore.mjs')
      const cutoff = Date.now() - 864e5
      const used = new Set()
      for (const ev of new PublishEventsStore().events) {
        const ts = ev.publishedAt ? new Date(ev.publishedAt).getTime() : 0
        if (ts > cutoff && ev.title) used.add(String(ev.title).trim().toLowerCase())
      }
      if (used.size) {
        const fresh = (articles || []).filter(a => !used.has(String(a.title || '').trim().toLowerCase()))
        if (fresh.length) {
          console.log(`[DEDUP] skipped ${articles.length - fresh.length} already-published article(s)`)
          articles = fresh
        } else {
          console.log('[DEDUP] all fetched articles were published in the last 24h — aborting to prevent duplicate publish')
          articles = null
        }
      }
    } catch { /* dedup is best-effort */ }

    if (!articles?.length) {
      // Never publish placeholder junk. If a manual override title was passed
      // (process.argv[2]) that's an explicit operator decision; otherwise abort.
      const override = process.argv[2]?.trim()
      if (override && !process.env.NEWSAPI_KEY) {
        articles = [{
          title: override,
          description: process.argv[3] || 'A story from the NEWS-MONSTER pipeline.',
          source: 'Operator override',
          url: '',
          imageUrl: null,
          category,
          publishedAt: new Date().toISOString(),
        }]
      } else {
        throw new Error(
          `No articles returned for category "${category}" — aborting instead of publishing placeholder content` +
          (process.env.NEWSAPI_KEY ? ' (NewsAPI empty or rate-limited)' : ' (no news source configured)')
        )
      }
    }

    for (const rawArticle of articles) {
      const article = {
        title: rawArticle.title,
        description: rawArticle.description || rawArticle.title,
        source: rawArticle.source?.name || rawArticle.source || 'NewsAPI',
        url: rawArticle.url || '',
        imageUrl: rawArticle.imageUrl || rawArticle.urlToImage || null,
        category: rawArticle.category || category,
        publishedAt: rawArticle.publishedAt || new Date().toISOString(),
      }

      console.log(`\nProcessing: "${article.title?.slice(0, 80)}..."`)

      // ── Experiment + Metrics collection ──
      let experimentManager = null
      let metrics = null
      let experimentId = null
      let variant = 'control'
      try {
        const { ExperimentManager } = await import('../src/experiment/ExperimentManager.mjs')
        const { MetricsCollector } = await import('../src/experiment/MetricsCollector.mjs')
        experimentManager = new ExperimentManager({ outDir })
        metrics = new MetricsCollector()
        experimentId = experimentManager.experimentId
        const assignment = experimentManager.assignVariant(article.title)
        variant = assignment.variant
        if (assignment.hash) {
          console.log(`[EXPERIMENT] ${experimentId} variant=${variant} hash=${assignment.hash}`)
        }
      } catch { /* experiment tracking unavailable */ }

      // ── ProductionJob orchestrator — stage checkpoints + retry + quarantine ──
      const job = new ProductionJob(article, { outDir, governor })

      // ── Channel control plane — shared YouTube quota coordination ──
      let channel = null
      let channelReservation = null
      try {
        channel = new ChannelController()
      } catch { /* channel control unavailable — proceed without coordination */ }

      // ── DISCOVER — AI production strategy + deterministic preflight ──
      job.onStage('DISCOVER', async (ctx) => {
        const { ProductionStrategyController } = await import('../src/ai/ProductionStrategyController.mjs')
        const { AssetRegistry } = await import('../src/uniqueness/AssetRegistry.mjs')

        // Build controller with available intelligence
        let performanceMemory = null
        let profileOptimizer = null
        try {
          const { PerformanceMemory } = await import('../src/production/PerformanceMemory.mjs')
          performanceMemory = new PerformanceMemory()
        } catch { /* memory unavailable */ }

        try {
          const { ProfileOptimizer } = await import('../src/production/ProfileOptimizer.mjs')
          profileOptimizer = new ProfileOptimizer()
        } catch { /* optimizer unavailable */ }

        const registryPath = path.join(outDir, '.asset-registry.json')
        let assetRegistry = null
        try {
          assetRegistry = new AssetRegistry({ filePath: registryPath })
        } catch { /* registry unavailable */ }

        const controller = new ProductionStrategyController({
          performanceMemory,
          profileOptimizer,
          resourceGovernor: governor || null,
          assetRegistry,
        })

        // Inject AI strategy layer when enabled
        let aiLayer = null
        const aiEnabled = process.env.AI_STRATEGY_ENABLED === 'true'
        if (aiEnabled) {
          try {
            const { AiStrategyLayer } = await import('../src/ai/AiStrategyLayer.mjs')
            const { ProviderChain } = await import('../src/ai/providers/ProviderChain.mjs')
            const chain = new ProviderChain()
            if (chain.providers.length > 0) {
              aiLayer = new AiStrategyLayer({ providerChain: chain })
              console.log(`[AI-STRATEGY] ENABLED — providers: ${chain.name}`)
            } else {
              console.log('[AI-STRATEGY] ENABLED but no providers available — using deterministic fallback')
            }
          } catch (e) {
            console.log(`[AI-STRATEGY] ENABLED but init failed: ${e.message} — using deterministic fallback`)
          }
        } else {
          console.log('[AI-STRATEGY] DISABLED — using deterministic strategy')
        }

        // Rebuild controller with AI layer if available
        const finalController = aiLayer
          ? new ProductionStrategyController({
              performanceMemory,
              profileOptimizer,
              resourceGovernor: governor || null,
              assetRegistry,
              aiLayer,
            })
          : controller

        // Produce strategy plan
        const plan = await finalController.planProduction(article, { jobId: ctx.jobId })
        const decisionTrace = finalController.getDecisionTrace()
        console.log(`[STRATEGY] source=${plan.hookStrategy.source} niche=${plan.niche.key} hook=${plan.hookStrategy.style} thumbnail=${plan.thumbnailStrategy.layout} confidence=${plan.confidence}`)
        if (decisionTrace.aiCalled) {
          console.log(`[STRATEGY] AI provider=${decisionTrace.aiProvider} latency=${decisionTrace.aiLatencyMs}ms received=${decisionTrace.recommendationsReceived} accepted=${decisionTrace.recommendationsAccepted} rejected=${decisionTrace.recommendationsRejected}`)
        }
        console.log(`[STRATEGY] reasoning: ${plan.reasoning}`)

        // Record metrics
        if (metrics) {
          metrics.setMetadata('niche', plan.niche.key)
          metrics.setMetadata('hookStyle', plan.hookStrategy.style)
          metrics.setMetadata('planSource', plan.hookStrategy.source)
          if (decisionTrace.aiCalled) {
            metrics.recordAI({
              provider: decisionTrace.aiProvider,
              latencyMs: decisionTrace.aiLatencyMs,
              fallback: decisionTrace.fallbackUsed,
              recommendationsReceived: decisionTrace.recommendationsReceived,
              recommendationsAccepted: decisionTrace.recommendationsAccepted,
              recommendationsRejected: decisionTrace.recommendationsRejected,
              rejectionReasons: decisionTrace.rejectionReasons,
            })
          }
        }

        return {
          plan,
          strategy: plan.hookStrategy.style,
          niche: plan.niche.key,
          decisionTrace,
          controller: finalController,
          aiEnabled: !!aiLayer,
          variant,
        }
      })

      // ── RENDER — core video production + post-render footer overlay ──
      job.onStage('RENDER', async (ctx) => {
        const plan = ctx.results.DISCOVER?.plan
        const renderOptions = { quick: !!process.env.QUICK_RENDER }
        if (plan) {
          renderOptions.strategy = {
            sceneStrategy: plan.sceneStrategy,
            visualStrategy: plan.visualStrategy,
            hookStrategy: plan.hookStrategy,
            profile: plan.profile,
            qualityTargets: plan.qualityTargets,
          }
          console.log(`[RENDER] consuming plan: ${plan.sceneStrategy.sceneCount} scenes, density=${plan.sceneStrategy.density}, motion=${plan.sceneStrategy.motion}`)
        }
        const renderStart = Date.now()
        const result = await composeVideo([article], outDir, renderOptions)
        const renderTime = Date.now() - renderStart
        console.log(`[RENDER] video produced in ${renderTime}ms → ${result.finalPath}`)

        // Post-render: optional footer overlay (RenderManifest gate)
        await applyFooterOverlay(outDir)

        // Return engine — all downstream stages read artifacts from it
        return { engine: result.engine, renderTimeMs: renderTime }
      })

      // ── THUMBNAIL — mandatory production stage, always executes ──
      job.onStage('THUMBNAIL', async (ctx) => {
        const { engine } = ctx.results.RENDER
        const thumbPath = `${outDir}/thumbnail.png`
        const coverPath = `${outDir}/cover.png`
        const candidate = fs.existsSync(thumbPath) ? thumbPath : (fs.existsSync(coverPath) ? coverPath : null)
        if (!candidate) {
          console.warn('[THUMBNAIL] no thumbnail produced by engine — upload will fail')
          return { candidates: [], selected: null, strategy: 'none' }
        }
        // Inspect the ACTUAL file (never hardcode the geometry — the canonical
        // Short thumbnail is 9:16 2160x3840). This becomes the artifact's
        // immutable identity (sha256 + dimensions + mime).
        const { inspectThumbnailFile } = await import('../src/thumbnail/ThumbnailMetadata.mjs')
        const meta = await inspectThumbnailFile(candidate)
        const selected = { path: candidate, width: meta.width, height: meta.height, mimeType: meta.mimeType, sha256: meta.sha256, aspectRatio: meta.aspectRatio }
        // Enforce the Short thumbnail geometry contract (9:16 2160x3840).
        const { enforceThumbnailProfile, ThumbnailValidationError } = await import('../src/thumbnail/ThumbnailProfile.mjs')
        try {
          enforceThumbnailProfile(
            { width: selected.width, height: selected.height },
            selected
          )
        } catch (e) {
          if (e instanceof ThumbnailValidationError) {
            console.warn(`[THUMBNAIL] ${e.code}: ${e.message}`)
          } else throw e
        }
        console.log(`[THUMBNAIL] consumed engine output: ${selected.path} (${selected.width}x${selected.height} ${selected.mimeType}) sha256=${selected.sha256.slice(0, 12)}…`)
        if (engine?.productionTrace) engine.productionTrace.setThumbnailGenerated()
        return { candidates: [selected], selected, strategy: 'engine-generated' }
      })

      // ── C2PA ──
      job.onStage('C2PA', async (ctx) => {
        const { engine } = ctx.results.RENDER
        const coverPath = ctx.results.THUMBNAIL?.selected?.path
        if (!coverPath || process.env.C2PA_ENABLED === 'false') {
          return { signed: false, path: coverPath, skipped: true }
        }
        const { ProductionSigner } = await import('../src/pipeline/ProductionSigner.mjs')
        const { ContentCredentials } = await import('../src/pipeline/ContentCredentials.mjs')
        const signStart = Date.now()
        const c2paResult = await ProductionSigner.sign({
          input: coverPath, article,
          productionContext: engine?.productionContext,
          productionTrace: engine?.productionTrace,
        })
        const signMs = Date.now() - signStart
        let verifyResult = { valid: false }
        let verifyMs = null
        if (c2paResult.signed && process.env.C2PA_VERIFY_AFTER_SIGN !== 'false') {
          const vStart = Date.now()
          verifyResult = await ContentCredentials.verify(c2paResult.path)
          verifyMs = Date.now() - vStart
          console.log(`[C2PA] verification: ${verifyResult.valid ? 'PASS' : 'FAIL'} (${verifyMs}ms, ${verifyResult.error || 'ok'})`)
        }
        if (c2paResult.signed) console.log(`[C2PA] signed thumbnail: ${c2paResult.path} (${signMs}ms)`)
        if (engine?.productionTrace) {
          engine.productionTrace.setProvenance({
            signed: c2paResult.signed, verified: verifyResult.valid,
            manifestId: c2paResult.manifestId,
            error: c2paResult.error || verifyResult.error || null,
            signMs, verifyMs, reason: c2paResult.reason || null,
            validationState: verifyResult.manifest?.validationState || null,
            failures: verifyResult.manifest?.failures || [],
          })
        }
        if (process.env.C2PA_REQUIRED === 'true') {
          const signOk = c2paResult.signed
          const verifyOk = verifyResult.valid || process.env.C2PA_VERIFY_AFTER_SIGN === 'false'
          if (!signOk || !verifyOk) {
            const gateReason = !signOk ? `signing failed: ${c2paResult.error || c2paResult.reason || 'unknown'}`
              : `verification failed: ${verifyResult.error || 'unknown'}`
            if (engine?.productionTrace) engine.productionTrace.setProvenance({ gateBlocked: true, gateReason })
            throw new Error(`C2PA required but ${gateReason} — blocking publish`)
          }
          if (engine?.productionTrace) engine.productionTrace.setProvenance({ gateBlocked: false, gateReason: null })
        }
         return {
          signed: c2paResult.signed, path: c2paResult.path || coverPath,
          signMs, verifyMs, verified: verifyResult.valid,
        }
      })

      // ── UNIQUENESS ──
      job.onStage('UNIQUENESS', async (ctx) => {
        const { engine } = ctx.results.RENDER
        const { AssetRegistry } = await import('../src/uniqueness/AssetRegistry.mjs')
        const { ProductionUniquenessManifest } = await import('../src/uniqueness/ProductionUniquenessManifest.mjs')
        const { GlobalAssetUniquenessGate } = await import('../src/uniqueness/GlobalAssetUniquenessGate.mjs')
        const { ImageDatabase } = await import('../src/assets/ImageDatabase.mjs')

        const registryPath = path.join(outDir, '.asset-registry.json')
        const imageDbPath = path.join(outDir, 'image-index.db')
        const registry = new AssetRegistry({ filePath: registryPath })
        const imageDb = fs.existsSync(imageDbPath) ? new ImageDatabase(imageDbPath) : null
        const gate = new GlobalAssetUniquenessGate(registry, imageDb)

        const scenes = engine?.productionContext?.scenes || []
        const narrationScript = engine?.productionContext?.narrationScript || ''
        const musicTrack = engine?.audioMixer?.lastTrack?.file || null
        const musicFamily = engine?.audioMixer?.lastTrack?.family || engine?.audioMixer?.musicFamily || null
        const thumbnail = ctx.results.THUMBNAIL?.selected || null

        // Build uniqueness manifest
        const manifest = new ProductionUniquenessManifest()
          .setArticle(article)
          .setScript(narrationScript)
          .setJobId(ctx.jobId)

        for (const s of scenes) {
          manifest.addScene(s.id || s.sceneIndex, {
            imageHash: s.imageHash || s.heroImageHash || null,
            sourceId: s.imageSource || null,
            headline: s.headline || s.caption || null,
          })
        }
        if (musicTrack) manifest.setMusic(musicTrack, { family: musicFamily })

        // Thumbnail hashes for cross-video uniqueness
        let thumbCompositionHash = null
        let thumbPerceptualHash = null
        if (thumbnail?.path && fs.existsSync(thumbnail.path)) {
          const thumbData = fs.readFileSync(thumbnail.path)
          thumbCompositionHash = AssetRegistry.hash(thumbData.toString('base64').slice(0, 4096))
          thumbPerceptualHash = AssetRegistry.hash(thumbData.toString('base64').slice(0, 2048))
          manifest.setThumbnail(thumbCompositionHash)
        }

        // Run full 6-scope uniqueness validation
        const builtManifest = manifest.build()
        const validation = await gate.validate(builtManifest, {
          jobId: ctx.jobId,
          thumbnailPath: thumbnail?.path,
          scenes,
        })

        // Log scope results
        for (const s of validation.scopeResults) {
          const icon = s.pass ? 'PASS' : (s.enforcement === 'BEST_EFFORT' ? 'WARN' : 'FAIL')
          console.log(`[UNIQUENESS] ${s.scope}: ${icon} — ${s.detail}`)
        }

        if (!validation.pass) {
          console.log(`[UNIQUENESS] BLOCKED — ${validation.violations.length} violations:`)
          for (const v of validation.violations) {
            console.log(`  - ${v.type}: ${v.detail || v.reason}`)
          }
          if (validation.warnings.length) {
            console.log(`[UNIQUENESS] ${validation.warnings.length} best-effort warnings (non-blocking)`)
          }
          const quarantineId = `unq-${ctx.jobId}-${Date.now()}`
          return { pass: false, violations: validation.violations, quarantineId, scopeResults: validation.scopeResults }
        }

        if (validation.warnings.length) {
          console.log(`[UNIQUENESS] ${validation.warnings.length} best-effort warnings (non-blocking)`)
        }

        // Reserve assets — blocks other jobs until commit() or release()
        const reservation = gate.reserve(ctx.jobId, {
          scriptHash: builtManifest.scriptHash,
          imageHashes: builtManifest.scenes?.map(s => s.imageHash).filter(Boolean) || [],
          musicTrackId: builtManifest.music?.trackId,
          thumbnailHash: thumbPerceptualHash,
          thumbnailCompositionHash: thumbCompositionHash,
        })
        if (!reservation.reserved) {
          console.log(`[UNIQUENESS] RESERVE CONFLICT — ${reservation.conflict}`)
          return { pass: false, violations: [{ type: 'RESERVATION', reason: reservation.conflict }], scopeResults: validation.scopeResults }
        }

        console.log(`[UNIQUENESS] PASS + RESERVED — ${scenes.length} scenes + music + script + thumbnail locked for job ${ctx.jobId}`)
        if (imageDb) { try { imageDb.close() } catch {} }
        return { pass: true, reserved: true, violations: [], scopeResults: validation.scopeResults, thumbnailHash: thumbCompositionHash }
      })

      // ── UPLOAD — consumes plan.providerPreferences for governor-aware selection ──
      // Channel reservation: reserve slot just before external upload (after UNIQUENESS)
      if (channel) {
        job.onPrecondition('UPLOAD', async (ctx) => {
          try {
            const check = await channel.canReserve('news')
            if (!check.allowed) {
              console.log(`[CHANNEL] BLOCK — ${check.reason}`)
              return { valid: false, checks: { channel: false }, missing: [`channel: ${check.reason}`] }
            }
            console.log(`[CHANNEL] PASS — ${check.remaining} slots remaining for news`)
            return { valid: true, checks: { channel: true }, missing: [] }
          } catch (e) {
            console.warn(`[CHANNEL] precondition check failed (proceeding): ${e.message}`)
            return { valid: true, checks: { channel: true }, missing: [] }
          }
        })
      }

      job.onStage('UPLOAD', async (ctx) => {
        const { engine } = ctx.results.RENDER
        const plan = ctx.results.DISCOVER?.plan

        // Hard invariant: UPLOAD requires both video and thumbnail
        const videoPath = `${outDir}/final.mp4`
        const thumbnail = ctx.results.THUMBNAIL?.selected?.path
        if (!fs.existsSync(videoPath)) throw new Error('UPLOAD_REQUIRES_VIDEO')
        if (!thumbnail) throw new Error('UPLOAD_REQUIRES_THUMBNAIL — thumbnail generation must succeed before upload')

        const { ProductionPreflight } = await import('../src/ai/ProductionPreflight.mjs')
        const publishPreflight = await ProductionPreflight.check({}, { outDir, stage: 'publish' })
        if (!publishPreflight.ready) throw new Error(`Publish preflight failed: ${publishPreflight.errors.join(', ')}`)

        const { publishVideo } = await import('../apps/api/publishers/youtube.js')
        const buffer = fs.readFileSync(videoPath)
        const uploadTitle = `${article.title?.slice(0, 90) || 'News Update'} | NEWS-MONSTER`
        const { HashtagBuilder } = await import('../src/publishing/HashtagBuilder.mjs')
        const nicheDecision = engine?.productionContext?.niche || null
        const hashtags = HashtagBuilder.build({
          topic: HashtagBuilder.topicFromHeadline(article.title),
          category: category || nicheDecision?.key || 'tech',
          pipelineProfile: 'breaking',
          channel: 'NEWS-MONSTER',
        })
        const desc = `${uploadTitle}\n\nSource: ${article.source || 'NewsAPI'}\n\n${hashtags}`

        // Journal: record operation start for crash recovery
        if (ctx.governor) {
          ctx.governor.recordStart(ctx.jobId, 'youtube.upload', 'youtube', { title: uploadTitle })
        }

        // Pre-publish record: write dedup marker BEFORE upload so crash
        // during upload is caught by dedup on retry. VideoId is filled in after.
        try {
          const { PublishEventsStore } = await import('../src/publishing/PublishEventsStore.mjs')
          new PublishEventsStore().record({
            videoId: null,
            title: article.title?.slice(0, 100),
            category: category || 'technology',
            pending: true,
          })
        } catch { /* best-effort */ }

        const uploadStart = Date.now()
        let result
        try {
          // Channel reservation: claim slot before external upload
          if (channel) {
            try {
              channelReservation = await channel.reserve('news', ctx.jobId, { title: uploadTitle })
              console.log(`[CHANNEL] RESERVED slot ${channelReservation.publicationId} for job ${ctx.jobId}`)
            } catch (e) {
              console.warn(`[CHANNEL] reserve failed (proceeding without coordination): ${e.message}`)
            }
          }

          result = await publishVideo({
            videoUrl: `data:video/mp4;base64,${buffer.toString('base64')}`,
            title: uploadTitle, description: desc,
            privacy: process.env.YOUTUBE_PRIVACY || 'public',
            // Always use the ORIGINAL thumbnail for YouTube — C2PA-signed PNGs
            // have embedded manifest data that YouTube's thumbnail API can't render.
            thumbnailPath: ctx.results.THUMBNAIL?.selected?.path || ctx.results.C2PA?.path,
            niche: nicheDecision?.key || null,
          })
        } catch (uploadErr) {
          // Release channel slot on failure
          if (channel && channelReservation) {
            try { await channel.release('news', ctx.jobId) } catch { /* best-effort */ }
            channelReservation = null
          }
          if (ctx.governor) ctx.governor.recordFail(ctx.jobId, 'youtube.upload', 'youtube', uploadErr, Date.now() - uploadStart)
          throw uploadErr
        }

        // Journal: record remote_id immediately after successful upload
        if (ctx.governor) {
          ctx.governor.recordComplete(ctx.jobId, 'youtube.upload', 'youtube', result.videoId, 'uploaded', Date.now() - uploadStart)
        }

        // Commit channel reservation
        if (channel && channelReservation) {
          try {
            await channel.commit('news', ctx.jobId, channelReservation.publicationId, {
              youtubeVideoId: result.videoId,
              title: uploadTitle,
              artifactId: `artifact:video:${ctx.jobId}`,
            })
            console.log(`[CHANNEL] COMMITTED publication ${channelReservation.publicationId} → ${result.videoId}`)
          } catch (e) {
            console.warn(`[CHANNEL] commit failed (upload succeeded): ${e.message}`)
          }
          channelReservation = null
        }

        console.log(`[UPLOAD] videoId=${result.videoId} url=${result.url} niche=${result.niche || 'none'} thumbnail=${result.thumbnailUploaded ? 'uploaded' : result.lastError ? 'FAILED: ' + result.lastError : 'skipped'}`)
        if (engine?.productionTrace) engine.productionTrace.setYouTube(result)
        return { uploadTitle, hashtags, nicheDecision, ...result }
      })

      // ── PUBLISH — gated by publishability, then cross-platform distribution ──
      // The gate is a precondition, not the first lines of the handler: if any
      // predicate is false the handler is never invoked and the trace records
      // exactly which predicates failed.
      {
        const { PublishabilityGate } = await import('../src/orchestrator/PublishabilityGate.mjs')
        const publishability = new PublishabilityGate()
        job.onPrecondition('PUBLISH', (ctx) => {
          const gateResult = publishability.evaluate(ctx.results)
          if (gateResult.valid) console.log('[PUBLISH-GATE] PASS — all publishability checks passed')
          else console.error(`[PUBLISH-GATE] BLOCK — failed: ${gateResult.missing.join(', ')}`)
          return gateResult
        })
      }

      job.onStage('PUBLISH', async (ctx) => {
        const { engine } = ctx.results.RENDER
        const plan = ctx.results.DISCOVER?.plan
        const { videoId, uploadTitle, hashtags, nicheDecision } = ctx.results.UPLOAD
        const coverPath = ctx.results.C2PA?.path || ctx.results.THUMBNAIL?.selected?.path
        const buffer = fs.readFileSync(`${outDir}/final.mp4`)

        // LinkedIn — luxury image post with thumbnail (not video base64)
        let linkedinPostId = null
        if (process.env.LINKEDIN_ACCESS_TOKEN && process.env.LINKEDIN_MEMBER_URN) {
          try {
            const { shareImage, updatePostCommentary } = await import('../apps/api/publishers/linkedin.js')
            const { LinkedInPostFactory } = await import('../src/publishing/LinkedInPostFactory.mjs')
            const factory = new LinkedInPostFactory()
            const thumbPath = ctx.results.THUMBNAIL?.selected?.path || ctx.results.C2PA?.path || 'output/cover.png'
            const liPost = factory.videoPost({
              title: article.title || uploadTitle,
              summary: (article.description || '').slice(0, 200),
              category: category || 'technology',
              videoUrl: `https://youtu.be/${videoId}`,
              youtubeShortsUrl: `https://www.youtube.com/shorts/${videoId}`,
              hashtags: (hashtags || '').split(/\s+/).filter(Boolean),
              thumbnailPath: thumbPath,
            })
            const li = await shareImage(
              process.env.LINKEDIN_ACCESS_TOKEN, process.env.LINKEDIN_MEMBER_URN,
              `file://${thumbPath}`, liPost.commentary, `https://youtu.be/${videoId}`
            )
            const postId = li?.id || li?.urn
            if (postId) {
              linkedinPostId = postId
              try {
                await updatePostCommentary(process.env.LINKEDIN_ACCESS_TOKEN, postId,
                  `${liPost.commentary}\n\nhttps://www.linkedin.com/feed/update/${postId}`)
                console.log(`[LINKEDIN] image post=${postId} — https://www.linkedin.com/feed/update/${postId}`)
              } catch (ue) { console.log(`[LINKEDIN] posted ${postId} (link append skipped: ${ue.message})`) }
            } else {
              console.log(`[LINKEDIN] image post=ok — https://www.linkedin.com/feed/update/${li?.id || li?.urn}`)
            }
          } catch (e) {
            console.log(`[LINKEDIN] skipped (best-effort): ${e.message}`)
            if (engine?.productionTrace) engine.productionTrace.setLinkedIn({ attempted: true, success: false, error: e.message })
          }
        } else {
          console.log('[LINKEDIN] skipped — LINKEDIN_ACCESS_TOKEN/LINKEDIN_MEMBER_URN not set')
        }

        // Social distribution
        try {
          const { SocialDistributionManager } = await import('../src/publishing/SocialDistributionManager.mjs')
          const sdm = new SocialDistributionManager()
          const dist = await sdm.distribute({
            videoId, title: article.title || uploadTitle,
            videoUrl: ctx.results.UPLOAD?.url, thumbnailPath: coverPath,
            category: category || nicheDecision?.key || 'technology',
            hook: `${article.title?.split(' ').slice(0, 5).join(' ') || 'This'} — here's what just happened.`,
            summary: (article.description || '').slice(0, 160) || `A story you should see from the desk of NEWS-MONSTER.`,
          })
          sdm.close()
          for (const [platform, r] of Object.entries(dist.results || {})) {
            console.log(`[DISTRIBUTE] ${platform}: ${r.status}${r.reason ? ` (${r.reason})` : ''}${r.postId ? ` postId=${r.postId}` : ''}${r.url ? ` url=${r.url}` : ''}`)
          }
        } catch (e) { console.log(`[DISTRIBUTE] skipped (best-effort): ${e.message}`) }

        // Pinned comment — use plan hook strategy for CTA
        let commentEvent = null
        if (videoId) {
          try {
            const { PinnedCommentBuilder } = await import('../src/publishing/PinnedCommentBuilder.mjs')
            const { TopicCtaBuilder } = await import('../src/publishing/TopicCtaBuilder.mjs')
            const { postComment } = await import('../apps/api/publishers/youtube.js')
            const cta = new TopicCtaBuilder().build(article)
            const comment = new PinnedCommentBuilder().build(article)
            const hookStyle = plan?.hookStrategy?.style || 'breaking'
            console.log(`[CTA] topic=${cta.topic} mode=${cta.mode} hook=${hookStyle} "${cta.narration}"`)
            console.log(`[PIN COMMENT] "${comment.question}"`)
            const posted = await postComment(videoId, comment.question)
            console.log(`[COMMENT INSERT] ${posted?.id ? `success commentId=${posted.id}` : 'failed — post it manually in Studio and pin it, then set YOUTUBE_PARENT_COMMENT_ID to its ID'}`)
            commentEvent = { text: comment.question, status: posted?.id ? 'published' : 'failed', commentId: posted?.id || null }
          } catch (e) { console.log('[PIN COMMENT] skipped:', e.message) }
        }
        return { commentEvent, videoId, url: `https://youtu.be/${videoId}`, youtubeUrl: `https://youtu.be/${videoId}`, linkedinPostId, uploaded: true }
      })

      // ── DISTRIBUTE — parallel fan-out to YouTube, GitHub Pages, LinkedIn ──
      // One artifact → all destinations. Each destination has independent state and retry.
      job.onStage('DISTRIBUTE', async (ctx) => {
        const { PublicationArtifact } = await import('../src/distribution/PublicationArtifact.mjs')
        const { DistributionOrchestrator } = await import('../src/distribution/DistributionOrchestrator.mjs')
        const { GitHubPagesDistributor } = await import('../src/distribution/GitHubPagesDistributor.mjs')

        // Build canonical artifact from production results
        const artifact = await PublicationArtifact.fromProductionResults(ctx.results, outDir)
        artifact.artifactId = ctx.results.UNIQUENESS?.assetId || ctx.results.UPLOAD?.videoId || artifact.artifactId

        // YouTube + LinkedIn already published in PUBLISH — record their results.
        // YouTube videoId/url live on UPLOAD (PUBLISH returns only linkedinPostId).
        const uploadResult = ctx.results.UPLOAD || {}
        const pubResult = ctx.results.PUBLISH || {}
        if (uploadResult.videoId) {
          artifact.destinations.youtube.state = 'SUCCESS'
          artifact.destinations.youtube.videoId = uploadResult.videoId
          artifact.destinations.youtube.url = uploadResult.url || `https://youtu.be/${uploadResult.videoId}`
          artifact.artifactId = artifact.artifactId || uploadResult.videoId
          artifact.destinations.youtube.thumbnail.state = uploadResult.thumbnailUploaded ? 'SUCCESS' : 'FAILED'
        }
        if (pubResult.linkedinPostId) {
          artifact.destinations.linkedin.state = 'SUCCESS'
          artifact.destinations.linkedin.postId = pubResult.linkedinPostId
        }
        // Propagate the canonical thumbnail identity (sha256/dims/mime) so the
        // ledger never records sha256:null for the YouTube destination.
        artifact.blessDestinations()

        // GitHub Pages — deterministic manifest + thumbnail copy
        const githubPagesDist = new GitHubPagesDistributor({ publicDir: 'public' })
        const distResult = await githubPagesDist.distribute(artifact, { jobId: ctx.jobId })

        console.log(`[DISTRIBUTE] ${distResult.state === 'SUCCESS' ? '✓' : '✗'} githubPages: ${distResult.state} (${distResult.durationMs}ms)`)

        return {
          artifact: artifact.toJSON(),
          distributionState: distResult.state,
          distributionResults: {
            youtube: artifact.destinations.youtube,
            githubPages: distResult,
            linkedin: artifact.destinations.linkedin,
          },
        }
      })

      // ── VERIFY — post-publication verification chain ──
      // Verifies: video reachable, visibility public, hasCustomThumbnail,
      // title matches, thumbnail artifact consistency. Records to PublicationLedger.
      job.onStage('VERIFY', async (ctx) => {
        const { videoId, uploadTitle } = ctx.results.UPLOAD || {}
        if (!videoId) return { verified: false, reason: 'no videoId' }

        // 1. Uniqueness reservation commit
        if (ctx.results.UNIQUENESS?.reserved) {
          try {
            const { AssetRegistry } = await import('../src/uniqueness/AssetRegistry.mjs')
            const registryPath = path.join(outDir, '.asset-registry.json')
            const registry = new AssetRegistry({ filePath: registryPath })
            registry.commit(ctx.jobId, {
              videoId,
              category: category || ctx.results.UPLOAD?.nicheDecision?.key || 'technology',
            })
            console.log(`[UNIQUENESS] COMMITTED — reservation locked for job ${ctx.jobId} video=${videoId}`)
          } catch (e) {
            console.log(`[UNIQUENESS] commit failed (non-fatal): ${e.message}`)
          }
        }

        // 2. YouTube thumbnail verification (propagation-aware with retries).
        // Pass the canonical SHA-256 + expected geometry so the verifier
        // downloads the remote asset and proves acceptance. Acceptance is
        // geometry-based — YouTube may re-encode, so a differing remote SHA
        // records identity 'REENCODED' rather than failing.
        const { YouTubePropagationVerifier, VerifyState, ThumbnailIdentity } = await import('../src/publishing/YouTubePropagationVerifier.mjs')
        const { sha256Thumbnail } = await import('../src/thumbnail/ThumbnailMetadata.mjs')
        const { ThumbnailProfile } = await import('../src/thumbnail/ThumbnailProfile.mjs')
        let thumbnailResult = { state: VerifyState.VIDEO_NOT_VISIBLE_YET, hasCustomThumbnail: false, verifiedUrl: null, remoteSha256: null, thumbnailMatches: false }
        const masterThumb = ctx.results.THUMBNAIL?.selected?.path || null
        const masterThumbSha = masterThumb ? sha256Thumbnail(masterThumb) : null
        const shortProfile = ThumbnailProfile.SHORT
        if (masterThumb) {
          try {
            const { getAccessToken } = await import('../apps/api/publishers/youtube.js')
            const token = await getAccessToken()
            const verifier = new YouTubePropagationVerifier({
              token,
              expectedWidth: shortProfile.width,
              expectedHeight: shortProfile.height,
              expectedAspectRatio: shortProfile.aspectRatio,
            })
            thumbnailResult = await verifier.verify({ videoId, sha256: masterThumbSha, thumbnailPath: masterThumb })

            if (thumbnailResult.state === VerifyState.CUSTOM_THUMBNAIL_ACCEPTED) {
              const idLabel = thumbnailResult.identity === ThumbnailIdentity.EXACT
                ? `sha256 MATCH ${masterThumbSha?.slice(0, 12)}…`
                : thumbnailResult.identity === ThumbnailIdentity.REENCODED
                  ? `accepted on geometry (remote ${thumbnailResult.remoteWidth || '?'}x${thumbnailResult.remoteHeight || '?'}, sha re-encoded: ${thumbnailResult.remoteSha256?.slice(0, 12)}…)`
                  : ''
              console.log(`[THUMBNAIL] ${VerifyState.CUSTOM_THUMBNAIL_ACCEPTED} — hasCustomThumbnail=true ${idLabel}for ${videoId} (identity=${thumbnailResult.identity || 'UNKNOWN'})`)
              if (thumbnailResult.verifiedUrl) console.log(`   verified URL: ${thumbnailResult.verifiedUrl}`)
            } else if (thumbnailResult.state === VerifyState.CUSTOM_THUMBNAIL_REJECTED) {
              console.warn(`[THUMBNAIL] ${VerifyState.CUSTOM_THUMBNAIL_REJECTED} — video visible but no custom thumbnail`)
            } else if (thumbnailResult.state === VerifyState.VIDEO_NOT_VISIBLE_YET) {
              console.warn(`[THUMBNAIL] ${VerifyState.VIDEO_NOT_VISIBLE_YET} — ${thumbnailResult.attempts.length} attempts, ${thumbnailResult.durationMs}ms`)
            } else if (thumbnailResult.state === VerifyState.CUSTOM_THUMBNAIL_UNKNOWN || thumbnailResult.state === VerifyState.CUSTOM_THUMBNAIL_PENDING) {
              console.warn(`[THUMBNAIL] ${thumbnailResult.state} — remote asset not hashable: ${thumbnailResult.attempts?.[thumbnailResult.attempts.length - 1]?.remoteError || 'n/a'}`)
            } else if (thumbnailResult.errorType) {
              console.warn(`[THUMBNAIL] ${thumbnailResult.state} (${thumbnailResult.errorType}) — ${thumbnailResult.reason || thumbnailResult.message}`)
            } else {
              console.warn(`[THUMBNAIL] ${thumbnailResult.state}`)
            }
          } catch (e) {
            thumbnailResult = { state: VerifyState.VERIFICATION_FAILED, error: e.message, hasCustomThumbnail: false, verifiedUrl: null, remoteSha256: null, thumbnailMatches: false }
            console.log(`[THUMBNAIL] verification error: ${e.message}`)
          }
        }

        // 3. Post-publish verification chain (propagation-aware, not quota-gated)
        let verification = { passed: false, reason: 'skipped' }
        try {
          const { PostPublishVerifier } = await import('../src/publishing/PostPublishVerifier.mjs')
          const { getAccessToken } = await import('../apps/api/publishers/youtube.js')
          const token = await getAccessToken()
          const verifier = new PostPublishVerifier({
            token,
            expectedWidth: shortProfile.width,
            expectedHeight: shortProfile.height,
            expectedAspectRatio: shortProfile.aspectRatio,
          })
          const thumbPath = masterThumb || null
          verification = await verifier.verify({
            videoId,
            expectedTitle: uploadTitle || title,
            expectedVisibility: 'public',
            thumbnailPath: thumbPath,
            expectedThumbnailSha256: masterThumbSha || undefined,
            jobId: ctx.jobId,
          })
          const status = verification.passed ? 'PASS' : 'FAIL'
          console.log(`[VERIFY] ${status} — videoId=${videoId} checks=${Object.keys(verification.checks).join(',')} (${verification.durationMs}ms)`)
          if (!verification.passed) {
            console.log(`[VERIFY] failures: ${verification.failures.join('; ')}`)
          }
        } catch (e) {
          verification = { passed: false, reason: e.message }
          console.log(`[VERIFY] error: ${e.message}`)
        }

        // 4. Record to PublicationLedger with verified thumbnail URL
        // Publication succeeds even if verification is API_UNAVAILABLE — the video is uploaded.
        const verifiedThumbnailUrl = thumbnailResult.verifiedUrl || null
        const verificationState = thumbnailResult.state === VerifyState.CUSTOM_THUMBNAIL_ACCEPTED
          ? thumbnailResult.identity === ThumbnailIdentity.REENCODED
            ? 'VERIFIED (REENCODED)'
            : 'VERIFIED'
          : thumbnailResult.state === VerifyState.CUSTOM_THUMBNAIL_REJECTED
            ? 'REJECTED'
            : thumbnailResult.state === VerifyState.VIDEO_NOT_VISIBLE_YET
              ? 'VIDEO_NOT_VISIBLE_YET'
              : thumbnailResult.state === VerifyState.CUSTOM_THUMBNAIL_PENDING
                ? 'THUMBNAIL_PENDING'
                : thumbnailResult.state === VerifyState.CUSTOM_THUMBNAIL_UNKNOWN
                  ? 'THUMBNAIL_UNKNOWN'
                  : thumbnailResult.state === VerifyState.VERIFICATION_FAILED && thumbnailResult.errorType
                    ? 'API_UNAVAILABLE'
                    : 'PENDING'
        const thumbnailState = thumbnailResult.state === VerifyState.CUSTOM_THUMBNAIL_ACCEPTED
          ? 'CUSTOM_THUMBNAIL_ACCEPTED'
          : thumbnailResult.state === VerifyState.CUSTOM_THUMBNAIL_REJECTED
            ? 'CUSTOM_THUMBNAIL_REJECTED'
            : thumbnailResult.state === VerifyState.CUSTOM_THUMBNAIL_PENDING || thumbnailResult.state === VerifyState.CUSTOM_THUMBNAIL_UNKNOWN
              ? 'CUSTOM_THUMBNAIL_PENDING'
              : thumbnailResult.hasCustomThumbnail
                ? 'CUSTOM_THUMBNAIL_ACCEPTED'
                : 'UPLOADED'
        try {
          const { PublicationLedger } = await import('../src/publishing/PublicationLedger.mjs')
          // Persist to run-scoped ledger AND top-level data/ (GitHub cache persists data/)
          const ledgerPaths = [
            path.join(outDir, 'data', 'publication-ledger.json'),
            path.join('data', 'publication-ledger.json'),
          ]

          // Include distribution state from DISTRIBUTE stage
          const distribution = ctx.results.DISTRIBUTE?.distributionResults || {
            youtube: { state: 'PENDING' },
            githubPages: { state: 'PENDING' },
            linkedin: { state: 'PENDING' },
          }

          const record = {
            videoId,
            jobId: ctx.jobId,
            title: uploadTitle || title,
            category: category || 'technology',
            thumbnail: verifiedThumbnailUrl || `https://i.ytimg.com/vi/${videoId}/maxresdefault.jpg`,
            thumbnailSha256: masterThumbSha || null,
            thumbnailWidth: ctx.results.THUMBNAIL?.selected?.width || null,
            thumbnailHeight: ctx.results.THUMBNAIL?.selected?.height || null,
            thumbnailMimeType: ctx.results.THUMBNAIL?.selected?.mimeType || null,
            thumbnailRemoteSha256: thumbnailResult.remoteSha256 || null,
            thumbnailMatches: thumbnailResult.thumbnailMatches,
            thumbnailIdentity: thumbnailResult.identity || null,
            youtubeUrl: `https://youtu.be/${videoId}`,
            visibility: 'public',
            verifiedAt: verification.verifiedAt,
            checks: { ...verification.checks, thumbnailState, verificationState, verificationErrorType: thumbnailResult.errorType || null },
            publishedAt: new Date().toISOString(),
            uploadState: 'SUCCESS',
            thumbnailState,
            verificationState,
            distribution,
          }

          // Write to all ledger paths (idempotent upsert)
          let ledgerEntry
          for (const ledgerPath of ledgerPaths) {
            const ledger = new PublicationLedger({ filePath: ledgerPath })
            ledgerEntry = ledger.record(record)
          }
          console.log(`[LEDGER] recorded ${videoId} — verified=${verification.passed} upload=SUCCESS thumbnail=${thumbnailState} verification=${verificationState}${thumbnailResult.errorType ? ` (${thumbnailResult.errorType})` : ''}`)
        } catch (e) {
          console.log(`[LEDGER] record failed (non-fatal): ${e.message}`)
        }

        return { verified: verification.passed, verification, videoId }
      })

      // ── ANALYTICS — consumes plan via recordOutcome() feedback loop ──
      job.onStage('ANALYTICS', async (ctx) => {
        const { engine } = ctx.results.RENDER
        const plan = ctx.results.DISCOVER?.plan
        const { videoId, uploadTitle, nicheDecision } = ctx.results.UPLOAD || {}
        const { commentEvent } = ctx.results.PUBLISH || {}
        const { retention } = engine?.lastRetention ? { retention: engine.lastRetention } : { retention: null }
        const musicTrack = engine?.audioMixer?.lastTrack?.file || null
        const musicFamily = engine?.audioMixer?.lastTrack?.family || engine?.audioMixer?.musicFamily || null

        // Publish events store — update the pre-upload pending record with videoId,
        // or create a new one if the pending write was skipped.
        try {
          const { TopicCtaBuilder } = await import('../src/publishing/TopicCtaBuilder.mjs')
          const { PublishEventsStore } = await import('../src/publishing/PublishEventsStore.mjs')
          const cta = new TopicCtaBuilder().build(article)
          const store = new PublishEventsStore()
          const title100 = article.title?.slice(0, 100)
          const updated = store.updateByTitle(title100, {
            videoId,
            category: category || 'technology',
            cta: { topic: cta.topic, mode: cta.mode, text: cta.narration },
            comment: commentEvent || null,
          })
          if (!updated) {
            store.record({
              videoId, title: title100,
              category: category || 'technology',
              cta: { topic: cta.topic, mode: cta.mode, text: cta.narration },
              comment: commentEvent || null,
            })
          }
          console.log('[ARTIFACT] data/publish-events.json updated')
        } catch (e) { console.log('[ARTIFACT] skipped:', e.message) }

        // Retention snapshot
        if (videoId && retention) {
          try {
            const { RetentionPatternLearner } = await import('../src/analytics/RetentionPatternLearner.mjs')
            new RetentionPatternLearner().appendSnapshot({
              videoId, title: article.title?.slice(0, 100),
              category: category || 'technology',
              musicTrack: musicTrack || null, musicFamily: musicFamily || null, retention,
            })
            console.log('Retention snapshot recorded for learning loop')
          } catch (e) { console.log('Retention snapshot skipped:', e.message) }
        }

        // Performance observation
        try {
          const { PerformanceObservation } = await import('../src/production/PerformanceObservation.mjs')
          const { PerformanceMemory } = await import('../src/production/PerformanceMemory.mjs')
          const obs = new PerformanceObservation({
            videoId, articleId: engine?.productionContext?.articleId || null,
            niche: nicheDecision?.key || 'GENERAL', publishedAt: new Date().toISOString(),
            analytics: {
              impressions: 0, views: 0,
              avgViewDuration: retention?.avgViewDuration || 0,
              avgPercentViewed: retention?.avgPercentViewed || 0,
            },
          })
          const mem = new PerformanceMemory()
          mem.record(obs)
          mem.close()
          console.log(`[FEEDBACK] observation recorded: niche=${obs.niche} videoId=${obs.videoId}`)
        } catch (e) { console.log('[FEEDBACK] observation skipped:', e.message) }

        // Record outcome through ProductionStrategyController for continuous learning
        if (plan && videoId) {
          try {
            const { ProductionStrategyController } = await import('../src/ai/ProductionStrategyController.mjs')
            const { PerformanceMemory } = await import('../src/production/PerformanceMemory.mjs')
            const mem = new PerformanceMemory()
            const controller = new ProductionStrategyController({ performanceMemory: mem })
            controller.recordOutcome(plan, {
              videoId,
              success: true,
              musicTrack: musicTrack || null,
              analytics: {
                impressions: 0,
                views: 0,
                avgViewDuration: retention?.avgViewDuration || 0,
                avgPercentViewed: retention?.avgPercentViewed || 0,
              },
            })
            mem.close()
            console.log(`[STRATEGY] outcome recorded: videoId=${videoId} niche=${plan.niche.key}`)
          } catch (e) { console.log(`[STRATEGY] recordOutcome skipped: ${e.message}`) }
        }

        return { recorded: true }
      })

      // Run the orchestrator
      const result = await job.run()
      if (!result.success) {
        const reason = result.quarantineReason || result.reason || 'unknown'
        console.error(`[JOB] Article quarantined: ${reason}`)
      }

      // ── ProductionManifest — immutable per-video provenance ──
      try {
        const { ProductionManifest } = await import('../src/experiment/ProductionManifest.mjs')
        const pm = new ProductionManifest({ outDir })
        const discoverResult = result.results?.DISCOVER || {}
        const renderResult = result.results?.RENDER || {}
        const thumbResult = result.results?.THUMBNAIL || {}
        const c2paResult = result.results?.C2PA || {}
        const uniquenessResult = result.results?.UNIQUENESS || {}
        const uploadResult = result.results?.UPLOAD || {}
        const publishResult = result.results?.PUBLISH || {}
        const verifyResult = result.results?.VERIFY || {}
        const analyticsResult = result.results?.ANALYTICS || {}

        const manifest = pm.create({
          article,
          niche: discoverResult.plan?.niche || { key: 'GENERAL' },
          plan: discoverResult.plan || {},
          decisionTrace: discoverResult.decisionTrace || {},
          experimentId,
          variant,
          stages: {
            discover: { status: result.stages?.DISCOVER || 'unknown', durationMs: 0 },
            render: {
              status: result.stages?.RENDER || 'unknown',
              durationMs: renderResult.renderTimeMs || 0,
              sceneCount: discoverResult.plan?.sceneStrategy?.sceneCount || 0,
            },
            thumbnail: {
              status: result.stages?.THUMBNAIL || 'unknown',
              layout: thumbResult.strategy || null,
              candidatesGenerated: thumbResult.candidates?.length || 0,
            },
            c2pa: { status: result.stages?.C2PA || 'unknown', signed: c2paResult.signed || false },
            uniqueness: {
              status: result.stages?.UNIQUENESS || 'unknown',
              passed: uniquenessResult.passed !== false,
              rejections: uniquenessResult.rejections || 0,
            },
            upload: {
              status: result.stages?.UPLOAD || 'unknown',
              provider: 'youtube',
              videoId: uploadResult.videoId || null,
            },
            publish: { status: result.stages?.PUBLISH || 'unknown', platform: 'youtube' },
            verify: { status: result.stages?.VERIFY || 'unknown', passed: verifyResult.verified || false },
            analytics: { status: result.stages?.ANALYTICS || 'unknown' },
          },
          providers: {
            ai: discoverResult.decisionTrace?.aiProvider || null,
            tts: 'elevenlabs',
            rendering: 'remotion',
            imageSearch: 'pexels',
          },
        })
        const manifestPath = pm.write(manifest)
        console.log(`[MANIFEST] ${manifest.artifactId} → ${manifestPath}`)
      } catch (e) {
        console.log(`[MANIFEST] skipped: ${e.message}`)
      }

      // ── Experiment outcome recording ──
      if (experimentManager && metrics) {
        try {
          const discoverResult = result.results?.DISCOVER || {}
          const uploadResult = result.results?.UPLOAD || {}
          const record = metrics.toExperimentRecord({
            experimentId,
            variant,
            planSource: discoverResult.plan?.hookStrategy?.source || 'unknown',
            artifactId: result.results?.DISCOVER?.artifactId || `vid-${Date.now().toString(36)}`,
            niche: discoverResult.plan?.niche?.key || 'GENERAL',
            articleTitle: article.title?.slice(0, 100) || '',
            hookStrategy: discoverResult.plan?.hookStrategy || null,
            sceneStrategy: discoverResult.plan?.sceneStrategy || null,
            visualStrategy: discoverResult.plan?.visualStrategy || null,
            musicStrategy: discoverResult.plan?.musicStrategy || null,
            thumbnailStrategy: discoverResult.plan?.thumbnailStrategy || null,
          })
          record.youtube = { videoId: uploadResult.videoId || null }
          experimentManager.recordOutcome(record)
          const summary = experimentManager.getSummary()
          console.log(`[EXPERIMENT] recorded: total=${summary.total} control=${summary.controlCount} treatment=${summary.treatmentCount}`)
        } catch (e) {
          console.log(`[EXPERIMENT] recording skipped: ${e.message}`)
        }
      }
    }

    console.log('\nNEWS-MONSTER Broadcast Pipeline Complete')
  }

  runFull().catch(e => {
    console.error('Fatal:', e.stack || e)
    process.exit(1)
  })
}
