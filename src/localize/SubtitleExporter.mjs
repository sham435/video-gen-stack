/**
 * SubtitleExporter — stage 4 (localized subtitles) of the LocalizationPipeline.
 *
 * Emits WebVTT and SubRip sidecars from TIMED segments. Timing source is the
 * SAME adapted window data the narration engine uses (TimingAdapter output or
 * per-plan windows for EN), so subtitles and speech can never disagree about
 * when a line is spoken — a single makeClip()/format + window math shared by
 * both.
 *
 * Unicode contract: content is written as UTF-8; Tamil/Sinhala codepoints are
 * preserved verbatim. SRT/VTT text may contain soft wraps; the renderer
 * (canvas captions) uses its own layout, NOT these files.
 *
 * Also provided: captionAlignmentCheck() — stage-5 gate. Computes per-caption
 * drift between adapted windows and the actual chunk audio to prove the
 * "speech+subtitles aligned within tolerance" guarantee (evidence, not Hope).
 */
import fs from 'node:fs'
import path from 'node:path'

function srtStamp(sec) {
  const h = Math.floor(sec / 3600)
  const m = Math.floor((sec % 3600) / 60)
  const s = Math.floor(sec % 60)
  const ms = Math.round((sec - Math.floor(sec)) * 1000)
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')},${String(ms).padStart(3, '0')}`
}

function vttStamp(sec) {
  return srtStamp(sec).replace(',', '.')
}

/** clips: [{ start, end, text }] seconds. */
export function toSRT(clips) {
  return clips
    .filter((c) => c && typeof c.text === 'string' && c.text.trim() && Number.isFinite(c.start) && Number.isFinite(c.end) && c.end > c.start)
    .map((c, i) => `${i + 1}\n${srtStamp(c.start)} --> ${srtStamp(Math.max(c.end, c.start + 0.4))}\n${c.text.trim()}\n`)
    .join('\n')
}

export function toVTT(clips) {
  return `WEBVTT\n\n${toSRT(clips).replace(/,/g, '.')}`
}

/** Main export: writes both sidecars, returns their paths + clip stats. */
export function exportSubtitles(clips, { outDir, baseName = 'subtitles' } = {}) {
  if (!outDir) throw new Error('SubtitleExporter: outDir required')
  fs.mkdirSync(outDir, { recursive: true })
  const srt = path.join(outDir, `${baseName}.srt`)
  const vtt = path.join(outDir, `${baseName}.vtt`)
  fs.writeFileSync(srt, toSRT(clips), 'utf8')
  fs.writeFileSync(vtt, toVTT(clips), 'utf8')
  const used = clips.filter((c) => c && c.text && c.text.trim() && c.end > c.start)
  return { srtPath: srt, vttPath: vtt, clips: used.length, totalDuration: round2(used.length ? used[used.length - 1].end : 0) }
}

/**
 * Stage-5 alignment gate. For each audio chunk, find the adapted window that
 * owns its audioStart; captions anchored to that window must start within
 * tolerance of the audio and the window must NOT cut the audio short.
 * Returns { ok, maxDrift, problems } — ok=false means subtitles/speech drift.
 */
export function captionAlignmentCheck(adaptedScenes, chunks, { tolerance = 0.6 } = {}) {
  const problems = []
  let maxDrift = 0
  for (const c of chunks || []) {
    const sc = (adaptedScenes || [])[c.sceneIndex]
    if (!sc) { problems.push(`chunk scene#${c.sceneIndex}: no adapted scene`); continue }
    const drift = Math.abs(round2(Number(sc.start) - Number(c.audioStart)))
    maxDrift = Math.max(maxDrift, drift)
    if (drift > tolerance) problems.push(`scene#${c.sceneIndex}: caption window drift ${drift.toFixed(3)}s > ${tolerance}s`)
    const window = (Number(sc.end) || 0) - (Number(sc.start) || 0)
    if (window < c.duration - tolerance) problems.push(`scene#${c.sceneIndex}: window ${window.toFixed(2)}s shorter than speech ${c.duration.toFixed(2)}s`)
  }
  return { ok: problems.length === 0, maxDrift: round2(maxDrift), problems }
}

/** Build export clips from the ADAPTED scenes: narration-bearing windows carry
 *  spoken subtitle text; caption-only windows carry their on-screen caption. */
export function clipsFromAdaptedScenes(adaptedScenes, { includeCaptions = true } = {}) {
  return (adaptedScenes || [])
    .filter((s) => Number.isFinite(s.start) && Number.isFinite(s.end) && s.end > s.start)
    .map((s) => ({
      start: Number(s.start),
      end: Number(s.end),
      text: (s.narration && String(s.narration).trim()) || (includeCaptions && s.caption ? String(s.caption).trim() : ''),
    }))
    .filter((c) => c.text)
}

function round2(x) {
  return Math.round(Number(x) * 1000) / 1000
}

export const _internals = { srtStamp, vttStamp, round2 }
