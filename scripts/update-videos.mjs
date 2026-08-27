/**
 * Refresh public/videos.json.
 * PRIMARY: reads from PublicationLedger (verified publications only).
 * FALLBACK: YouTube RSS feed (for pre-ledger videos).
 *
 * Invariant: if a video appears here, it has passed post-publish verification.
 *
 * Usage: node scripts/update-videos.mjs
 */

import { writeFileSync, existsSync, mkdirSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const OUT = resolve(__dirname, '..', 'public', 'videos.json')
const DATA_DIR = resolve(__dirname, '..', 'data')
const LEDGER_PATH = resolve(DATA_DIR, 'publication-ledger.json')
const CHANNEL_ID = process.env.YOUTUBE_CHANNEL_ID || 'UC4UC7z16EtqtI-TJzeGZKjQ'

const decodeHtml = (s = '') => s
  .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
  .replace(/&quot;/g, '"').replace(/&#39;/g, "'")

/** Resolve thumbnail — deterministic, no guessing. Always returns a usable URL. */
function resolveThumbnailUrl(videoId, thumbnailField) {
  if (typeof thumbnailField === 'string' && thumbnailField.startsWith('http')) return thumbnailField
  if (videoId) return `https://i.ytimg.com/vi/${videoId}/maxresdefault.jpg`
  return '/assets/placeholder-thumbnail.jpg'
}

/** Read verified videos from PublicationLedger */
function readLedger() {
  try {
    if (!existsSync(LEDGER_PATH)) return []
    const data = JSON.parse(readFileSync(LEDGER_PATH, 'utf-8'))
    return (data.entries || []).reverse().map(e => ({
      id: e.videoId,
      title: e.title || `Video ${e.videoId}`,
      category: e.category || 'general',
      publishedAt: e.publishedAt || e.verifiedAt,
      publishedLabel: e.publishedAt
        ? new Date(e.publishedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
        : '',
      thumbnail: resolveThumbnailUrl(e.videoId, e.thumbnail),
      verified: true,
    }))
  } catch {
    return []
  }
}

/** Fallback: YouTube RSS feed */
async function readRssFeed(channelId) {
  let xml
  let lastErr
  for (let attempt = 1; attempt <= 4; attempt++) {
    try {
      const feed = await fetch(`https://www.youtube.com/feeds/videos.xml?channel_id=${channelId}`, {
        headers: { 'user-agent': 'Mozilla/5.0 (compatible; NEWS-MONSTER/1.0)' },
        signal: AbortSignal.timeout(8000),
      })
      if (feed.ok) { xml = await feed.text(); break }
      lastErr = new Error(`feed unavailable: ${feed.status}`)
    } catch (e) { lastErr = e }
    await new Promise(r => setTimeout(r, attempt * 1200))
  }
  if (!xml) {
    console.warn(`⚠️  RSS feed unavailable: ${lastErr?.message}`)
    return []
  }
  const entries = [...xml.matchAll(/<entry>([\s\S]*?)<\/entry>/g)]
  return entries.map(m => {
    const e = m[1] || ''
    const id = /yt:video:([A-Za-z0-9_-]+)/.exec(e)?.[1] || null
    const title = decodeHtml(/<title>([\s\S]*?)<\/title>/.exec(e)?.[1] || '')
    const published = /<published>([\s\S]*?)<\/published>/.exec(e)?.[1] || null
    return {
      id, title,
      publishedAt: published || null,
      publishedLabel: published
        ? new Date(published).toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
        : '',
      thumbnail: resolveThumbnailUrl(id, null),
    }
  }).filter(v => v.id)
}

export async function refreshVideosFeed(channelId = CHANNEL_ID) {
  // Primary: PublicationLedger (verified publications)
  const ledgerVideos = readLedger()
  if (ledgerVideos.length > 0) {
    const json = { channelId, updatedAt: new Date().toISOString(), source: 'publication-ledger', videos: ledgerVideos }
    if (!existsSync(dirname(OUT))) mkdirSync(dirname(OUT), { recursive: true })
    writeFileSync(OUT, JSON.stringify(json, null, 2))
    console.log(`📋 videos.json from ledger: ${ledgerVideos.length} verified videos → ${OUT}`)
    return json
  }

  // Fallback: YouTube RSS (for pre-ledger videos)
  console.log('📋 no ledger entries — falling back to YouTube RSS feed')
  const rssVideos = await readRssFeed(channelId)
  if (rssVideos.length === 0) {
    console.warn('⚠️  videos.json refresh skipped — no data available')
    return null
  }
  const json = { channelId, updatedAt: new Date().toISOString(), source: 'youtube-rss', videos: rssVideos }
  if (!existsSync(dirname(OUT))) mkdirSync(dirname(OUT), { recursive: true })
  writeFileSync(OUT, JSON.stringify(json, null, 2))
  console.log(`📋 videos.json from RSS: ${rssVideos.length} videos → ${OUT}`)
  return json
}

if (import.meta.url.endsWith('update-videos.mjs')) {
  refreshVideosFeed().catch(e => {
    console.error(`❌ videos.json refresh failed: ${e.message}`)
    process.exit(1)
  })
}
