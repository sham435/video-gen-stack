#!/usr/bin/env node
/**
 * upload-clean-thumbnail — set custom thumbnail on existing YouTube video
 *
 * Usage:
 *   node scripts/upload-clean-thumbnail.mjs --video-id=UlKWqg2F2aU --thumbnail=/tmp/clean-short-cover.png
 *
 * Requires: YOUTUBE_REFRESH_TOKEN in .env
 */

import 'dotenv/config'
import { getAccessToken, setThumbnail } from '../apps/api/publishers/youtube.js'

const videoId = process.argv.find(a => a.startsWith('--video-id='))?.split('=')[1]
const thumbnail = process.argv.find(a => a.startsWith('--thumbnail='))?.split('=')[1]

if (!videoId || !thumbnail) {
  console.error('Usage: node scripts/upload-clean-thumbnail.mjs --video-id=VIDEO_ID --thumbnail=PATH')
  process.exit(1)
}

console.log(`\n=== Upload Clean Thumbnail ===`)
console.log(`Video: https://youtube.com/shorts/${videoId}`)
console.log(`Thumbnail: ${thumbnail}`)

try {
  const token = await getAccessToken()
  await setThumbnail(token, videoId, thumbnail)
  console.log(`\n✅ Thumbnail set for ${videoId}`)
  console.log(`   Promote preview: https://studio.youtube.com/video/${videoId}/edit`)
} catch (err) {
  console.error(`\n❌ Failed: ${err.message}`)
  process.exit(1)
}
