// Caption Track Publisher — uploads one variant's caption sidecar as a real
// YouTube caption track (captions.insert), idempotently.
//
// CONTRACT (Task-131):
//   * NON-FATAL, always: the video is already published when this runs — a
//     caption failure must never fail the pipeline stage nor change the
//     exit status. Every invocation resolves with a terminal state object:
//       { status: 'uploaded' | 'exists' | 'failed' | 'skipped', ... }
//   * IDEMPOTENT, two layers:
//       1. Local store (CaptionsStateStore, data/captions-state.json, keyed
//          videoId|language) — zero-API fast path when already 'uploaded'.
//       2. Remote truth (captions.list): a manual track for the same
//          language means 'exists'; YouTube's own 409 captionExists backstop
//          covers any store-vs-remote divergence window.
//   * RETRY: transient failures (429/5xx/network) retried via
//     withTransientRetry — never 4xx-class rejections (each costly insert
//     attempt is 400 quota units).
//
// Retry/stored error normalization: youtube.js caption errors always carry
// `.status`; fetch-layer failures get a synthetic 503 so the stock
// isTransientError treats them as transient — shared error code untouched.
import { existsSync, statSync, readFileSync } from 'node:fs'
import { CaptionsStateStore } from './CaptionsStateStore.mjs'
import { withTransientRetry } from './retry.mjs'

const MAX_TRACK_BYTES = 5 * 1024 * 1024 // sanity bound (API allows 100MB; sidecars are KBs)

function normalizeError(error) {
  const err = error instanceof Error ? error : new Error(String(error))
  if (typeof err.status !== 'number') {
    if (typeof err.httpStatus === 'number') err.status = err.httpStatus
    else if (err.name === 'AbortError' || /timeout|fetch failed|network/i.test(String(err.message || ''))) err.status = 503
  }
  return err
}

// The actual captions.list response does NOT emit `trackKind` (verified live
// on the channel's caption rows on 2026-10-27) — machine/ASR tracks surface
// instead with an EMPTY name, while every operator insert names its track.
// Discriminating on name keeps auto tracks from blocking our upload, while
// an existing named track for the language (a prior run of ours) means done.
function isOurDuplicate(track, language) {
  if (!track || !languageMatches(track.language, language)) return false
  if (String(track.trackKind || '').toLowerCase() === 'asr') return false // future-proof
  return String(track.name || '').trim().length > 0
}

function languageMatches(a, b) {
  return String(a || '').toLowerCase() === String(b || '').toLowerCase()
}

