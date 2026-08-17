#!/usr/bin/env node
// reupload-short — delete old Short + upload clean version (hideBranded)
//
// Usage:
//   node scripts/reupload-short.mjs <video-file-path> <title> <description>
//   node scripts/reupload-short.mjs /tmp/short.mp4 "Clean Title" "Clean description"
//
// Requires: YOUTUBE_REFRESH_TOKEN in .env

import 'dotenv/config'
import fs from 'fs'
import path from 'path'

const videoPath = process.argv[2]
const title = process.argv[3]
const description = process.argv[4]
const deleteId = process.argv.find(a => a.startsWith('--delete='))?.split('=')[1]

if (!videoPath || !title) {
  console.error('Usage: node scripts/reupload-short.mjs <video-file> <title> [description] [--delete=VIDEO_ID]')
  process.exit(1)
}

if (!fs.existsSync(videoPath)) {
  console.error(`Video file not found: ${videoPath}`)
  process.exit(1)
}

const { uploadShort, deleteVideo } = await import('../apps/api/publishers/youtube.js')

// Step 1: Delete old video if requested
if (deleteId) {
  console.log(`\n=== Deleting old video ${deleteId} ===`)
  try {
    await deleteVideo(deleteId)
    console.log(`✅ Old video ${deleteId} deleted`)
  } catch (err) {
    console.error(`❌ Delete failed: ${err.message}`)
    console.error('Proceeding with upload anyway...')
  }
}

// Step 2: Upload clean version
console.log(`\n=== Uploading clean Short ===`)
console.log(`Title: ${title}`)
console.log(`File: ${videoPath} (${(fs.statSync(videoPath).size / 1024 / 1024).toFixed(1)}MB)`)

const videoUrl = `file://${path.resolve(videoPath)}`
const result = await uploadShort(videoUrl, title, description || '', 'public')

if (result?.id) {
  console.log(`\n✅ Uploaded: https://youtube.com/shorts/${result.id}`)
  console.log(`   Title: ${title}`)
} else {
  console.error('\n❌ Upload failed — no video ID returned')
  process.exit(1)
}
