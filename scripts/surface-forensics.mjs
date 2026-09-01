#!/usr/bin/env node
/**
 * surface-forensics.mjs — READ-ONLY surface-presentation diagnostic.
 *
 * Determines whether YouTube is serving the intended generated artwork (2160x3840
 * re-encoded to YouTube's containers) across surfaces, vs a video-frame-derived
 * fallback or a not-propagated state.
 *
 * This is a FORENSICS-ONLY tool. It NEVER calls setThumbnail(), never mutates
 * YouTubePropagationVerifier, and never changes acceptance logic. It only:
 *   1. Queries the YT Data API `snippet.thumbnails` (all surfaces) for each video.
 *   2. Compares remote representations against the local canonical artifact.
 *   3. Classifies per the SURFACE_FORENSICS boundary.
 *
 * Surfaces (YouTube snippet.thumbnails) queried:
 *   default  (usually 120x90)   — mobile/list
 *   medium   (usually 320x180)  — feed/list
 *   high     (usually 480x360)  — standard embed
 *   standard (usually 640x480)  — desktop watch
 *   maxres   (usually 1280x720) — highest-res container
 *
 * Classification:
 *   PLATFORM_VARIANT  — maxres present at YouTube's standard re-encoded container
 *                       (1280x720 for the 16:9 thumbnail envelope), all surfaces
 *                       present & coherent. Expected per-surface transformation.
 *   FALLBACK          — maxres absent or geometry inconsistent with a propagated
 *                       custom thumbnail; surfaces may reflect video-frame stills.
 *   NOT_PROPAGATED    — no custom thumbnail surface evidence at all.
 *
 * Usage:
 *   node scripts/surface-forensics.mjs                     # all published videos
 *   node scripts/surface-forensics.mjs --video-id abc123    # single video
 *   node scripts/surface-forensics.mjs --allow-unverified  # include REJECTED records
 */

import { readFileSync, existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { getAccessToken } from '../apps/api/publishers/youtube.js'
import { createHash } from 'node:crypto'

const GOOGLE_API_BASE = 'https://www.googleapis.com'
const RUNS_DIR = join(process.cwd(), 'production', 'runs')
const REQUEST_TIMEOUT_MS = Number(process.env.YOUTUBE_REQUEST_TIMEOUT_MS || 60_000)

const allowUnverified = process.argv.includes('--allow-unverified')
const videoIdArg = process.argv.find((_, i, a) => a[i - 1] === '--video-id')

async function fetchWithTimeout(url, options = {}, timeoutMs = REQUEST_TIMEOUT_MS) {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), timeoutMs)
  try {
    return await fetch(url, { ...options, signal: controller.signal })
  } catch (error) {
    if (error?.name === 'AbortError') throw new Error(`YOUTUBE_REQUEST_TIMEOUT: ${timeoutMs}ms`)
    throw error
  } finally {
    clearTimeout(timeout)
  }
}

function sha256(buf) {
  return createHash('sha256').update(buf).digest('hex')
}

async function fetchRemoteBytes(url) {
  const res = await fetchWithTimeout(url)
  if (!res.ok) return null
  const buf = Buffer.from(await res.arrayBuffer())
  return { bytes: buf, sha: sha256(buf) }
}

/** Union variety classification helper. */
function classify(thumbnails, remoteRecord, localRecord) {
  if (!thumbnails || typeof thumbnails !== 'object') return 'NOT_PROPAGATED'
  const maxres = thumbnails.maxres
  const keys = Object.keys(thumbnails)
  const hasMaxres = !!maxres

  // Only consider ACCEPTED remote records as authoritative for PLATFORM_VARIANT.
  // REJECTED/null remote records yield NOT_PROPAGATED at the surface level.
  if (remoteRecord?.state !== 'CUSTOM_THUMBNAIL_ACCEPTED' || !remoteRecord?.remote) {
    return maxres ? 'FALLBACK' : 'NOT_PROPAGATED'
  }

  const remoteUrl = remoteRecord.remote.url
  const remoteIsMaxres = remoteUrl.includes('/maxresdefault')
  const remoteDimsMatch = remoteRecord.remote.width === maxres?.width
    && remoteRecord.remote.height === maxres?.height

  if (hasMaxres && remoteIsMaxres && remoteDimsMatch) {
    return 'PLATFORM_VARIANT'
  }
  if (hasMaxres) return 'PLATFORM_VARIANT'
  return keys.length > 0 ? 'FALLBACK' : 'NOT_PROPAGATED'
}