export async function publishCaptionTrack(options = {}, deps = {}) {
  const {
    videoId,
    srtPath,
    language,
    name,
    attempts = 3,
    verifyRemote = true,
    forceRemoteCheck = false,
    skipFastWhenUploaded = true,
    storeFile = null,
  } = options

  const store = new CaptionsStateStore({ file: storeFile })

  try {
    if (!videoId || !language) {
      return { status: 'skipped', reason: 'CAPTION_INPUT_MISSING', attempts: 0 }
    }
    if (!srtPath || !existsSync(srtPath)) {
      return { status: 'skipped', reason: 'NO_SIDECAR', attempts: 0 }
    }
    if (!statSync(srtPath).size) {
      return { status: 'skipped', reason: 'EMPTY_SIDECAR', attempts: 0 }
    }
    if (statSync(srtPath).size > MAX_TRACK_BYTES) {
      store.record({ videoId, language, name, status: 'failed', attempts: 0, lastError: `CAPTION_SIDECAR_TOO_LARGE: ${statSync(srtPath).size} bytes`, file: srtPath })
      return { status: 'failed', error: 'CAPTION_SIDECAR_TOO_LARGE', attempts: 0 }
    }

    // Layer 1 fast path — local truth, zero API units.
    const prev = store.get(videoId, language)
    if (skipFastWhenUploaded && prev?.status === 'uploaded' && !forceRemoteCheck) {
      console.log(`[YOUTUBE_CAPTIONS] skip (state=uploaded) language=${language} videoId=${videoId} trackId=${prev.trackId || 'n/a'}`)
      return { status: 'skipped', reason: 'ALREADY_UPLOADED_STATE', trackId: prev.trackId || null, attempts: 0 }
    }

    // Resolve the publisher lazily so tests can inject a fake transport
    // (`deps._publisher`) without network or quota.
    const publisher = deps._publisher || await import('../../apps/api/publishers/youtube.js')
    const { listCaptionTracks, insertCaptionTrack, classifyCaptionInsertError } = publisher
    const trackName = String(name || language.toUpperCase())

    // Layer 2 — remote truth (captions.list, 50 units).
    let existing = []
    if (verifyRemote) {
      try {
        existing = await listCaptionTracks(videoId)
      } catch (e) {
        const err = normalizeError(e)
        // Listing is advisory: a duplicate is still caught by 409 on insert.
        console.warn(`[YOUTUBE_CAPTIONS] list failed (continuing — 409 backstop applies): language=${language} status=${err.status || 'n/a'} error=${err.message}`)
      }
    }
    const duplicate = (Array.isArray(existing) ? existing : []).find(
      (t) => isOurDuplicate(t, language),
    )
    if (duplicate) {
      store.record({ videoId, language, name: trackName, status: 'exists', trackId: duplicate.id, attempts: 0, file: srtPath })
      console.log(`[YOUTUBE_CAPTIONS] exists on YouTube language=${language} videoId=${videoId} trackId=${duplicate.id} name="${duplicate.name || 'n/a'}" — skipping insert`)
      return { status: 'exists', trackId: duplicate.id, remoteName: duplicate.name || null, attempts: 0 }
    }

    // Upload with bounded transient retry. attemptCount is measured here (not
    // handed by the retry helper) so store accounting works with any retry impl.
    let attemptCount = 0
    let uploaded = null
    try {
      uploaded = await withTransientRetry(async () => {
        attemptCount++
        try {
          return await insertCaptionTrack({ videoId, language, name: trackName, filePath: srtPath })
        } catch (e) {
          throw normalizeError(e)
        }
      }, {
        attempts,
        // Test-facing tuning knobs only; production uses the stock backoff.
        ...(options.retryBaseMs != null ? { baseMs: options.retryBaseMs } : {}),
        ...(options.retryMaxMs != null ? { maxMs: options.retryMaxMs } : {}),
      })
    } catch (e) {
      const err = normalizeError(e)
      const failed409 = err.status === 409 || /captionExists/i.test(String(err.reason || '') + JSON.stringify(err.youtubeError || ''))
      if (failed409) {
        // Raced duplicate insert (e.g. concurrent backfill) → record 'exists',
        // NOT failed: the end state the user wants already holds.
        store.record({ videoId, language, name: trackName, status: 'exists', attempts: attemptCount, lastError: null, file: srtPath })
        console.log(`[YOUTUBE_CAPTIONS] exists (409 backstop) language=${language} videoId=${videoId} — nothing to do`)
        return { status: 'exists', attempts: attemptCount, reason: 'CAPTION_EXISTS_BACKSTOP' }
      }
      const classification = typeof classifyCaptionInsertError === 'function'
        ? classifyCaptionInsertError(err, err.status)
        : { class: 'CAPTION_UPLOAD_FAILED', action: 'QUARANTINE', reason: 'no classifier' }
      store.record({
        videoId, language, name: trackName, status: 'failed',
        attempts: attemptCount || 1, lastError: err.message, file: srtPath,
      })
      console.warn(`[YOUTUBE_CAPTIONS] failed language=${language} videoId=${videoId} attempts=${attemptCount || 1} class=${classification.class} action=${classification.action} error=${err.message} (video remains published)`)
      return { status: 'failed', error: err.message, attempts: attemptCount || 1, classification }
    }

    store.record({
      videoId, language, name: trackName, status: 'uploaded',
      trackId: uploaded.id, attempts: attemptCount, file: srtPath,
    })
    console.log(`[YOUTUBE_CAPTIONS] uploaded language=${language} videoId=${videoId} trackId=${uploaded.id} bytes=${uploaded.bytes} attempts=${attemptCount}`)
    return { status: 'uploaded', trackId: uploaded.id, attempts: attemptCount, bytes: uploaded.bytes }
  } catch (unexpected) {
    // Absolute non-fatal guarantee — a bug here must not break the pipeline.
    const message = unexpected?.message || String(unexpected)
    try {
      store.record({ videoId, language, name: name || null, status: 'failed', attempts: 1, lastError: message, file: srtPath || null })
    } catch { /* store write failures are equally non-fatal */ }
    console.warn(`[YOUTUBE_CAPTIONS] unexpected failure (non-fatal): ${message}`)
    return { status: 'failed', error: message, attempts: 0 }
  }
}

// Re-export for callers that want probe-sidecar validation without network:
// the sidecar must start with an SRT sequence counter or a WEBVTT header —
// the cheapest insurance against uploading a garbage/empty artifact. Kept
// advisory (off the insert path) so SubtitleExporter output evolution can't
// silently block caption uploads.
export function sidecarLooksValid(srtPath) {
  try {
    const head = readFileSync(srtPath, 'utf8').slice(0, 4096)
    return /^\s*\d+(?:\r?\n|$)/.test(head) || /^\uFEFF?WEBVTT/.test(head)
  } catch {
    return false
  }
}
