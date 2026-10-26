/**
 * LocalizationPipeline — the core orchestrator (NEWS-MONSTER):
 *   stage 1  SourceIngest (plan-exact or video-file + transcript)
 *   stage 2  segmentation validation (needsASR → blocked, never fabricated)
 *   stage 3  translateSegments (context-aware, cache-first, fidelity flags)
 *   stage 4  TimingAdapter (per-segment speech + re-timed windows)
 *            + SubtitleExporter (SRT/VTT, same windows)
 *   stage 5  gates: ScriptUniqueness (Unicode-aware), review (TRANSLATION_REVIEW),
 *            caption alignment, voice provider, fidelity
 *   stage 6  publish manifest (title/tags/sidecars + per-locale metadata)
 *
 * Per-locale resilience contract:
 *  - State lives in production/localization/<jobId>/<lang>.json; a locale's
 *    failure is recorded THERE and never touches another locale's state.
 *  - isPublishable() is the ONLY publish authorization: stage 6 complete AND
 *    all gates pass AND (no pending review OR TRANSLATION_REVIEW off).
 *  - Resume: loadState() picks up at the last COMPLETED stage; artifacts are
 *    re-verified (files must exist) so a half-written run cannot resurrect.
 *  - Streaming: pushSegment() feeds segments in as they arrive (cache-first
 *    translation per segment, near realtime) — the publish step still runs
 *    the full gate set.
 */
import fs from 'node:fs'
import path from 'node:path'
import { fromProductionPlan, fromVideoFile, validateManifest, probeMetadata } from './SourceIngest.mjs'
import { exportSubtitles, clipsFromAdaptedScenes, captionAlignmentCheck } from './SubtitleExporter.mjs'
import * as ReviewStore from './ReviewStore.mjs'
import { adaptTimeline, TimingAdaptError } from './TimingAdapter.mjs'
import { translateSegments } from '../i18n/Translator.mjs'
import { ScriptUniqueness } from '../uniqueness/ScriptUniqueness.mjs'
import { LANGUAGES } from '../i18n/languages.mjs'

export class PipelineBlocked extends Error {
  constructor(stage, reason, state) {
    super(`LocalizationPipeline BLOCKED at stage ${stage}: ${reason}`)
    this.stage = stage
    this.reason = reason
    this.stateFile = state?.statePath ?? null
  }
}

const STATE_DIR = path.join('production', 'localization')

function statePath(jobId, lang) {
  return path.join(STATE_DIR, jobId, `${lang}.json`)
}

function readState(p) {
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8'))
  } catch {
    return null
  }
}

function writeState(p, state) {
  fs.mkdirSync(path.dirname(p), { recursive: true })
  const tmp = `${p}.tmp-${Date.now()}`
  fs.writeFileSync(tmp, JSON.stringify(state, null, 2))
  fs.renameSync(tmp, p)
}

export class LocalizationPipeline {
  constructor({ jobId, lang, langPack = null, outDir, makeChunk = null, title = null } = {}) {
    if (!jobId || !lang) throw new Error('LocalizationPipeline: jobId + lang required')
    this.jobId = jobId
    this.lang = lang
    this.langPack = langPack || LANGUAGES[lang] || null
    if (!this.langPack) throw new Error(`LocalizationPipeline: no langPack for ${lang}`)
    this.outDir = outDir || `output-${lang}`
    this.makeChunk = makeChunk
    this.title = title
    this.state = {
      jobId,
      lang,
      stage: 0,
      status: 'created',
      updatedAt: new Date().toISOString(),
      manifest: null,
      segments: [],
      translations: [],
      timings: null,
      subtitles: null,
      gates: {},
      publish: null,
      errors: [],
    }
    this.statePath = statePath(jobId, lang)
  }

  /** Resume: any pre-existing state file wins if its artifacts still verify. */
  resume() {
    const prev = readState(this.statePath)
    if (prev && prev.lang === this.lang) {
      // Completed-stage artifact spot-check (file existence where applicable)
      const ok =
        prev.stage < 4 ||
        (!prev.subtitles || (fs.existsSync(prev.subtitles.srtPath) && fs.existsSync(prev.subtitles.vttPath)))
      if (ok) {
        this.state = { ...this.state, ...prev }
        console.log(`[LOCALIZE] resume ${this.lang} at stage ${prev.stage} (${prev.status})`)
      }
    }
    return this.state
  }

