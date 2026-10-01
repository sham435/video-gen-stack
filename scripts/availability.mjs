/**
 * availability.mjs — FEED-002 YouTube availability reconciliation.
 *
 * Distinguishes "SUCCESS at publication time" from "PUBLIC right now".
 * A video can be published (upload SUCCESS + post-publish verification
 * passed) yet later become PRIVATE, DELETED, or unverifiable. The landing
 * page must only ever list videos that are PUBLIC *today*.
 *
 * Pipeline position (see docs/DATA_CONTRACTS.md §10):
 *
 *   accumulated publication sources
 *        │
 *        ▼
 *   dedupe (mergeVerifiedPublicationSources)
 *        │
 *        ▼
 *   schema validation (toVideoEntry)
 *        │
 *        ▼
 *   YouTube availability reconciliation  ◄── this module
 *        │   PUBLIC │ PRIVATE │ DELETED │ UNKNOWN
 *        ▼         └─────────┴─────────┴────────┘
 *   PUBLIC only          retained in data/availability-state.json
 *        ▼
 *   public/videos.json → landing page (static, deterministic)
 *
 * States:
 *   PUBLIC   — privacyStatus === "public"            → include in feed
 *   PRIVATE  — privacyStatus === "private"           → excluded
 *   UNLISTED — privacyStatus === "unlisted"          → excluded
 *   DELETED  — id absent from videos.list response   → excluded
 *   UNKNOWN  — API outage/quota/network/ambiguous    → excluded (fail closed)
 *
 * Invariants:
 *   - Never fabricates a state (no id → DELETED is inferred only when the
 *     API responded OK for that batch; a batch that 5xx/quota → UNKNOWN).
 *   - Never deletes history: every checked videoId is recorded in
 *     data/availability-state.json keyed by videoId.
 *   - Batch size 50 (YouTube videos.list limit) → 2 calls for 57 videos.
 *   - Fail closed: ANY indeterminate video is excluded from the public feed.
 *
 * Auth: YOUTUBE_REFRESH_TOKEN + YOUTUBE_CLIENT_ID + YOUTUBE_CLIENT_SECRET
 * (OAuth refresh flow, same as PostPublishVerifier) or YOUTUBE_API_KEY.
 */

import { writeFileSync, readFileSync, existsSync, mkdirSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
export const AVAILABILITY_STATE_PATH = resolve(__dirname, '..', 'data', 'availability-state.json')

const YOUTUBE_API = 'https://www.googleapis.com/youtube/v3'
const OAUTH_TOKEN_URL = 'https://oauth2.googleapis.com/token'
const BATCH_SIZE = 50 // videos.list id= comma limit

export const Availability = Object.freeze({
  PUBLIC: 'PUBLIC',
  PRIVATE: 'PRIVATE',
  UNLISTED: 'UNLISTED',
  DELETED: 'DELETED',
  UNKNOWN: 'UNKNOWN',
})

/** Classify a single privacyStatus value. Unknown/missing → UNKNOWN (fail closed). */
export function classifyPrivacyStatus(privacyStatus) {
  if (privacyStatus === 'public') return Availability.PUBLIC
  if (privacyStatus === 'private') return Availability.PRIVATE
  if (privacyStatus === 'unlisted') return Availability.UNLISTED
  return Availability.UNKNOWN
}

/** Split ids into ≤BATCH_SIZE chunks (YouTube videos.list id= limit). */
export function chunkIds(ids, batchSize = BATCH_SIZE) {
  const chunks = []
  for (let i = 0; i < ids.length; i += batchSize) chunks.push(ids.slice(i, i + batchSize))
  return chunks
}

/** Exchange the refresh token for an access token (OAuth refresh flow). */
export async function getAccessToken({
  refreshToken = process.env.YOUTUBE_REFRESH_TOKEN,
  clientId = process.env.YOUTUBE_CLIENT_ID,
  clientSecret = process.env.YOUTUBE_CLIENT_SECRET,
} = {}) {
  if (!refreshToken || !clientId || !clientSecret) {
    throw new Error('missing YOUTUBE_REFRESH_TOKEN/YOUTUBE_CLIENT_ID/YOUTUBE_CLIENT_SECRET')
  }
  const resp = await fetch(OAUTH_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    }),
    signal: AbortSignal.timeout(15000),
  })
  const data = await resp.json().catch(() => ({}))
  if (!data.access_token) throw new Error(`YouTube token refresh failed: ${data.error || resp.status}`)
  return data.access_token
}

/**
 * Query YouTube videos.list?part=status for one batch of ≤50 ids.
 * Returns a Map<videoId, { availability, checkedAt }>.
 * Missing ids (API responded OK but video absent) → DELETED.
 * Batch-level failure (quota/5xx/network) → every id in the batch gets
 * UNKNOWN — fail closed, never guess.
 */
