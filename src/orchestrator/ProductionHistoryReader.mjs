/**
 * ProductionHistoryReader — derives production metrics from actual artifacts.
 *
 * Sources:
 *   - data/pipeline-events.jsonl (legacy stage timing: story, assets, cover, voice, render, quality)
 *   - data/production-jobs/*.json (per-job stage records with startedAt/endedAt)
 *   - data/publish-events.json (published video records)
 *   - output/.asset-registry.json (asset tracking)
 *   - output/.manifests/ (ProductionManifest artifacts, if present)
 *
 * All values are classified as:
 *   observed  — directly measured from production artifacts
 *   estimated — derived from partial data or models
 *   configured — from config files or env vars
 *   unknown — insufficient data
 */

import fs from 'node:fs'
import path from 'node:path'

export class ProductionHistoryReader {
  constructor(opts = {}) {
    this.dataDir = opts.dataDir || path.resolve('data')
    this.outputDir = opts.outputDir || path.resolve('output')
    this._cache = {}
  }

  /**
   * Read all production jobs and extract timing/status data.
   * @returns {{ jobs: Array, summary: object }}
   */
  readProductionJobs() {
    if (this._cache.jobs) return this._cache.jobs

    const jobsDir = path.join(this.dataDir, 'production-jobs')
    if (!fs.existsSync(jobsDir)) {
      return { jobs: [], summary: this._emptySummary() }
    }

    const files = fs.readdirSync(jobsDir).filter(f => f.endsWith('.json'))
    const jobs = files.map(f => {
      try {
        const raw = JSON.parse(fs.readFileSync(path.join(jobsDir, f), 'utf8'))
        return this._parseJob(raw, f)
      } catch {
        return null
      }
    }).filter(Boolean)

    const summary = this._summarizeJobs(jobs)
    this._cache.jobs = { jobs, summary }
    return this._cache.jobs
  }

  /**
   * Read pipeline events (legacy stage timing).
   * @returns {{ events: Array, stageTimings: object }}
   */
  readPipelineEvents() {
    if (this._cache.events) return this._cache.events

    const eventsPath = path.join(this.dataDir, 'pipeline-events.jsonl')
    if (!fs.existsSync(eventsPath)) {
      return { events: [], stageTimings: {} }
    }

    const lines = fs.readFileSync(eventsPath, 'utf8').split('\n').filter(Boolean)
    const events = lines.map(l => {
      try { return JSON.parse(l) } catch { return null }
    }).filter(Boolean)

    const stageTimings = this._computeStageTimings(events)
    this._cache.events = { events, stageTimings }
    return this._cache.events
  }

  /**
   * Read publish events (published video records).
   * @returns {{ events: Array, daily: object, totalReal: number }}
   */
  readPublishEvents() {
    if (this._cache.publish) return this._cache.publish

    const eventsPath = path.join(this.dataDir, 'publish-events.json')
    if (!fs.existsSync(eventsPath)) {
      return { events: [], daily: {}, totalReal: 0 }
    }

    const events = JSON.parse(fs.readFileSync(eventsPath, 'utf8'))
    const real = events.filter(e =>
      e.videoId && e.videoId !== 'None' && !(e.title || '').includes('Test Article')
    )
    const daily = {}
    for (const e of real) {
      const d = e.publishedAt?.slice(0, 10) || 'unknown'
      daily[d] = (daily[d] || 0) + 1
    }

    this._cache.publish = { events, daily, totalReal: real.length }
    return this._cache.publish
  }

  /**
   * Read asset registry for asset counts and rolling window.
   * @returns {{ scripts: number, images: number, music: number, thumbnails: number, publishedVideos: number, reservations: number }}
   */
  readAssetRegistry() {
    if (this._cache.registry) return this._cache.registry

    const registryPath = path.join(this.outputDir, '.asset-registry.json')
    const result = { scripts: 0, images: 0, music: 0, thumbnails: 0, publishedVideos: 0, reservations: 0, source: 'unknown' }

    if (!fs.existsSync(registryPath)) {
      this._cache.registry = result
      return result
    }

    try {
      const raw = JSON.parse(fs.readFileSync(registryPath, 'utf8'))
      result.scripts = Object.keys(raw.scripts || {}).length
      result.images = Object.keys(raw.images || {}).length
      result.music = Object.keys(raw.music || {}).length
      result.thumbnails = Object.keys(raw.thumbnails || {}).length
      result.publishedVideos = (raw.publishedVideos || []).length
      result.reservations = Object.keys(raw.reservations || {}).length
      result.rollingWindow = raw.rollingWindow || 50
      result.source = 'observed'
    } catch {
      result.source = 'unknown'
    }

    this._cache.registry = result
    return result
  }