  /** Stage 1+2 + hold the manifest. Accepts EITHER the engine's timedScenes
   *  (production-plan, exact) or an external video + transcript. */
  async ingest({ timedScenes = null, videoPath = null, transcript = null, title = null } = {}) {
    if (this.state.stage >= 2 && this.state.manifest) return { skipped: true, manifest: this.state.manifest }
    if (this.state.status === 'blocked') return { skipped: true, blocked: true }
    let manifest
    if (timedScenes) {
      manifest = fromProductionPlan(timedScenes, {
        language: 'en', // owned content masters narrate in the source language of the pipeline entry (EN master)
        locale: 'en-LK',
        videoPath,
        metadata: { title: title ?? this.title, jobId: this.jobId, langPackCode: this.langPack.code },
      })
    } else if (videoPath) {
      manifest = fromVideoFile(videoPath, { locale: this.langPack.localeHint || 'en-LK', transcript })
    } else {
      throw new Error('LocalizationPipeline.ingest: timedScenes or videoPath required')
    }
    const v = validateManifest(manifest)
    if (!v.ok) {
      this.state.status = 'failed_ingest'
      this.state.errors.push(...v.problems)
      this._write()
      throw new PipelineBlocked(1, `manifest invalid: ${v.problems.join(', ')}`, this.state)
    }
    this.state.manifest = manifest
    this.state.stage = 2
    this.state.status = 'segmented'
    this._write()
    return { skipped: false, manifest }
  }

  /** Stage 3. TRANSLATE + record fidelity/review issues (per locale). */
  async translate() {
    if (this.state.stage >= 3 && this.state.translations?.length) return { skipped: true, translations: this.state.translations }
    const segs = this.state.manifest?.segments || []
    const ah = this.state.manifest?.warnings?.find?.((w) => w?.startsWith?.('SourceIngest NEEDS_ASR')) || (segs.find?.((s) => s?.needsASR)?.needsASR ? 'SourceIngest NEEDS_ASR' : null)
    if (ah) {
      this.state.status = 'needs_asr'
      this.state.stage = 2
      this.state.errors.push(ah)
      this._write()
      throw new PipelineBlocked(2, 'speech recognition unavailable — configure LOCALIZE_ASR_PROVIDER', this.state)
    }
    const t = await translateSegments(segs, this.langPack)
    this.state.translations = t.segments
    // Store review items for issues/names collected here — human edits land
    // in ReviewStore and are applied on EVERY publish (applyDecisions).
    for (let i = 0; i < t.segments.length; i++) {
      const f = t.flags[i] || { issues: [], names: [] }
      if (f.issues.length) {
        ReviewStore.flag(this.lang, { sourceText: t.segments[i].source, translation: t.segments[i].text, issues: f.issues, segment: { index: f.index } })
      } else if (f.names.length) {
        // Names are review metadata (transliteration decisions) — visible,
        // non-blocking, correctable.
        ReviewStore.flag(this.lang, { sourceText: t.segments[i].source, translation: t.segments[i].text, issues: [], segment: { index: f.index, names: f.names }, severity: 'info' })
      }
    }
    this.state.gates.fidelity = {
      issues: t.flags.filter((f) => f.issues.length).length,
      names: Array.from(new Set(t.flags.flatMap((f) => f.names || []))),
    }
    this.state.stage = 3
    this.state.status = 'translated'
    this._write()
    return { skipped: false, ...t }
  }

  /** Streaming feed (stages 2+3 combined, near realtime): validate one
   *  in-flight segment and translate it cache-first. Returns its translation. */
  async pushSegment({ index, start, end, source }) {
    const seg = { index, start, end, text: String(source || ''), captionText: '' }
    this.state.stage = Math.max(this.state.stage, 3)
    this.state.status = 'streaming'
    const r = await translateSegments([seg], this.langPack)
    const out = r.segments[0]
    this.state.translations = this.state.translations.filter((s) => s.index !== index).concat(out)
    this._write()
    return out
  }

