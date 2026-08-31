/**
 * /download/:videoId — serve a rendered video file for direct download.
 *
 * Videos are rendered by the composer and copied to public/videos/{videoId}.mp4
 * by the publish workflow. This endpoint serves them with the correct MIME type
 * so site visitors can download the full broadcast in one hop.
 *
 * Public (no auth) — downloads are an open, client-facing feature of the hub.
 * If a file is missing (e.g. never copied, or a pre-download video), returns
 * 404 with a hint rather than leaking paths.
 *
 * NOTE: On the static GitHub Pages deployment the same file is reachable
 * directly at /videos/{videoId}.mp4; this endpoint serves self-hosted /
 * local deployments from the Express API.
 */
import { Router } from 'express'
import { resolve, join, dirname, isAbsolute } from 'path'
import { existsSync, statSync } from 'fs'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(__dirname, '..', '..', '..')
// Locate the videos dir relative to repo root (works when run from the API app).
const VIDEOS_DIR = resolve(ROOT, 'public', 'videos')

const router = Router()

// Safe basename-only resolution: refuse path traversal attempts like
// /download/..%2F..%2Fetc%2Fpasswd or slashed ids.
function safePathFor(videoId) {
  if (!videoId) return null
  const base = String(videoId).replace(/[^A-Za-z0-9_-]/g, '')
  if (!base || base !== String(videoId)) return null
  return join(VIDEOS_DIR, `${base}.mp4`)
}

router.get('/download/:videoId', (req, res) => {
  const { videoId } = req.params
  const filePath = safePathFor(videoId)
  if (!filePath || !existsSync(filePath) || !statSync(filePath).isFile()) {
    return res.status(404).json({ error: 'video_not_found', hint: `No downloadable video for "${videoId}". The workflow copies public/videos/{id}.mp4 after render.` })
  }
  // Content-Disposition attachment forces a download; filename includes an
  // id that is strictly [A-Za-z0-9_-] so it's safe as a header value.
  res.download(filePath, `NEWS-MONSTER-${videoId}.mp4`, {
    headers: { 'Content-Type': 'video/mp4' },
  })
})

export default router