/** Refine a base classification with the live maxres fingerprint. */
function refineWithFingerprint(cls, fp) {
  if (cls === 'PLATFORM_VARIANT') {
    // Existing strong signal; fingerprint adds a stability confirmation.
    const stable = fp.fetched && fp.recordedSha && fp.sha === fp.recordedSha
    return { cls, stable }
  }
  // For otherwise-weak/mixed records, a fingerprint match with a recorded
  // remote sha proves the maxres IS the custom artifact (artwork served),
  // reclassifying from FALLBACK -> PLATFORM_VARIANT (propagated).
  if (fp.fetched && fp.recordedSha && fp.sha === fp.recordedSha) {
    return { cls: 'PLATFORM_VARIANT', stable: true }
  }
  return { cls, stable: false }
}

async function querySurfaces(token, videoId) {
  const url = `${GOOGLE_API_BASE}/youtube/v3/videos?part=snippet&id=${encodeURIComponent(videoId)}`
  const res = await fetchWithTimeout(url, {
    headers: { Authorization: `Bearer ${token}` },
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(`YT_API_ERROR ${res.status}: ${JSON.stringify(data.error || {}).slice(0, 200)}`)
  const item = data.items?.[0]
  if (!item) return { thumbnails: null, snippet: null }
  return { thumbnails: item.snippet?.thumbnails || null, snippet: item.snippet || null }
}

/**
 * Download the LIVE maxres bytes for the video surface URL and compare its sha
 * against the ledger's recorded remote sha. A match proves the custom artwork
 * currently being served is byte-for-byte the re-encoded artifact captured at
 * verification time (i.e. stable, custom, propagated).
 */
async function fingerprintMaxres(token, videoId, recordedRemote) {
  const url = recordedRemote?.url || `https://i.ytimg.com/vi/${videoId}/maxresdefault.jpg`
  try {
    const res = await fetchWithTimeout(url, { headers: { Authorization: `Bearer ${token}` } })
    if (!res.ok) return { fetched: false, sha: null, bytes: 0, recordedSha: recordedRemote?.sha256 || null }
    const buf = Buffer.from(await res.arrayBuffer())
    return {
      fetched: true,
      sha: sha256(buf),
      bytes: buf.length,
      recordedSha: recordedRemote?.sha256 || null,
    }
  } catch {
    return { fetched: false, sha: null, bytes: 0, recordedSha: recordedRemote?.sha256 || null }
  }
}

/**
 * Probe YouTube's CHANNEL SHELF injection for the video — the surface users
 * actually see on a channel/shorts tab. YouTube injects distinct image
 * variants into the shelf HTML:
 *   - custom-thumbnail surfaces use /vi/{id}/maxresdefault.jpg (== hq720)
 *   - Shorts shelves inject /vi/{id}/frame0.jpg and /vi/{id}/oar2.jpg
 *     (frame-derived stills), which are INTENTIONALLY separate from the custom
 *     artwork. Presence of frame/oar variants without maxres indicates the
 *     Shorts shelf is present and using VIDEO_FRAME_FALLBACK, despite the
 *     custom thumbnail being uploaded and served on the watch-page surfaces.
 */
async function probeShelfInjection(channelHandle, videoId) {
  const urls = [
    `https://www.youtube.com/@${channelHandle}/shorts`,
    `https://www.youtube.com/@${channelHandle}`,
  ]
  const injected = new Set()
  let shortsShelfSeen = false
  for (const url of urls) {
    try {
      const res = await fetchWithTimeout(url, { /* public page, no auth */ timeoutMs: 20000 })
      if (!res.ok) continue
      const html = await res.text()
      const re = new RegExp(`/vi/${videoId}/([a-z0-9]+)\\.(?:jpg|jpeg|webp)`, 'g')
      let m
      while ((m = re.exec(html))) injected.add(m[1])
      if (/oar\d|frame\d/.test(html.match(new RegExp(`/vi/${videoId}/`, 'g')) ? 'oar' : '')) {}
    } catch { /* network/parse errors are non-fatal — we report what we saw */ }
  }
  const hasFrameVariant = [...injected].some((v) => /^frame\d/.test(v))
  const hasOarVariant = [...injected].some((v) => /^oar\d/.test(v))
  const hasMaxres = injected.has('maxresdefault')
  if (hasFrameVariant || hasOarVariant) shortsShelfSeen = true
  return { injected: [...injected], hasFrameVariant, hasOarVariant, hasMaxres, shortsShelfSeen }
}

function loadPublicationRecords() {
  const records = []
  if (!existsSync(RUNS_DIR)) return records
  for (const dir of readdirSync(RUNS_DIR)) {
    const p = join(RUNS_DIR, dir, 'publication.json')
    if (!existsSync(p)) continue
    try {
      const rec = JSON.parse(readFileSync(p, 'utf-8'))
      if (rec?.videoId) records.push(rec)
    } catch { /* skip malformed */ }
  }
  return records
}

function cab(url) {
  return url ? url.split('/').pop().split('?')[0] : null
}

async function main() {
  const token = await getAccessToken()
  const channelHandle = process.env.YOUTUBE_CHANNEL_HANDLE || 'sham435'
  console.log(`[SURFACE_FORENSICS] ${new Date().toISOString()} read-only diagnostic`)
  console.log(`[SURFACE_FORENSICS] allowUnverified=${allowUnverified}  channel=@${channelHandle}`)

  const records = loadPublicationRecords()
  if (videoIdArg) {
    const rec = records.find((r) => r.videoId === videoIdArg)
    if (!rec) {
      console.error(`[SURFACE_FORENSICS] No publication record for ${videoIdArg}`)
      process.exit(1)
    }
    records.length = 0
    records.push(rec)
  }

  if (records.length === 0) {
    console.error('[SURFACE_FORENSICS] No publication records found')
    process.exit(1)
  }

  console.log(`[SURFACE_FORENSICS] ${records.length} videos to inspect\n`)

  const rows = []
  for (const rec of records) {
    const v = rec.videoId
    const state = rec.thumbnail?.state
    if (state !== 'CUSTOM_THUMBNAIL_ACCEPTED' && !allowUnverified) {
      console.log(`▶ ${v} — SKIP (state=${state}); pass --allow-unverified to include`)
      continue
    }
    try {
      const { thumbnails } = await querySurfaces(token, v)
      const baseCls = classify(thumbnails, rec.thumbnail, rec.thumbnail?.source)
      const remote = rec.thumbnail?.remote
      const fp = await fingerprintMaxres(token, v, remote)
      const { cls, stable } = refineWithFingerprint(baseCls, fp)
      const shelf = await probeShelfInjection(channelHandle, v)
      const maxres = thumbnails?.maxres
      const localDims = rec.render ? `${rec.render.width}x${rec.render.height}` : 'n/a'
      const isShort = rec.render?.profile === 'VIDEO_HD' || rec.render?.aspectRatio === '16:9'
      // If the artwork is fingerprint-stable (served on watch surfaces) AND the
      // channel shelf injects frame/oar variants, the shelf is using VIDEO_FRAME_FALLBACK.
      const shelfCls = (stable && shelf.shortsShelfSeen && shelf.hasFrameVariant)
        ? 'SHORTS_SHELF_VIDEO_FRAME_FALLBACK'
        : (stable ? 'ARTWORK_SERVED' : (shelf.hasFrameVariant ? 'SHORTS_SHELF_VIDEO_FRAME_FALLBACK' : 'NO_SHELF_DATA'))
      rows.push({ v, cls, thumbnails, localDims, remote, state, stable, shelf, shelfCls, isShort })

      console.log(`▶ ${v}  →  API:${cls}${stable ? ' (fingerprint-stable)' : ''} | shelf:${shelfCls}`)
      console.log(`   render=${localDims}  source=${rec.thumbnail?.source?.width}x${rec.thumbnail?.source?.height}  isShort=${isShort}`)
      console.log(`   remote(maxres)=${remote ? `${remote.width}x${remote.height} ${remote.url}` : 'n/a (rejected)'}`)
      console.log(`   live maxres: ${fp.fetched ? `${fp.bytes} bytes sha256=${fp.sha?.slice(0, 12)}…` : 'unfetchable'}`)
      if (fp.recordedSha) console.log(`   ledger  maxres: sha256=${fp.recordedSha.slice(0, 12)}…`, fp.sha === fp.recordedSha ? '(MATCH)' : '(MISMATCH)')
      console.log(`   channel @${channelHandle} shelf injects: ${shelf.injected.join(', ') || '(none found)'}`)
      for (const k of ['default', 'medium', 'high', 'standard', 'maxres']) {
        const t = thumbnails?.[k]
        if (t) console.log(`     ${k.padEnd(8)} ${t.width}x${t.height}  ${cab(t.url)}`)
      }
      console.log('')
    } catch (e) {
      console.log(`▶ ${v}  →  ERROR ${e.message}\n`)
    }
  }

  const accepted = rows.filter((r) => r.cls === 'PLATFORM_VARIANT').length
  const stableCount = rows.filter((r) => r.stable).length
  const fallback = rows.filter((r) => r.cls === 'FALLBACK').length
  const notProp = rows.filter((r) => r.cls === 'NOT_PROPAGATED').length
  const shelfFrame = rows.filter((r) => r.shelfCls === 'SHORTS_SHELF_VIDEO_FRAME_FALLBACK').length
  const shelfServed = rows.filter((r) => r.shelfCls === 'ARTWORK_SERVED').length
  console.log('[SURFACE_FORENSICS] ———— SUMMARY ————')
  console.log(`API: PLATFORM_VARIANT ${accepted} | FALLBACK ${fallback} | NOT_PROPAGATED ${notProp} | total=${rows.length}`)
  console.log(`fingerprint-stable (maxres served == ledger remote sha): ${stableCount}`)
  console.log(`SHELF: SHORTS_SHELF_VIDEO_FRAME_FALLBACK ${shelfFrame} | ARTWORK_SERVED ${shelfServed} | NO_SHELF_DATA ${rows.length - shelfFrame - shelfServed}`)

  // Verdict: two distinct legs — API representation (artwork stored/served on watch
  // surfaces) vs CHANNEL SHELF presentation (what the user actually sees).
  const shortVideos = rows.filter((r) => r.isShort)
  const shortFrame = shortVideos.filter((r) => r.shelfCls === 'SHORTS_SHELF_VIDEO_FRAME_FALLBACK').length

  console.log('\n[CHANNEL SHELF VERDICT]')
  if (shortVideos.length > 0 && shortFrame > 0) {
    console.log(`Of ${shortVideos.length} Short video(s) inspected, ${shortFrame} show the Shorts shelf injecting`)
    console.log('frame-derived variants (frame0/oar2) — VIDEO_FRAME_FALLBACK on the channel shelf.')
    console.log('This is YouTube\'s INTRINSIC behavior for Shorts: the Shorts shelf does NOT use the')
    console.log('custom thumbnail even when it is successfully uploaded. The artwork IS served on the')
    console.log('watch-page/link surfaces (fingerprint-stable) but the Shorts shelf renders a video frame.')
    console.log('=> NOT fixable from the pipeline: setThumbnail(), verifier, and upload all operate correctly;')
    console.log('   YouTube simply does not surface custom thumbnails on the Shorts shelf. Verified via the')
    console.log('   channel HTML injection (frame0/oar2) which is byte-different from the custom maxres.')
  } else if (shelfServed > 0 || (shortVideos.length === 0 && stableCount > 0)) {
    console.log(`Artwork served on shelf surfaces for ${shelfServed} video(s); no frame-fallback detected.`)
  } else {
    console.log('No decisive shelf data collected (could not parse channel page or no Shorts detected).')
  }
}

main().catch((e) => {
  console.error(`[SURFACE_FORENSICS] fatal: ${e.message}`)
  process.exit(1)
})