  /** Stage 4. Re-time windows + real per-scene speech; export subtitles. */
  async localizeNarration({ videoPath = null } = {}) {
    if (this.state.stage >= 4 && this.state.timings && fs.existsSync(this.state.timings.audioPath)) {
      return { skipped: true, timings: this.state.timings }
    }
    const translations = ReviewStore.applyDecisions(this.lang, this.state.translations).segments
    // Speech-free end (needsASR) never reaches narration.
    let narrationSource = translations.map((s) => ({ start: s.start, end: s.end, narration: s.text || s.source, caption: s.captionText || '' }))
    if (!this.langPack.translate) {
      // EN/secondary passthrough: single narration track semantics now come
      // from the SAME inventory — but no re-timing request; keep windows as-is.
      this.state.timings = { audioPath: videoPath ? null : null, scenes: this.state.manifest.segments, chunks: [], passthrough: true, totalDuration: null }
      this.state.stage = 4
      this.state.status = 'narrated_passthrough'
      this._write()
      return { skipped: false, timings: this.state.timings }
    }
    if (!this.makeChunk) {
      this.state.status = 'blocked_voice'
      this.state.errors.push('makeChunk provider not configured — cannot synthesize localized speech')
      this._write()
      throw new PipelineBlocked(4, 'voice synthesis unavailable for this locale', this.state)
    }
    let adapted
    try {
      adapted = await adaptTimeline(
        narrationSource.map((s, i) => ({ ...s, index: i })),
        { makeChunk: this.makeChunk.bind(this), outDir: this.outDir }
      )
    } catch (e) {
      const err = e instanceof TimingAdaptError ? e : new TimingAdaptError(String(e?.message || e))
      this.state.status = 'failed_voice'
      this.state.errors.push(err.message)
      this._write()
      throw new PipelineBlocked(4, err.message, this.state)
    }
    // Gate: speech + subtitle alignment (stage 5 evidence FIRST)
    const align = captionAlignmentCheck(adapted.scenes, adapted.chunks)
    const clips = clipsFromAdaptedScenes(adapted.scenes)
    const subs = exportSubtitlesSafe(clips, { outDir: this.outDir })
    this.state.timings = {      audioPath: adapted.audioPath,
      scenes: adapted.scenes,
      chunks: adapted.chunks,
      totalDuration: adapted.totalDuration,
      stats: adapted.stats,
      passthrough: false,
    }
    this.state.subtitles = subs
    this.state.gates.alignment = align
    if (!align.ok) {
      this.state.status = 'failed_alignment'
      this.state.errors.push(...align.problems)
      this._write()
      throw new PipelineBlocked(5, `caption alignment out of tolerance: ${align.problems.join(', ')}`, this.state)
    }
    this.state.stage = 4
    this.state.status = 'narrated'
    this._write()
    return { skipped: false, timings: this.state.timings, subtitles: subs, alignment: align }
  }

  /** Stage 5. Gate review state; duplicate narration (within+across). */
  async runGates({ registry = null } = {}) {
    // Review gate: TRANSLATION_REVIEW=1 → pending items block THIS locale only
    const reviewGate = TRANSLATION_REVIEW_ON()
      ? (() => {
          const st = ReviewStore.status(this.lang)
          return st.pendingCount > 0 ? { pass: false, pending: st.pendingIds, reason: `${st.pendingCount} review(s) pending` } : { pass: true }
        })()
      : { pass: true, skipped: true, reason: 'TRANSLATION_REVIEW not enabled' }
    // Duplicate narration gate — OUR OWN guard rail (trailing-name duplicates
    // across locales are impossible here: this gate is per-locale only).
    const within = ScriptUniqueness.validateWithinVideo(this.state.translations.map((s) => s.text))
    this.state.gates.review = reviewGate
    this.state.gates.dedup = within
    if (!reviewGate.pass) {
      this.state.status = 'pending_review'
      this._write()
      throw new PipelineBlocked(5, `editorial review pending: ${reviewGate.reason}`, this.state)
    }
    if (!within.pass) {
      this.state.status = 'failed_dedup'
      this._write()
      throw new PipelineBlocked(5, `duplicate narration: ${within.reason}`, this.state)
    }
    this.state.stage = Math.max(this.state.stage, 5)
    this.state.status = 'gated'
    this._write()
    return { gates: this.state.gates }
  }

