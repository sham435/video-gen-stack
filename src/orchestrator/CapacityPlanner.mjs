/**
 * CapacityPlanner — calculates achievable production capacity from configured quotas.
 *
 * Input:  daily target, provider quotas, rendering capacity, worker concurrency
 * Output: { target, achievable, bottleneck, estimatedCapacity, requiredCapacity, deficit, recommendations }
 *
 * Does NOT assume YouTube supports only 6 uploads/day — calculates from actual quota.
 */

const DEFAULT_QUOTAS = {
  youtube: {
    dailyUploads: 6,        // YouTube API default project quota for uploads
    uploadCostUnits: 1600,  // YouTube Data API cost per video upload (approximate)
    dailyQuotaUnits: 10000, // Default YouTube API daily quota
    description: 'YouTube Data API v3',
  },
  gemini: {
    dailyRequests: 1500,    // Free tier: 1500 RPD
    requestsPerVideo: 2,    // Strategy + optional LLM calls
    description: 'Gemini 2.0 Flash (free tier)',
  },
  openai: {
    dailyRequests: 200,     // Free tier estimate
    requestsPerVideo: 1,
    description: 'OpenAI gpt-4o-mini',
  },
  elevenlabs: {
    dailyChars: 10000,      // Free tier: 10k chars/month → daily ~333
    charsPerVideo: 1500,    // ~30 seconds narration
    description: 'ElevenLabs TTS',
  },
  pexels: {
    dailyRequests: 200,     // Free tier: 200 req/hour, 20k/day
    requestsPerVideo: 8,    // ~6 scenes + 1 hero + 1 fallback
    description: 'Pexels video/image API',
  },
  render: {
    concurrentWorkers: 1,   // Local rendering: 1 at a time
    avgRenderTimeSec: 45,   // Average render duration
    description: 'Local Remotion render',
  },
  c2pa: {
    dailySignings: 500,     // Local signing: no external limit
    signingTimeSec: 2,      // C2PA signing duration
    description: 'Local C2PA signing',
  },
}

export class CapacityPlanner {
  constructor(opts = {}) {
    this.target = opts.target || 48
    this.quotas = { ...DEFAULT_QUOTAS, ...opts.quotas }

    // Override with env vars if available
    if (process.env.YOUTUBE_DAILY_QUOTA) {
      this.quotas.youtube.dailyQuotaUnits = Number(process.env.YOUTUBE_DAILY_QUOTA)
    }
    if (process.env.YOUTUBE_DAILY_UPLOADS) {
      this.quotas.youtube.dailyUploads = Number(process.env.YOUTUBE_DAILY_UPLOADS)
    }
    if (process.env.ELEVENLABS_DAILY_CHARS) {
      this.quotas.elevenlabs.dailyChars = Number(process.env.ELEVENLABS_DAILY_CHARS)
    }
    if (process.env.RENDER_CONCURRENCY) {
      this.quotas.render.concurrentWorkers = Number(process.env.RENDER_CONCURRENCY)
    }
  }

