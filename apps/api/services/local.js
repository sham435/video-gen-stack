import { renderPromptVideo, mergeVideos } from './renderer.js'
import { tmpdir } from 'os'
import { join } from 'path'
import { unlinkSync } from 'fs'

export async function generateVideo({ prompt, duration = 5, aspectRatio = '16:9', segments = 3, segmentDuration }) {
  const segLen = Math.min(Math.max(segmentDuration || duration || 5, 3), 10)
  const count = Math.min(Math.max(segments || 1, 1), 10)
  const paths = []
  try {
    for (let i = 1; i <= count; i++) {
      const p = await renderPromptVideo(prompt, { duration: segLen, segmentIndex: i, totalSegments: count })
      paths.push(p)
    }
    const final = count > 1 ? mergeVideos(paths) : paths[0]
    return {
      provider: 'local',
      model: 'procedural-ffmpeg',
      freeTier: true,
      segments: count,
      video_path: final,
      duration: segLen * count,
      videos: [{ url: `file://${final}`, path: final, contentType: 'video/mp4', duration: segLen * count }],
      note: `local ffmpeg render (free): ${count} × ${segLen}s segments merged into ${segLen * count}s`,
    }
  } catch (e) {
    for (const p of paths) { try { unlinkSync(p) } catch {} }
    throw e
  }
}