  /**
   * Read batch output directories for artifact counts.
   * @returns {{ batchCount: number, finalMp4Count: number, manifestCount: number }}
   */
  readBatchOutputs() {
    if (this._cache.batches) return this._cache.batches

    const result = { batchCount: 0, finalMp4Count: 0, manifestCount: 0, source: 'unknown' }

    if (!fs.existsSync(this.outputDir)) {
      this._cache.batches = result
      return result
    }

    try {
      const entries = fs.readdirSync(this.outputDir)
      const batches = entries.filter(e => e.startsWith('batch-'))
      result.batchCount = batches.length

      for (const b of batches) {
        const bPath = path.join(this.outputDir, b)
        if (fs.existsSync(path.join(bPath, 'final.mp4'))) result.finalMp4Count++
        if (fs.existsSync(path.join(bPath, 'manifest.json'))) result.manifestCount++
      }

      // Check output/.manifests/
      const manifestsDir = path.join(this.outputDir, '.manifests')
      if (fs.existsSync(manifestsDir)) {
        const manifestFiles = fs.readdirSync(manifestsDir).filter(f => f.endsWith('.json'))
        result.manifestCount += manifestFiles.length
      }

      result.source = 'observed'
    } catch {
      result.source = 'unknown'
    }

    this._cache.batches = result
    return result
  }

  /**
   * Read production manifests (output/.manifests/*.json).
   * @returns {{ manifests: Array, timing: object, resources: object }}
   */
  readProductionManifests() {
    if (this._cache.manifests) return this._cache.manifests

    const manifestsDir = path.join(this.outputDir, '.manifests')
    const result = { manifests: [], timing: {}, resources: {}, source: 'unknown' }

    if (!fs.existsSync(manifestsDir)) {
      this._cache.manifests = result
      return result
    }

    try {
      const files = fs.readdirSync(manifestsDir).filter(f => f.endsWith('.json'))
      result.manifests = files.map(f => {
        try {
          return JSON.parse(fs.readFileSync(path.join(manifestsDir, f), 'utf8'))
        } catch { return null }
      }).filter(Boolean)

      result.timing = this._computeManifestTiming(result.manifests)
      result.resources = this._computeManifestResources(result.manifests)
      result.source = 'observed'
    } catch {
      result.source = 'unknown'
    }

    this._cache.manifests = result
    return result
  }

  /**
   * Aggregate all sources into a single production history report.
   * @returns {object}
   */
  collect() {
    const jobs = this.readProductionJobs()
    const events = this.readPipelineEvents()
    const publish = this.readPublishEvents()
    const registry = this.readAssetRegistry()
    const batches = this.readBatchOutputs()
    const manifests = this.readProductionManifests()

    const window = this._computeWindow(jobs.jobs, publish.events)

    return {
      window,
      throughput: {
        completed: jobs.summary.completed,
        failed: jobs.summary.failed,
        cancelled: jobs.summary.cancelled,
        videosPerDay: publish.totalReal / Math.max(1, window.days || 1),
        _classifications: {
          completed: 'observed',
          failed: 'observed',
          cancelled: 'observed',
          videosPerDay: 'observed',
        },
      },
      timing: {
        render: events.stageTimings.render || { p50Ms: 'unknown', p95Ms: 'unknown', source: 'unknown' },
        story: events.stageTimings.story || { p50Ms: 'unknown', p95Ms: 'unknown', source: 'unknown' },
        cover: events.stageTimings.cover || { p50Ms: 'unknown', p95Ms: 'unknown', source: 'unknown' },
        voice: events.stageTimings.voice || { p50Ms: 'unknown', p95Ms: 'unknown', source: 'unknown' },
        assets: events.stageTimings.assets || { p50Ms: 'unknown', p95Ms: 'unknown', source: 'unknown' },
        quality: events.stageTimings.quality || { p50Ms: 'unknown', p95Ms: 'unknown', source: 'unknown' },
        manifest: manifests.timing,
      },
      resources: {
        assets: registry,
        batches,
        manifests: manifests.resources,
      },
      failures: {
        byStage: jobs.summary.failuresByStage,
        byReason: jobs.summary.failuresByReason,
      },
      _sources: {
        productionJobs: jobs.summary.total > 0 ? 'observed' : 'none',
        pipelineEvents: events.events.length > 0 ? 'observed' : 'none',
        publishEvents: publish.totalReal > 0 ? 'observed' : 'none',
        assetRegistry: registry.source,
        batchOutputs: batches.source,
        productionManifests: manifests.source,
      },
    }
  }

  // ── Internal helpers ──────────────────────────────────────────────