  /** Calculate capacity per stage */
  calculate() {
    const stages = {}

    // YouTube uploads
    const ytUploadCapacity = this.quotas.youtube.dailyUploads
    stages.youtube = {
      capacityPerHour: ytUploadCapacity / 24,
      dailyCapacity: ytUploadCapacity,
      bottleneck: ytUploadCapacity < this.target,
      unit: 'uploads/day',
    }

    // Gemini AI
    const geminiCapacity = Math.floor(this.quotas.gemini.dailyRequests / this.quotas.gemini.requestsPerVideo)
    stages.gemini = {
      capacityPerHour: geminiCapacity / 24,
      dailyCapacity: geminiCapacity,
      bottleneck: geminiCapacity < this.target,
      unit: 'videos/day',
    }

    // ElevenLabs TTS
    const ttsCapacity = Math.floor(this.quotas.elevenlabs.dailyChars / this.quotas.elevenlabs.charsPerVideo)
    stages.tts = {
      capacityPerHour: ttsCapacity / 24,
      dailyCapacity: ttsCapacity,
      bottleneck: ttsCapacity < this.target,
      unit: 'videos/day',
    }

    // Rendering
    const renderCapacityPerWorker = Math.floor((24 * 3600) / this.quotas.render.avgRenderTimeSec)
    const renderCapacity = renderCapacityPerWorker * this.quotas.render.concurrentWorkers
    stages.render = {
      capacityPerHour: (renderCapacity / 24),
      dailyCapacity: renderCapacity,
      bottleneck: renderCapacity < this.target,
      unit: 'videos/day',
      workers: this.quotas.render.concurrentWorkers,
    }

    // Pexels
    const pexelsCapacity = Math.floor(this.quotas.pexels.dailyRequests / this.quotas.pexels.requestsPerVideo)
    stages.pexels = {
      capacityPerHour: pexelsCapacity / 24,
      dailyCapacity: pexelsCapacity,
      bottleneck: pexelsCapacity < this.target,
      unit: 'videos/day',
    }

    // C2PA
    stages.c2pa = {
      capacityPerHour: Math.floor(3600 / this.quotas.c2pa.signingTimeSec),
      dailyCapacity: this.quotas.c2pa.dailySignings,
      bottleneck: this.quotas.c2pa.dailySignings < this.target,
      unit: 'signings/day',
    }

    // Find bottleneck
    const bottleneckKey = Object.entries(stages)
      .filter(([, s]) => s.bottleneck)
      .sort((a, b) => a[1].dailyCapacity - b[1].dailyCapacity)[0]

    const bottleneck = bottleneckKey ? bottleneckKey[0] : null
    const achievable = bottleneckKey ? bottleneckKey[1].dailyCapacity : this.target
    const deficit = Math.max(0, this.target - achievable)

    // Generate recommendations
    const recommendations = []
    if (bottleneck === 'youtube') {
      recommendations.push(`YouTube uploads capped at ${ytUploadCapacity}/day. Options:`)
      recommendations.push(`  1. Request YouTube API quota increase from Google`)
      recommendations.push(`  2. Add additional YouTube channels (multi-channel publishing)`)
      recommendations.push(`  3. Reduce target to ${ytUploadCapacity}/day`)
      if (this.quotas.youtube.dailyQuotaUnits < ytUploadCapacity * this.quotas.youtube.uploadCostUnits) {
        recommendations.push(`  WARNING: Daily quota units (${this.quotas.youtube.dailyQuotaUnits}) may not support ${ytUploadCapacity} uploads (need ${ytUploadCapacity * this.quotas.youtube.uploadCostUnits} units)`)
      }
    }
    if (bottleneck === 'tts') {
      recommendations.push(`ElevenLabs TTS capped at ${ttsCapacity}/day. Options:`)
      recommendations.push(`  1. Upgrade ElevenLabs plan for more daily characters`)
      recommendations.push(`  2. Use shorter narration (reduce chars per video)`)
      recommendations.push(`  3. Switch to local TTS (edge-tts)`)
    }
    if (bottleneck === 'render') {
      recommendations.push(`Rendering capped at ${renderCapacity}/day with ${this.quotas.render.concurrentWorkers} worker(s).`)
      recommendations.push(`  Increase RENDER_CONCURRENCY for parallel rendering.`)
    }
    if (!bottleneck) {
      recommendations.push(`All stages can support ${this.target} videos/day.`)
      recommendations.push(`YouTube is the most likely real-world bottleneck — verify quota in production.`)
    }

    return {
      target: this.target,
      achievable,
      bottleneck,
      estimatedCapacity: achievable,
      requiredCapacity: this.target,
      deficit,
      stages,
      recommendations,
      quotas: { ...this.quotas },
    }
  }

  /** Run a simulation of daily production */
  simulate() {
    const capacity = this.calculate()
    const schedule = []
    const hourMs = 3600000
    const videoIntervalMs = Math.ceil(hourMs / (capacity.achievable / 24))

    let currentTime = new Date()
    const endTime = new Date(currentTime.getTime() + 24 * hourMs)
    let produced = 0

    while (currentTime < endTime && produced < capacity.achievable) {
      schedule.push({
        slot: produced + 1,
        scheduledAt: currentTime.toISOString(),
        bottleneck: capacity.bottleneck || 'none',
      })
      currentTime = new Date(currentTime.getTime() + videoIntervalMs)
      produced++
    }

    return {
      ...capacity,
      schedule,
      totalScheduled: produced,
      utilizationRate: capacity.target > 0 ? (produced / capacity.target * 100).toFixed(1) + '%' : '0%',
      estimatedRuntime: `${(produced * (capacity.stages.render?.dailyCapacity ? (24 / capacity.stages.render.dailyCapacity) : 0.5)).toFixed(1)} hours`,
    }
  }
}
