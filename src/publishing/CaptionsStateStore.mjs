import fs from 'fs'
import path from 'path'

// Captions State Store — per-language idempotency ledger for YouTube caption
// track uploads (Task-131). Companion to PublishEventsStore: publish-events
// answers "what did we publish?", this answers "what caption tracks did we
// upload, and should we skip/retry?".
//
// One entry per (videoId, language):
//   {
//     "y9PnwMVyA7U|si": {
//       "videoId": "y9PnwMVyA7U",
//       "language": "si",
//       "name": "සිංහල",
//       "status": "uploaded",        // uploaded | exists | failed | skipped
//       "trackId": "AUg…",           // YouTube caption resource id, when known
//       "attempts": 3,               // ACCUMULATES across runs (never reset)
//       "lastError": null,           // cleared on success, kept on failure
//       "file": "output-si/captions.srt",
//       "updatedAt": "2026-10-27T…"
//     }
//   }
//
// status meanings:
//   uploaded → actual captions.insert 2xx (authoritative)
//   exists   → track already on YouTube (remote list match or 409 captionExists)
//   failed   → all attempts exhausted / unrecoverable error; caller may retry
//   skipped  → nothing uploaded by design (no sidecar, disabled env, etc.)
export class CaptionsStateStore {
  constructor(options = {}) {
    this.file = options.file || path.resolve(process.cwd(), 'data', 'captions-state.json')
    this.state = this._load()
  }

  _load() {
    try {
      if (fs.existsSync(this.file)) {
        const parsed = JSON.parse(fs.readFileSync(this.file, 'utf-8'))
        // Corrupt or wrong-shape files regenerate as empty — the remote
        // captions.list/409 checks remain the real idempotency backstop.
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed
      }
    } catch { /* ignore — regenerated on next record() */ }
    return {}
  }

  static key(videoId, language) {
    return `${videoId}|${language}`
  }

  get(videoId, language) {
    return this.state[CaptionsStateStore.key(videoId, language)] || null
  }

  all() {
    // Defensive copy — callers may pass this around without mutating the store.
    return { ...this.state }
  }

  isUploaded(videoId, language) {
    return this.get(videoId, language)?.status === 'uploaded'
  }

  record({ videoId, language, name = null, status, trackId = null, attempts = 1, lastError = null, file = null }) {
    if (!videoId || !language) throw new Error('CAPTION_STATE_RECORD_INVALID: videoId/language required')
    if (!status) throw new Error('CAPTION_STATE_RECORD_INVALID: status required')

    const key = CaptionsStateStore.key(videoId, language)
    const prev = this.state[key] || {}
    const entry = {
      videoId,
      language,
      name: name ?? prev.name ?? null,
      status,
      trackId: trackId ?? prev.trackId ?? null,
      // Attempts ACCUMULATE across publishing runs — a failed run's spent
      // calls are never erased by the retry run that finally succeeded.
      attempts: (Number(prev.attempts) || 0) + (Number(attempts) || 0),
      lastError: status === 'failed' ? (lastError || prev.lastError || null) : null,
      file: file ?? prev.file ?? null,
      updatedAt: new Date().toISOString(),
    }

    this.state[key] = entry
    this._save()
    return entry
  }

  _save() {
    fs.mkdirSync(path.dirname(this.file), { recursive: true })
    fs.writeFileSync(this.file, JSON.stringify(this.state, null, 2))
  }
}
