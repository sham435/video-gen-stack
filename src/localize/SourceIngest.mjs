/**
 * SourceIngest — stage 1+2 of the LocalizationPipeline (NEWS-MONSTER core).
 *
 * Produces a SourceManifest:
 *   {
 *     sourceKind: 'production-plan' | 'video-file',
 *     videoPath: string|null,        // absolute or relative path to playable master
 *     language: 'en'|'ta'|'si'|...,  // detected or provided
 *     locale: 'en-LK|ta-LK|si-LK...',// configured NaN/None region variant
 *     segments: Array<{ index, start, end, duration, text, captionText }>,
 *     metadata: { article, title, category, jobId, channelVideoId, ... },
 *     warnings: [..]
 *   }
 *
 * Two ingestion adapters:
 *  1. fromProductionPlan() — THE primary, exact adapter. NEWS-MONSTER renders
 *     its own videos from plans, so the transcript is the plan's narration
 *     with exact scene timestamps — no ASR needed for owned content, and the
 *     timing is millisecond-exact by construction.
 *  2. fromVideoFile() — external/legacy content: speech segmentation via
 *     ffmpeg silencedetect (deterministic, zero-cost). A transcript must be
 *     supplied OR an ASR adapter configured (env). Every adapter ships a
 *     fail-loud NEEDS_ASR error instead of fabricating text.
 */
import { spawnSync } from 'child_process'
import fs from 'node:fs'
import path from 'node:path'

export const NEEDS_ASR_ERROR = 'SourceIngest NEEDS_ASR: source video has no transcript and no ASR adapter is configured (set LOCALIZE_ASR_PROVIDER=whisper + LOCALIZE_ASR_API_KEY, or supply transcript)'

/** Attach a speech segmenter that runs when a transcript file is present
 *  (speens align by paragraphs) or per-scene plan text (exact timing). */
export function validateManifest(manifest) {
  const problems = []
  if (!manifest || typeof manifest !== 'object') problems.push('manifest missing')
  else {
    if (!['production-plan', 'video-file'].includes(manifest.sourceKind)) problems.push(`unknown sourceKind ${manifest.sourceKind}`)
    if (!manifest.language) problems.push('language missing (launch with explicit langHint, or plan metadata)')
    if (!Array.isArray(manifest.segments)) problems.push('segments must be an array')
    else {
      let prevEnd = -1
      manifest.segments.forEach((seg, i) => {
        if (typeof seg.start !== 'number' || typeof seg.end !== 'number' || seg.end <= seg.start) problems.push(`segment ${i}: bad timing ${seg.start}..${seg.end}`)
        if (seg.start < prevEnd) problems.push(`segment ${i}: overlaps previous (start ${seg.start} < ${prevEnd})`)
        prevEnd = Math.max(prevEnd, seg.end || 0)
        if (manifest.sourceKind === 'production-plan' && typeof seg.text !== 'string') problems.push(`segment ${i}: production-plan segments must carry narration text`)
      })
    }
  }
  return { ok: problems.length === 0, problems }
}

/**
 * Adapter 1 — exact ingest of an OWNED broadcast before localization.
 * timedScenes: the ScenePlanner-timestamped scenes (start/end are seconds).
 * videoPath: the rendered master (output/final.mp4) even when already published.
 */
export function fromProductionPlan(timedScenes, { language = 'en', locale = 'en-LK', videoPath = null, metadata = {} } = {}) {
  const segments = (timedScenes || [])
    .filter((s) => s && typeof s.start === 'number')
    .map((s, i) => ({
      index: i,
      start: Number(s.start),
      end: Number(s.end),
      duration: Number(s.end) - Number(s.start),
      type: s.type,
      text: String(s.narration || ''),
      // The on-screen caption the localization must keep drawing (VO+captions
      // carry DIFFERENT sentences by design — captions are never a narration
      // dump; they localize independently).
      captionText: String(s.caption || ''),
      captionFocus: s.caption_focus || s.captionFocus || '',
    }))
  const manifest = {
    sourceKind: 'production-plan',
    videoPath,
    language,
    locale,
    segments,
    metadata: {
      title: metadata.title || null,
      article: metadata.article || null,
      jobId: metadata.jobId || null,
      langPackCode: metadata.langPackCode || language,
    },
    warnings: [],
  }
  return manifest
}

/**
 * Adapter 2 — ffmpeg-silencedetect speech segmentation for third-party video.
 * Deterministic (ffmpeg only). If `transcript` is supplied (string, or a .txt
 * file), the silence-detected spans are matched to transcript sentences in
 * order; without a transcript/ASR adapter, segments are returned with
 * `needsASR: true` so callers fail loud (never fabricate text).
 */