  _parseJob(raw, filename) {
    const stages = raw.stages || {}
    const stageTimings = {}

    for (const [name, stage] of Object.entries(stages)) {
      if (stage.startedAt && stage.endedAt) {
        const start = new Date(stage.startedAt).getTime()
        const end = new Date(stage.endedAt).getTime()
        if (end > start) {
          stageTimings[name] = { durationMs: end - start, status: stage.status }
        }
      }
    }

    const totalMs = Object.values(stageTimings)
      .filter(s => s.durationMs > 0)
      .reduce((sum, s) => sum + s.durationMs, 0)

    return {
      id: raw.id,
      title: raw.title,
      status: raw.status,
      createdAt: raw.createdAt,
      stageTimings,
      totalMs,
      filename,
    }
  }

  _summarizeJobs(jobs) {
    const completed = jobs.filter(j => j.status === 'PUBLISHED' || j.status === 'COMPLETED').length
    const failed = jobs.filter(j => j.status === 'FAILED' || j.status === 'QUARANTINED').length
    const cancelled = jobs.filter(j => j.status === 'CANCELLED').length
    const inProgress = jobs.filter(j => j.status === 'IN_PROGRESS' || j.status === 'RENDERING').length

    const failuresByStage = {}
    const failuresByReason = {}

    for (const job of jobs) {
      if (job.status === 'FAILED' || job.status === 'QUARANTINED') {
        // Find which stage failed
        for (const [name, stage] of Object.entries(job.stageTimings || {})) {
          if (stage.status === 'failed' || stage.status === 'quarantined') {
            failuresByStage[name] = (failuresByStage[name] || 0) + 1
          }
        }
      }
    }

    return {
      total: jobs.length,
      completed,
      failed,
      cancelled,
      inProgress,
      failuresByStage,
      failuresByReason,
    }
  }

  _computeStageTimings(events) {
    const stages = {}

    // Group by stage and status
    for (const e of events) {
      if (!e.stage) continue
      if (!stages[e.stage]) stages[e.stage] = { durations: [], running: 0, success: 0, failed: 0 }

      if (e.status === 'success' && e.duration_ms) {
        stages[e.stage].durations.push(e.duration_ms)
        stages[e.stage].success++
      } else if (e.status === 'failed') {
        stages[e.stage].failed++
      } else if (e.status === 'running') {
        stages[e.stage].running++
      }
    }

    // Compute percentiles
    const result = {}
    for (const [name, data] of Object.entries(stages)) {
      if (data.durations.length === 0) {
        result[name] = { p50Ms: 'unknown', p95Ms: 'unknown', avgMs: 'unknown', n: 0, source: 'unknown' }
        continue
      }

      const sorted = [...data.durations].sort((a, b) => a - b)
      const n = sorted.length
      result[name] = {
        p50Ms: sorted[Math.floor(n * 0.5)],
        p95Ms: sorted[Math.floor(n * 0.95)],
        avgMs: Math.round(sorted.reduce((s, v) => s + v, 0) / n),
        minMs: sorted[0],
        maxMs: sorted[n - 1],
        n,
        success: data.success,
        failed: data.failed,
        source: 'observed',
      }
    }

    return result
  }

  _computeWindow(jobs, publishEvents) {
    const allDates = []

    for (const j of jobs) {
      if (j.createdAt) allDates.push(j.createdAt)
    }
    for (const e of publishEvents) {
      if (e.publishedAt) allDates.push(e.publishedAt)
    }

    if (allDates.length === 0) {
      return { from: 'unknown', to: 'unknown', days: 0, productions: 0 }
    }

    const sorted = allDates.sort()
    const from = sorted[0]
    const to = sorted[sorted.length - 1]
    const days = Math.max(1, (new Date(to).getTime() - new Date(from).getTime()) / (24 * 60 * 60 * 1000))

    return { from, to, days: Math.round(days * 10) / 10, productions: jobs.length }
  }

  _computeManifestTiming(manifests) {
    if (manifests.length === 0) return { source: 'none' }

    const timings = manifests
      .filter(m => m.timing || m.durationMs || m.stageTimings)
      .map(m => m.timing || { totalMs: m.durationMs, stages: m.stageTimings })

    if (timings.length === 0) return { source: 'none' }

    return { count: timings.length, source: 'observed', sample: timings.slice(0, 3) }
  }

  _computeManifestResources(manifests) {
    if (manifests.length === 0) return { source: 'none' }

    const aiCalls = manifests.reduce((s, m) => s + (m.strategy?.recommendationsAccepted || 0), 0)
    const aiFallbacks = manifests.reduce((s, m) => s + (m.strategy?.fallbackUsed ? 1 : 0), 0)

    return {
      totalManifests: manifests.length,
      aiCallsTotal: aiCalls,
      aiFallbacksTotal: aiFallbacks,
      source: 'observed',
    }
  }

  _emptySummary() {
    return { total: 0, completed: 0, failed: 0, cancelled: 0, inProgress: 0, failuresByStage: {}, failuresByReason: {} }
  }
}