export async function checkBatchAvailability(videoIds, {
  token,
  apiKey,
  fetchImpl = fetch,
  timeoutMs = 20000,
  checkedAt = new Date().toISOString(),
} = {}) {
  const results = new Map()
  if (!videoIds.length) return results
  for (const chunk of chunkIds(videoIds)) {
    const url = `${YOUTUBE_API}/videos?part=status&id=${chunk.join(',')}${apiKey ? `&key=${apiKey}` : ''}`
    let resp
    try {
      resp = await fetchImpl(url, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        signal: AbortSignal.timeout(timeoutMs),
      })
    } catch (e) {
      // Network/abort — cannot know whether these videos still exist.
      for (const id of chunk) results.set(id, { availability: Availability.UNKNOWN, checkedAt, reason: String(e?.message || e) })
      continue
    }
    if (!resp.ok) {
      const reason = `HTTP ${resp.status}`
      for (const id of chunk) results.set(id, { availability: Availability.UNKNOWN, checkedAt, reason })
      continue
    }
    const data = await resp.json().catch(() => ({}))
    const items = Array.isArray(data?.items) ? data.items : []
    const found = new Set(items.map(i => i?.id))
    const statusById = new Map(items.map(i => [i?.id, i?.status?.privacyStatus]))
    for (const id of chunk) {
      if (!found.has(id)) {
        // API responded OK for the whole batch but this id is not in the
        // result — YouTube omits deleted and invalid videos.
        results.set(id, { availability: Availability.DELETED, checkedAt, reason: 'absent from videos.list' })
      } else {
        const privacyStatus = statusById.get(id)
        results.set(id, { availability: classifyPrivacyStatus(privacyStatus), checkedAt, privacyStatus })
      }
    }
  }
  return results
}

/**
 * Read previously persisted availability state. Absent/corrupt → empty map.
 * @returns {Map<videoId, {availability, checkedAt}>}
 */
export function readAvailabilityState() {
  const state = new Map()
  if (!existsSync(AVAILABILITY_STATE_PATH)) return state
  try {
    const data = JSON.parse(readFileSync(AVAILABILITY_STATE_PATH, 'utf-8'))
    for (const [id, rec] of Object.entries(data?.videos || {})) {
      if (id && rec) state.set(id, { ...rec })
    }
  } catch {
    // corrupt state — treat as empty, next run rebuilds it
  }
  return state
}

/**
 * Persist availability state. Append-only in spirit: never deletes an
 * existing key, only adds/updates the checked videoIds for this run.
 * @param {Map<videoId, {availability, checkedAt, reason?, privacyStatus?}>} results
 */
export function writeAvailabilityState(results, checkedAt = new Date().toISOString()) {
  const prior = {}
  if (existsSync(AVAILABILITY_STATE_PATH)) {
    try { Object.assign(prior, JSON.parse(readFileSync(AVAILABILITY_STATE_PATH, 'utf-8'))?.videos || {}) } catch { /* rebuild */ }
  }
  for (const [id, rec] of results) {
    prior[id] = { availability: rec.availability, checkedAt: rec.checkedAt || checkedAt }
    if (rec.reason) prior[id].reason = rec.reason
    if (rec.privacyStatus) prior[id].privacyStatus = rec.privacyStatus
  }
  const out = {
    updatedAt: checkedAt,
    schema: 'availability-state@1',
    videos: prior,
  }
  if (!existsSync(dirname(AVAILABILITY_STATE_PATH))) mkdirSync(dirname(AVAILABILITY_STATE_PATH), { recursive: true })
  writeFileSync(AVAILABILITY_STATE_PATH, JSON.stringify(out, null, 2))
  return out
}

/**
 * Pure gate: apply availability results to a schema-validated feed and keep
 * only PUBLIC videos. Returns { available, excluded } (both arrays).
 * Never mutates the input. UNKNOWN/PRIVATE/UNLISTED/DELETED are excluded.
 * @param {Array} entries  schema-validated video entries (from toVideoEntry)
 * @param {Map<videoId, {availability}>} availability
 */
export function applyAvailabilityGate(entries, availability) {
  const available = []
  const excluded = []
  for (const entry of entries) {
    const rec = availability.get(entry.id)
    const state = rec?.availability || Availability.UNKNOWN
    const tagged = { ...entry, availability: state, availabilityCheckedAt: rec?.checkedAt || null }
    if (state === Availability.PUBLIC) available.push(tagged)
    else excluded.push({ id: entry.id, availability: state, checkedAt: rec?.checkedAt || null, reason: rec?.reason || null })
  }
  return { available, excluded }
}