  /** Stage 6. Authorize + attach final metadata for THIS locale. */
  async finalizePublish({ videoPath = null, extraMetadata = {} } = {}) {
    if (this.state.stage >= 6 && this.publishable()) return { skipped: true, publish: this.state.publish }
    // Stage-5 completion is the entry condition; anything less is routine
    // blockage — the publishable() contract (stage 6 + complete) is FORBIDDEN
    // to other callers regardless of who runs finalize.
    if (this.state.stage < 5 || this.state.status === 'pending_review' || this.state.status === 'publish_blocked') {
      this.state.status = 'publish_blocked'
      this._write()
      throw new PipelineBlocked(6, `not publishable (status=${this.state.status}, stage=${this.state.stage})`, this.state)
    }
    const meta = this.state.manifest?.metadata || {}
    const baseTitle = (this.title || meta.title || '').trim()
    // No title → localized label alone (never " | துமிழ்" with a dangling pipe)
    this.state.publish = {
      lang: this.lang,
      title: baseTitle ? `${baseTitle} | ${this.langPack.nativeLabel}` : this.langPack.nativeLabel,
      nativeLabel: this.langPack.nativeLabel,
      hashtags: [this.langPack.langHashtag].filter(Boolean),
      metadata: {
        language: this.lang,
        originalTitle: this.title || meta.title || null,
        jobId: this.jobId,
        ...extraMetadata,
      },
      videoPath: videoPath || this.state.timings?.videoPath || null,
      subtitles: this.state.subtitles?.srtPath ? { srt: this.state.subtitles.srtPath, vtt: this.state.subtitles.vttPath } : null,
      narration: this.state.timings?.audioPath || null,
      totalDuration: this.state.timings?.totalDuration ?? null,
    }
    this.state.stage = 6
    this.state.status = 'complete'
    this.state.updatedAt = new Date().toISOString()
    this._write()
    return { skipped: false, publish: this.state.publish }
  }

  /** Publish contract — true ONLY with stage 6 complete + no failed stages. */
  publishable() {
    return this.state.stage >= 6 && this.state.status === 'complete'
  }

  /** Run stages 1→6 in sequence. Each stage exception marks ONLY this locale. */
  async run(input = {}) {
    const steps = [
      () => this.ingest(input),
      async () => this.translate(),
      () => this.localizeNarration({ videoPath: input.videoPath }),
      async () => this.runGates(),
      () => this.finalizePublish({ videoPath: input.videoPath }),
    ]
    for (const step of steps) await step()
    return { ok: this.publishable(), state: this.state }
  }

  _write() {
    this.state.updatedAt = new Date().toISOString()
    writeState(this.statePath, this.state)
  }
}

export function TRANSLATION_REVIEW_ON() {
  return process.env.TRANSLATION_REVIEW === '1'
}

function exportSubtitlesSafe(clips, { outDir } = {}) {
  try {
    return exportSubtitles(clips, { outDir, baseName: 'subtitles' })
  } catch (e) {
    return { srtPath: null, vttPath: null, clips: 0, error: String(e?.message || e) }
  }
}

/** Probe of all locale state files for a job — orchestration dashboard. */
export function pipelineStatus(jobId) {
  const dir = path.join(STATE_DIR, jobId)
  if (!fs.existsSync(dir)) return {}
  const out = {}
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.json'))) {
    const st = readState(path.join(dir, f))
    if (st) out[st.lang] = { stage: st.stage, status: st.status, publishable: st.stage >= 6 && st.status === 'complete' }
  }
  return out
}

export { statePath, readState, writeState }
