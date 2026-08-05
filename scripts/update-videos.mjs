/**
 * Refresh public/videos.json from the channel's YouTube RSS feed.
 * Runs in the publish workflow after every upload (and manually).
 *
 * Usage: node scripts/update-videos.mjs
 */

import { writeFileSync, existsSync, mkdirSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const OUT = resolve(__dirname, '..', 'public', 'videos.json')
const CHANNEL_ID = process.env.YOUTUBE_CHANNEL_ID || 'UC4UC7z16EtqtI-TJzeGZKjQ'

const decodeHtml = (s = '') => s
  .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
  .replace(/&quot;/g, '"').replace(/&#39;/g, "'")

export async function refreshVideosFeed(channelId = CHANNEL_ID) {
  let xml
  let lastErr
  // The public RSS feed is flaky (random 500/404 under load) — retry briefly.
  for (let attempt = 1; attempt <= 4; attempt++) {
    try {
      const feed = await fetch(`https://www.youtube.com/feeds/videos.xml?channel_id=${channelId}`, {
        headers: { 'user-agent': 'Mozilla/5.0 (compatible; NEWS-MONSTER/1.0)' },
        signal: AbortSignal.timeout(8000),
      })
      if (feed.ok) { xml = await feed.text(); break }
      lastErr = new Error(`feed unavailable: ${feed.status}`)
    } catch (e) {
      lastErr = e
    }
    await new Promise(r => setTimeout(r, attempt * 1200))
  }
  if (!xml) {
    console.warn(`⚠️  videos.json refresh skipped after retries: ${lastErr?.message} — keeping last known feed`)
    return null
  }
  const entries = [...xml.matchAll(/<entry>([\s\S]*?)<\/entry>/g)]
  const videos = entries.map(m => {
    const e = m[1] || ''
    const id = /yt:video:([A-Za-z0-9_-]+)/.exec(e)?.[1] || null
    const title = decodeHtml(/<title>([\s\S]*?)<\/title>/.exec(e)?.[1] || '')
    const published = /<published>([\s\S]*?)<\/published>/.exec(e)?.[1] || null
    const thumb = /<media:thumbnail[^>]*url="([^"]+)"/.exec(e)?.[1] || null
    return {
      id,
      title,
      publishedAt: published || null,
      publishedLabel: published
        ? new Date(published).toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
        : '',
      thumbnail: thumb || (id ? `https://i.ytimg.com/vi/${id}/hqdefault.jpg` : null),
    }
  }).filter(v => v.id)

  const json = {
    channelId,
    updatedAt: new Date().toISOString(),
    videos,
  }

  if (!existsSync(dirname(OUT))) mkdirSync(dirname(OUT), { recursive: true })
  writeFileSync(OUT, JSON.stringify(json, null, 2))
  console.log(`📋 videos.json refreshed: ${videos.length} videos → ${OUT}`)
  return json
}

if (import.meta.url.endsWith('update-videos.mjs')) {
  refreshVideosFeed().catch(e => {
    console.error(`❌ videos.json refresh failed: ${e.message}`)
    process.exit(1)
  })
}