export function fromVideoFile(videoPath, { locale = 'en-LK', transcript = null, minSpeechSecs = 1.2, maxSilenceSecs = 0.55 } = {}) {
  if (!fs.existsSync(videoPath)) throw new Error(`SourceIngest: video not found: ${videoPath}`)
  const out = probeSilence(videoPath, maxSilenceSecs)
  const meta = probeMetadata(videoPath)
  // Close trailing silence at file end so the final speech span is emitted.
  if (meta.duration && out.length) {
    const last = out[out.length - 1]
    if (last.end == null) last.end = meta.duration
  }
  let spans = buildSpeechSpans(out, minSpeechSecs)
  // Accept transcript as string OR a .txt file path. Never fabricate text.
  let text = transcript
  if (text && typeof text === 'string' && fs.existsSync(text) && text.toLowerCase().endsWith('.txt')) {
    text = fs.readFileSync(text, 'utf8')
  }
  let sentences = []
  if (text && typeof text === 'string') {
    sentences = text.split(/(?<=[.!?।])\s+/).map((s) => s.trim()).filter(Boolean)
  }
  // No detectable speech spans (continuous bed / no silence gaps) → fail loud
  // with a whole-file span; an empty manifest would silently pass downstream.
  if (!spans.length) {
    spans = meta.duration ? [{ start: 0, end: meta.duration }] : []
  }
  if (spans.length && !sentences.length) {
    return {
      sourceKind: 'video-file',
      videoPath,
      language: null,
      locale,
      segments: spans.map((sp, i) => ({ index: i, start: sp.start, end: sp.end, duration: sp.end - sp.start, text: null, needsASR: true })),
      metadata: { ...meta },
      warnings: [NEEDS_ASR_ERROR],
    }
  }
  // Align transcript sentences to speech spans (zip-align, short end absorbs).
  const n = Math.min(spans.length, sentences.length)
  const segments = spans.slice(0, n === 0 ? spans.length : n).map((sp, i) => ({
    index: i,
    start: sp.start,
    end: sp.end,
    duration: sp.end - sp.start,
    text: sentences[i] ?? null,
    needsASR: sentences[i] == null,
  }))
  if (sentences.length && sentences.length !== spans.length) {
    segments.push(...spans.slice(n).map((sp, i) => ({ index: n + i, start: sp.start, end: sp.end, duration: sp.end - sp.start, text: null, needsASR: true })))
  }
  return {
    sourceKind: 'video-file',
    videoPath,
    language: null,
    locale,
    segments,
    metadata: { ...meta },
    warnings: segments.some((s) => s.needsASR) ? [NEEDS_ASR_ERROR] : [],
  }
}

/** ffmpeg silencedetect run → raw silence ranges (deterministic).
 *  NOTE: ffmpeg writes progress/stats to STDERR, so this must capture
 *  stderr explicitly (execFileSync returns stdout only). */
function probeSilence(videoPath, maxSilenceSecs) {
  const r = spawnSync(
    'ffmpeg',
    ['-i', videoPath, '-af', `silencedetect=noise=-32dB:d=${maxSilenceSecs}`, '-f', 'null', '-'],
    { stdio: ['ignore', 'ignore', 'pipe'], timeout: 300000 }
  )
  if (r.error && r.error.code !== 'ENOENT') throw new Error(`SourceIngest: ffmpeg silencedetect failed: ${r.error.message}`)
  const stderr = (r.stderr ? r.stderr.toString('utf8') : '')
  const silences = []
  let cur = null
  for (const line of stderr.split('\n')) {
    const m = line.match(/silence_start:\s*([\d.]+)/)
    if (m) { cur = { start: parseFloat(m[1]), end: null }; continue }
    const e = line.match(/silence_end:\s*([\d.]+)/)
    if (e && cur) { cur.end = parseFloat(e[1]); silences.push(cur); cur = null }
  }
  if (cur) silences.push(cur) // unterminated final silence; caller closes it
  return silences
}

function buildSpeechSpans(silences, minSpeechSecs) {
  const spans = []
  let cursor = 0
  for (const s of silences) {
    const span = { start: cursor, end: s.start }
    if (span.end - span.start >= minSpeechSecs) spans.push(span)
    cursor = s.end ?? cursor
  }
  if (!silences.length) return []
  return spans.filter((s) => s.end > s.start)
}

/** ffprobe metadata: duration/streams/acodec — evidence for publish gates. */
export function probeMetadata(videoPath) {
  const r = spawnSync('ffprobe', ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', videoPath], { stdio: ['ignore', 'pipe', 'ignore'], timeout: 60000 })
  if (r.error) throw new Error(`SourceIngest: ffprobe failed: ${r.error.message}`)
  const raw = JSON.parse(r.stdout.toString('utf8'))
  const v = (raw.streams || []).find((s) => s.codec_type === 'video')
  const a = (raw.streams || []).find((s) => s.codec_type === 'audio')
  return {
    duration: raw.format?.duration ? Number(raw.format.duration) : null,
    width: v?.width || null,
    height: v?.height || null,
    fps: v?.r_frame_rate ? evalRate(v.r_frame_rate) : null,
    audioCodec: a?.codec_name || null,
    audioChannels: a?.channels || null,
    hasAudio: !!a,
  }
}

function evalRate(rate) {
  try {
    const [n, d] = String(rate).split('/')
    return Number(n) / (Number(d) || 1)
  } catch {
    return null
  }
}

export const _internals = { probeSilence, buildSpeechSpans, evalRate }
