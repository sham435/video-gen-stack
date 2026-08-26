import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'

/**
 * Immutable per-video provenance artifact.
 *
 * Records every decision, strategy, quality score, provider choice, and
 * outcome for a single production run. Enables the system to answer:
 *   "Why did video #183 use this hook, this image strategy and this thumbnail?"
 *
 * The manifest is written once at production completion and never mutated.
 */

export class ProductionManifest {
  constructor(opts = {}) {
    this.outDir = opts.outDir || process.env.OUT_DIR || 'output'
    this.manifestDir = path.join(this.outDir, '.manifests')
  }

  /**
   * Create a complete production manifest for one video.
   * @param {object} data - all production data
   * @returns {object} frozen manifest
   */
  create(data) {
    const artifactId = data.artifactId || ProductionManifest.generateArtifactId(data.article)

    const manifest = Object.freeze({
      schemaVersion: 1,
      artifactId,
      createdAt: new Date().toISOString(),

      // Source article
      article: Object.freeze({
        title: data.article?.title || '',
        description: data.article?.description || '',
        category: data.article?.category || 'general',
        source: data.article?.source || '',
        publishedAt: data.article?.publishedAt || null,
      }),

      // Niche resolution
      niche: Object.freeze({
        key: data.niche?.key || 'GENERAL',
        source: data.niche?.source || 'heuristic',
        confidence: data.niche?.confidence || 0,
      }),

      // Full production plan (immutable snapshot)
      productionPlan: Object.freeze({ ...(data.plan || {}) }),

      // Strategy decision trace
      strategyTrace: Object.freeze({
        source: data.plan?.hookStrategy?.source || 'unknown',
        aiCalled: data.decisionTrace?.aiCalled || false,
        aiProvider: data.decisionTrace?.aiProvider || null,
        aiLatencyMs: data.decisionTrace?.aiLatencyMs || 0,
        recommendationsReceived: data.decisionTrace?.recommendationsReceived || 0,
        recommendationsAccepted: data.decisionTrace?.recommendationsAccepted || 0,
        recommendationsRejected: data.decisionTrace?.recommendationsRejected || 0,
        rejectionReasons: [...(data.decisionTrace?.rejectionReasons || [])],
        fallbackUsed: data.decisionTrace?.fallbackUsed || false,
        confidence: data.plan?.confidence || 0,
        memorySignals: data.decisionTrace?.memorySignals || [],
      }),

      // Experiment assignment
      experiment: Object.freeze({
        experimentId: data.experimentId || null,
        variant: data.variant || 'control',
      }),

      // Stage outcomes
      stages: Object.freeze({
        discover: Object.freeze({
          status: data.stages?.discover?.status || 'unknown',
          durationMs: data.stages?.discover?.durationMs || 0,
        }),
        render: Object.freeze({
          status: data.stages?.render?.status || 'unknown',
          durationMs: data.stages?.render?.durationMs || 0,
          outputSize: data.stages?.render?.outputSize || 0,
          sceneCount: data.stages?.render?.sceneCount || 0,
        }),
        thumbnail: Object.freeze({
          status: data.stages?.thumbnail?.status || 'unknown',
          durationMs: data.stages?.thumbnail?.durationMs || 0,
          layout: data.stages?.thumbnail?.layout || null,
          candidatesGenerated: data.stages?.thumbnail?.candidatesGenerated || 0,
          rejections: data.stages?.thumbnail?.rejections || 0,
        }),
        c2pa: Object.freeze({
          status: data.stages?.c2pa?.status || 'unknown',
          signed: data.stages?.c2pa?.signed || false,
        }),
        uniqueness: Object.freeze({
          status: data.stages?.uniqueness?.status || 'unknown',
          passed: data.stages?.uniqueness?.passed ?? true,
          rejections: data.stages?.uniqueness?.rejections || 0,
        }),
        upload: Object.freeze({
          status: data.stages?.upload?.status || 'unknown',
          provider: data.stages?.upload?.provider || null,
          videoId: data.stages?.upload?.videoId || null,
          durationMs: data.stages?.upload?.durationMs || 0,
        }),
        publish: Object.freeze({
          status: data.stages?.publish?.status || 'unknown',
          platform: data.stages?.publish?.platform || null,
          publishedUrl: data.stages?.publish?.publishedUrl || null,
        }),
        verify: Object.freeze({
          status: data.stages?.verify?.status || 'unknown',
          passed: data.stages?.verify?.passed ?? false,
        }),
        analytics: Object.freeze({
          status: data.stages?.analytics?.status || 'unknown',
        }),
      }),

      // Quality scores (post-production)
      qualityScores: Object.freeze({
        composition: data.qualityScores?.composition || null,
        hook: data.qualityScores?.hook || null,
        thumbnail: data.qualityScores?.thumbnail || null,
        visualRelevance: data.qualityScores?.visualRelevance || null,
        retentionPrediction: data.qualityScores?.retentionPrediction || null,
      }),

      // Provider decisions
      providers: Object.freeze({
        ai: data.providers?.ai || null,
        tts: data.providers?.tts || null,
        rendering: data.providers?.rendering || null,
        imageSearch: data.providers?.imageSearch || null,
      }),

      // YouTube outcome (filled post-publish)
      youtube: Object.freeze({
        videoId: data.youtube?.videoId || null,
        impressions: data.youtube?.impressions || null,
        ctr: data.youtube?.ctr || null,
        views: data.youtube?.views || null,
        averageViewDuration: data.youtube?.averageViewDuration || null,
        averagePercentageViewed: data.youtube?.averagePercentageViewed || null,
        likes: data.youtube?.likes || null,
        comments: data.youtube?.comments || null,
        shares: data.youtube?.shares || null,
      }),

      // Capacity evidence (audit trail per production)
      capacity: data.capacity ? Object.freeze({
        targetVideosPerDay: data.capacity.targetVideosPerDay || 48,
        theoreticalCapacity: data.capacity.theoreticalCapacity || 0,
        demonstratedCapacity: data.capacity.demonstratedCapacity || 0,
        safeCapacity: data.capacity.safeCapacity || 0,
        bottleneck: data.capacity.bottleneck || 'unknown',
        evidenceWindow: data.capacity.evidenceWindow || null,
        sampleSize: data.capacity.sampleSize || 0,
        gateStatus: data.capacity.gateStatus || 'unknown',
      }) : null,
    })

    return manifest
  }

  /** Persist manifest to disk */
  write(manifest) {
    if (!fs.existsSync(this.manifestDir)) {
      fs.mkdirSync(this.manifestDir, { recursive: true })
    }
    const filePath = path.join(this.manifestDir, `${manifest.artifactId}.json`)
    fs.writeFileSync(filePath, JSON.stringify(manifest, null, 2))
    return filePath
  }

  /** Read manifest from disk */
  read(artifactId) {
    const filePath = path.join(this.manifestDir, `${artifactId}.json`)
    if (!fs.existsSync(filePath)) return null
    return JSON.parse(fs.readFileSync(filePath, 'utf8'))
  }

  /** List all manifests */
  list() {
    if (!fs.existsSync(this.manifestDir)) return []
    return fs.readdirSync(this.manifestDir)
      .filter(f => f.endsWith('.json'))
      .map(f => f.replace('.json', ''))
  }

  static generateArtifactId(article) {
    const title = String(article?.title || 'unknown')
    const ts = Date.now().toString(36)
    const hash = crypto.createHash('sha256').update(title).digest('hex').slice(0, 8)
    return `vid-${ts}-${hash}`
  }
}
