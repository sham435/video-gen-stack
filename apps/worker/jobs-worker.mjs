#!/usr/bin/env node
/**
 * jobs-worker — processes queued render jobs from newsroom.db.
 *
 * Usage:
 *   node apps/worker/jobs-worker.mjs            # daemon: poll forever
 *   node apps/worker/jobs-worker.mjs --once     # drain current queue, then exit
 *   node apps/worker/jobs-worker.mjs --limit N  # process at most N jobs, then exit
 */

import { jobDb, claim, complete, fail, requeueStale, listJobs } from '../../packages/database/jobs.mjs'
import { getEndpoint } from '../api/services/models.js'
import { fetchTopHeadlines, searchNews, articlesToSummary } from '../api/services/news.js'
import { childLogger } from '../../packages/logger.mjs'
import { startMetricsServer, updateJobGauges, recordJobOutcome, consecutiveFailures } from '../../packages/metrics.mjs'

const log = childLogger('jobs-worker')
const POLL_MS = 2000
const STALE_MS = 15 * 60 * 1000
const CRITICAL_STREAK = 5

let failureStreak = 0

function noteFailure() {
  failureStreak++
  consecutiveFailures.set(failureStreak)
  if (failureStreak >= CRITICAL_STREAK) {
    log.fatal({ streak: failureStreak }, 'worker failing repeatedly')
  }
}

function noteSuccess() {
  failureStreak = 0
  consecutiveFailures.set(0)
}

const PROVIDERS = {
  'local': () => import('../api/services/local.js'),
  'gemini': () => import('../api/services/gemini.js'),
  'fal.ai': () => import('../api/services/fal.js'),
  'huggingface': () => import('../api/services/gradio.js'),
}

async function runVideoGenerate(job) {
  const p = job.payload
  const provider = p.provider || 'local'
  const load = PROVIDERS[provider]
  if (!load) throw new Error(`Provider not available in this deployment: ${provider}`)
  const prov = await load()
  const result = await prov.generateVideo({
    endpoint: p.endpoint,
    modelId: p.modelId,
    prompt: p.prompt,
    duration: p.duration || 5,
    aspectRatio: p.aspectRatio || '16:9',
    imageUrl: p.imageUrl,
    segments: p.segments,
    segmentDuration: p.segmentDuration,
  })
  const video = result.videos?.[0]
  return { resultPath: result.video_path || video?.path || null, result }
}

async function runNewsVideo(job) {
  const p = job.payload
  let articles
  if (p.topic) {
    articles = await searchNews(p.topic, { pageSize: 5 })
  } else {
    articles = await fetchTopHeadlines({ category: p.category, pageSize: 5 })
  }
  if (!articles.length) throw new Error('No news found')

  if ((p.provider || 'local') === 'local') {
    const { renderNewsVideo } = await import('../api/services/renderer.js')
    const path = await renderNewsVideo(articles.slice(0, 3))
    const result = { articles, video: { url: `file://${path}`, path, contentType: 'video/mp4', duration: 10 }, provider: 'local', note: 'local ffmpeg render (free)' }
    return { resultPath: path, result }
  }

  const newsText = articlesToSummary(articles)
  const model = p.modelId || 'gemini-2.0-flash'
  const endpoint = getEndpoint(model, p.provider)
  if (!endpoint) throw new Error('No video provider configured')
  const load = PROVIDERS[p.provider]
  if (!load) throw new Error(`Provider not available: ${p.provider}`)
  const prov = await load()
  const prompt = `Create a ${p.duration || 7}-second news highlights video from these headlines. Style: modern news broadcast, clean, professional.\n\n${newsText}`
  const result = await prov.generateVideo({ endpoint, modelId: model, prompt, duration: p.duration || 7, aspectRatio: p.aspectRatio || '9:16' })
  const video = result.videos?.[0]
  return { resultPath: video?.path || null, result }
}

async function runJob(job) {
  switch (job.type) {
    case 'video_generate': return runVideoGenerate(job)
    case 'news_video': return runNewsVideo(job)
    default: throw new Error(`Unknown job type: ${job.type}`)
  }
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)) }

async function drainOnce(limit) {
  const db = jobDb()
  let processed = 0
  for (;;) {
    const job = claim(db)
    if (!job) break
    processed++
    const t0 = Date.now()
    try {
      const { resultPath, result } = await runJob(job)
      complete(db, job.id, { resultPath, result, durationMs: Date.now() - t0 })
      recordJobOutcome(job, Date.now() - t0)
      noteSuccess()
      log.info({ jobId: job.id, type: job.type, ms: Date.now() - t0, path: resultPath || result?.video?.url || 'n/a' }, 'job done')
    } catch (e) {
      fail(db, job.id, e.message)
      recordJobOutcome(job, Date.now() - t0, e.message)
      noteFailure()
      log.error({ jobId: job.id, type: job.type, error: e.message }, 'job failed')
    }
    if (limit && processed >= limit) break
  }
  return processed
}

async function main() {
  const args = process.argv.slice(2)
  const once = args.includes('--once')
  const limitIdx = args.indexOf('--limit')
  const limit = limitIdx >= 0 ? parseInt(args[limitIdx + 1]) || null : null

  const db = jobDb()
  requeueStale(db, STALE_MS)
  updateJobGauges(db)

  startMetricsServer(parseInt(process.env.WORKER_METRICS_PORT) || 9101, { log })

  if (once) {
    const n = await drainOnce(limit)
    updateJobGauges(db)
    const remaining = listJobs(db, { status: 'queued' }).length
    log.info({ drained: n, remaining }, 'worker drained')
    process.exit(0)
  }

  log.info({ pollMs: POLL_MS }, 'worker polling')
  for (;;) {
    try {
      requeueStale(db, STALE_MS)
      const job = claim(db)
      if (!job) { await sleep(POLL_MS); continue }
      const t0 = Date.now()
      try {
      const { resultPath, result } = await runJob(job)
      complete(db, job.id, { resultPath, result, durationMs: Date.now() - t0 })
      recordJobOutcome(job, Date.now() - t0)
      noteSuccess()
      log.info({ jobId: job.id, type: job.type, ms: Date.now() - t0, path: resultPath || result?.video?.url || 'n/a' }, 'job done')
    } catch (e) {
      fail(db, job.id, e.message)
      recordJobOutcome(job, Date.now() - t0, e.message)
      noteFailure()
      log.error({ jobId: job.id, type: job.type, error: e.message }, 'job failed')
    }
    updateJobGauges(db)
    } catch (e) {
      log.error({ error: e.message }, 'worker loop error')
      await sleep(POLL_MS)
    }
  }
}

main()
