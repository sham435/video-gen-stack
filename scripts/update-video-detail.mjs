/**
 * Generate per-video detail files for the 16:9 publishing hub.
 *
 * PRIMARY source: public/videos.json (already refreshed from the verified
 * PublicationLedger by update-videos.mjs — canonical thumbnails + verified
 * state). Writes two artifacts consumed by the landing page + OG/SEO:
 *
 *   public/video-detail.json        → the LATEST video (drives hero spotlight,
 *                                     meta description, and Open Graph tags).
 *   public/videos/{videoId}.json    → one file per video (feeds view.html
 *                                     dedicated pages for SEO + embed).
 *
 * Shape per detail:
 *   { videoId, title, description, category, publishedAt, publishedLabel,
 *     thumbnail, thumbnailUrl (absolute, for OG), youtubeUrl, watchUrl }
 *
 * Usage: node scripts/update-video-detail.mjs
 */
import { writeFileSync, mkdirSync, readFileSync, existsSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(__dirname, '..')
const VIDEOS_JSON = resolve(ROOT, 'public', 'videos.json')
const DETAIL_OUT = resolve(ROOT, 'public', 'video-detail.json')
const PER_VIDEO_OUT = resolve(ROOT, 'public', 'videos')
const CHANNEL_ID = process.env.YOUTUBE_CHANNEL_ID || 'UC4UC7z16EtqtI-TJzeGZKjQ'
const SITE_BASE = process.env.SITE_BASE || 'https://news-monster.github.io'

/** Build an absolute base URL for OG/image links (best-effort; keeps local
 *  relative paths when run outside a deploy environment). */
function absUrl(pathOrUrl) {
  if (!pathOrUrl) return pathOrUrl
  if (pathOrUrl.startsWith('http')) return pathOrUrl
  return `${SITE_BASE.replace(/\/$/, '')}${pathOrUrl.startsWith('/') ? pathOrUrl : `/${pathOrUrl}`}`
}

/** Compose one video-detail record from a videos.json entry. */
function toDetail(v) {
  const videoId = v.id || v.videoId
  const thumbnail = v.thumbnail || (videoId ? `/thumbnails/${videoId}.png` : null)
  const youtubeUrl = v.youtubeUrl || (videoId ? `https://youtu.be/${videoId}` : null)
  const description =
    (v.description && v.description.trim()) ||
    `${v.title || 'News update'} — a fresh 16:9 news video from the NEWS-MONSTER autonomous video factory.`
  const publishedAt = v.publishedAt || null
  return {
    videoId,
    title: v.title || `Video ${videoId}`,
    description,
    category: (v.category || 'general').toLowerCase(),
    publishedAt,
    publishedLabel: v.publishedLabel || (publishedAt
      ? new Date(publishedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
      : ''),
    thumbnail,
    thumbnailUrl: thumbnail ? absUrl(thumbnail) : null,
    youtubeUrl,
    watchUrl: videoId ? `https://www.youtube.com/watch?v=${videoId}` : null,
    downloadUrl: videoId ? `/videos/${videoId}.mp4` : null,
  }
}

/** Build a self-contained, SEO-friendly HTML page for a single video. Served
 *  at public/videos/{videoId}.html so each drop is its own indexable URL. */
function videoPageHtml(d) {
  const id = d.videoId
  const esc = s => String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
  const fullTitle = (d.title ? d.title + ' | NEWS-MONSTER 16:9 News Videos' : 'NEWS-MONSTER — 16:9 News Videos')
  const desc = (d.description || '').slice(0, 200)
  const image = d.thumbnailUrl || ''
  const watch = d.watchUrl || d.youtubeUrl || `https://www.youtube.com/watch?v=${id}`
  const cat = (d.category || '').toUpperCase()

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${esc(fullTitle)}</title>
<meta name="description" content="${esc(desc)}">
<meta property="og:site_name" content="NEWS-MONSTER">
<meta property="og:type" content="video.other">
<meta property="og:title" content="${esc(fullTitle)}">
<meta property="og:description" content="${esc(desc)}">
<meta property="og:image" content="${esc(image)}">
<meta property="og:image:width" content="3840">
<meta property="og:image:height" content="2160">
<meta property="og:image:type" content="image/png">
<meta property="og:video:url" content="${esc(watch)}">
<meta property="og:video:width" content="3840">
<meta property="og:video:height" content="2160">
<meta property="og:video:type" content="text/html">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${esc(fullTitle)}">
<meta name="twitter:description" content="${esc(desc)}">
<meta name="twitter:image" content="${esc(image)}">
<link rel="preconnect" href="https://www.youtube-nocookie.com">
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;600;700;800&display=swap" rel="stylesheet">
<style>
*,*::before,*::after{margin:0;padding:0;box-sizing:border-box}
body{background:#050505;color:#f0ece4;font-family:'Inter',-apple-system,'Segoe UI',Roboto,sans-serif;min-height:100vh;-webkit-font-smoothing:antialiased}
.veil{position:fixed;inset:0;pointer-events:none;background:radial-gradient(ellipse 70% 45% at 50% -8%,rgba(201,168,76,.06),transparent 55%),radial-gradient(ellipse 50% 35% at 85% 100%,rgba(224,48,48,.04),transparent 55%)}
.wrap{position:relative;z-index:1;max-width:960px;margin:0 auto;padding:48px 24px 80px}
header{display:flex;align-items:center;justify-content:space-between;margin-bottom:40px}
.logo{display:flex;align-items:center;gap:12px;text-decoration:none;color:#f0ece4}
.logo-mark{width:40px;height:40px;border-radius:8px;background:#e03030;display:grid;place-items:center;font-weight:800;font-size:14px;box-shadow:0 0 24px rgba(224,48,48,.4)}
.logo-text{font-weight:700;letter-spacing:1.5px;text-transform:uppercase}
nav a{color:#8a8a9a;text-decoration:none;font-size:13px;font-weight:500;letter-spacing:.8px;text-transform:uppercase;transition:color .2s}
nav a:hover{color:#f0ece4}
.video{aspect-ratio:16/9;border-radius:18px;overflow:hidden;border:1px solid rgba(255,255,255,.08);background:#000;box-shadow:0 30px 90px rgba(0,0,0,.55);margin-bottom:28px}
.video iframe{width:100%;height:100%;border:0;display:block}
.cat{color:#c9a84c;font-weight:700;text-transform:uppercase;letter-spacing:1px;font-size:12px;margin-bottom:12px;display:block}
h1{font-weight:800;font-size:clamp(24px,4vw,40px);line-height:1.12;letter-spacing:-.5px;margin-bottom:16px}
.desc{color:#8a8a9a;font-size:15px;line-height:1.6;margin-bottom:20px}
.meta{color:#8a8a9a;font-size:13px;margin-bottom:24px}
.actions{display:flex;gap:12px;flex-wrap:wrap}
.btn{padding:12px 24px;border-radius:12px;font-family:inherit;font-size:13px;font-weight:700;letter-spacing:.5px;border:1px solid rgba(255,255,255,.08);background:#0a0a0c;color:#f0ece4;cursor:pointer;text-decoration:none;transition:all .2s}
.btn:hover{border-color:#c9a84c;color:#c9a84c}
.btn.primary{background:#c9a84c;color:#0a0a0c;border-color:#c9a84c}
.btn.primary:hover{background:#d4b354}
footer{margin-top:48px;padding-top:28px;border-top:1px solid rgba(255,255,255,.08);color:#8a8a9a;font-size:12px;display:flex;justify-content:space-between;flex-wrap:wrap;gap:10px}
footer a{color:#c9a84c;text-decoration:none}
</style>
</head>
<body>
<div class="veil"></div>
<div class="wrap">
  <header>
    <a class="logo" href="../">
      <div class="logo-mark">NM</div>
      <div class="logo-text">NEWS-MONSTER</div>
    </a>
    <nav><a href="../">All videos</a></nav>
  </header>
  <div class="video"><iframe src="https://www.youtube-nocookie.com/embed/${id}?rel=0&playsinline=1"
    title="${esc(d.title || '')}" allow="accelerometer;autoplay;clipboard-write;encrypted-media;gyroscope;picture-in-picture;web-share"
    allowfullscreen referrerpolicy="strict-origin-when-cross-origin"></iframe></div>
  <span class="cat">${esc(cat)}</span>
  <h1>${esc(d.title || '')}</h1>
  <p class="desc">${esc(d.description || '')}</p>
  <div class="meta">${d.publishedLabel ? esc(d.publishedLabel) : ''}${d.thumbnailWidth ? ' &middot; ' + esc(d.thumbnailWidth) + '\u00d7' + esc(d.thumbnailHeight || 2160) + ' 16:9' : ''}</div>
  <div class="actions">
    <a class="btn primary" href="${esc(watch)}" target="_blank" rel="noopener">Watch on YouTube</a>
    <a class="btn" href="${esc(d.downloadUrl || ('/videos/' + id + '.mp4'))}" download="NEWS-MONSTER-${id}.mp4">Download Video</a>
    <a class="btn" href="../">Browse all videos</a>
  </div>
  <footer>
    <div><strong>NEWS-MONSTER</strong> &middot; 16:9 Autonomous Video Factory</div>
    <div><a href="../">Back to the hub</a></div>
  </footer>
</div>
</body>
</html>
`
}

/** Generate detail files from public/videos.json. Returns true on success. */
export function generateVideoDetails({ includePerVideo = true } = {}) {
  if (!existsSync(VIDEOS_JSON)) {
    console.warn('⚠️  public/videos.json not found — no video details generated')
    return false
  }
  let manifest
  try {
    manifest = JSON.parse(readFileSync(VIDEOS_JSON, 'utf-8'))
  } catch (e) {
    console.warn(`⚠️  public/videos.json unreadable (${e.message}) — skipping`)
    return false
  }

  const videos = (Array.isArray(manifest.videos) ? manifest.videos : [])
    .map(toDetail)
    .filter(v => v.videoId)

  if (!videos.length) {
    console.warn('⚠️  no videos to detail — skipping')
    return false
  }

  // Latest first (videos.json is newest-first already, but be explicit).
  videos.sort((a, b) => new Date(b.publishedAt || 0) - new Date(a.publishedAt || 0))

  // 1. Latest video detail → public/video-detail.json
  mkdirSync(dirname(DETAIL_OUT), { recursive: true })
  writeFileSync(DETAIL_OUT, JSON.stringify(videos[0], null, 2))
  console.log(`📼 video-detail.json → ${videos[0].videoId} "${videos[0].title.slice(0, 60)}"`)

  // 2. Per-video detail → public/videos/{videoId}.json
  let count = 0
  if (includePerVideo) {
    mkdirSync(PER_VIDEO_OUT, { recursive: true })
    for (const v of videos) {
      writeFileSync(resolve(PER_VIDEO_OUT, `${v.videoId}.json`), JSON.stringify(v, null, 2))
      writeFileSync(resolve(PER_VIDEO_OUT, `${v.videoId}.html`), videoPageHtml(v))
      count++
    }
    console.log(`📁 ${count} per-video detail pages (.json + .html) → public/videos/`)
  }

  return true
}

if (import.meta.url.endsWith('update-video-detail.mjs')) {
  const ok = generateVideoDetails()
  if (!ok) process.exit(1)
}
