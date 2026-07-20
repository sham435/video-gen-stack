import { execSync } from 'child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

// ─── THEMES ────────────────────────────────────────
const THEMES = {
  apple:   { bg0: '#0A0A23', bg1: '#1E1E60', accent: '#5E5CFF', glow: '#7C7AFF' },
  samsung: { bg0: '#0A1623', bg1: '#0F3A5F', accent: '#00A8FF', glow: '#33BBFF' },
  ai:      { bg0: '#0A0A1A', bg1: '#1A0A3E', accent: '#8B5CF6', glow: '#A78BFA' },
  gaming:  { bg0: '#230A14', bg1: '#601E3A', accent: '#FF2D7B', glow: '#FF5C9E' },
  security:{ bg0: '#1A0505', bg1: '#3A0A0A', accent: '#EF4444', glow: '#F87171' },
  default: { bg0: '#0B1020', bg1: '#1A2A5A', accent: '#3B82F6', glow: '#60A5FA' },
}

export function detectTheme(title = '') {
  const t = title.toLowerCase()
  if (t.includes('apple') || t.includes('iphone') || t.includes('siri') || t.includes('ios') || t.includes('macbook')) return 'apple'
  if (t.includes('samsung') || t.includes('galaxy') || t.includes('fold')) return 'samsung'
  if (t.includes('ai') || t.includes('chatgpt') || t.includes('openai') || t.includes('neural')) return 'ai'
  if (t.includes('xbox') || t.includes('playstation') || t.includes('nintendo') || t.includes('game')) return 'gaming'
  if (t.includes('cyber') || t.includes('hack') || t.includes('breach') || t.includes('malware')) return 'security'
  return 'default'
}

// ─── RENDER: Create scene with image + text ──────────
export async function renderVideo(headline, source, imageUrl, category = 'technology') {
  const tmp = tmpdir()
  const id = Date.now()
  const bgPath = join(tmp, `bg_${id}.mp4`)
  const textPath = join(tmp, `text_${id}.mp4`)
  const overlayPath = join(tmp, `overlay_${id}.mp4`)
  const musicPath = join(tmp, `music_${id}.mp4`)
  const outPath = join(tmp, `final_${id}.mp4`)

  const theme = THEMES[detectTheme(headline)] || THEMES.default
  const duration = 8
  const title = headline.replace(/['":\\,]/g, '').slice(0, 80)
  const src = source.replace(/['":\\,]/g, '').slice(0, 40)

  // STEP 1: Gradient background
  execSync(
    `ffmpeg -y -f lavfi -i "color=c=${theme.bg0}:s=1920x1080:d=${duration}:r=30" ` +
    `-f lavfi -i "color=c=${theme.bg1}:s=1920x1080:d=${duration}:r=30,format=rgba,colorchannelmixer=aa=0.4" ` +
    `-filter_complex "[0][1]overlay=0:0" -c:v libx264 -preset ultrafast -crf 24 "${bgPath}"`,
    { stdio: 'pipe', timeout: 30000 }
  )

  // STEP 2: If image - create blurred BG + sharp card overlay
  let hasImage = false
  if (imageUrl) {
    try {
      const imgPath = join(tmp, `img_${id}.jpg`)
      execSync(`curl -sL "${imageUrl}" -o "${imgPath}" --max-time 10`, { stdio: 'pipe', timeout: 15000 })

      // Blurred background layer
      execSync(
        `ffmpeg -y -i "${imgPath}" -vf "scale=1920:1080:force_original_aspect_ratio=increase,crop=1920:1080,gblur=sigma=20,colorchannelmixer=aa=0.3" ` +
        `-c:v libx264 -preset ultrafast -crf 28 -t ${duration} -r 30 "${overlayPath}"`,
        { stdio: 'pipe', timeout: 30000 }
      )
      hasImage = true
    } catch {}
  }

  // STEP 3: Create final scene with text
  const accent = theme.accent.replace('#', '0x')
  const accentLine = `drawtext=text='|':fontcolor=${accent}:fontsize=80:x=80:y=200:box=1:boxcolor=black@0.2:boxborderw=2`
  const headlineTxt = `drawtext=text='${title}':fontcolor=white:fontsize=52:x=100:y=280:box=1:boxcolor=black@0.4:boxborderw=16`
  const sourceTxt = src ? `,drawtext=text='${src}':fontcolor=${accent}:fontsize=22:x=100:y=500:box=1:boxcolor=black@0.3:boxborderw=10` : ''
  const badge = `,drawtext=text='${detectTheme(headline).toUpperCase()}':fontcolor=${accent}:fontsize=14:x=80:y=80:box=1:boxcolor=black@0.4:boxborderw=8`
  const bottomBar = `,drawtext=text='${category.toUpperCase()}  |  1/1':fontcolor=gray:fontsize=16:x=80:y=h-60:box=1:boxcolor=black@0.3:boxborderw=8`

  const input = hasImage ? `-i "${overlayPath}"` : `-i "${bgPath}"`
  const vf = hasImage
    ? `[0:v]${accentLine},${headlineTxt}${sourceTxt}${badge}${bottomBar}[out]`
    : `${accentLine},${headlineTxt}${sourceTxt}${badge}${bottomBar}`

  // Overlay text on image bg or use gradient bg
  if (hasImage) {
    execSync(
      `ffmpeg -y -i "${overlayPath}" -filter_complex "[0:v]${accentLine},${headlineTxt}${sourceTxt}${badge}${bottomBar}" ` +
      `-c:v libx264 -preset ultrafast -crf 24 "${textPath}"`,
      { stdio: 'pipe', timeout: 30000 }
    )
  } else {
    execSync(
      `ffmpeg -y -i "${bgPath}" -vf "${vf}" -c:v libx264 -preset ultrafast -crf 24 "${textPath}"`,
      { stdio: 'pipe', timeout: 30000 }
    )
  }

  // STEP 4: Add music
  const musicFiles = [
    'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-1.mp3',
    'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-2.mp3',
    'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-8.mp3',
  ]
  const musicUrl = musicFiles[Math.floor(Math.random() * musicFiles.length)]

  try {
    execSync(
      `ffmpeg -y -i "${textPath}" -i "${musicUrl}" -map 0:v -map 1:a ` +
      `-filter_complex "[1:a]volume=0.18,afade=t=in:st=0:d=1.5[mu]" ` +
      `-map "[mu]" -c:v copy -c:a aac -b:a 192k -ac 2 -shortest "${outPath}"`,
      { stdio: 'pipe', timeout: 60000 }
    )
  } catch {
    // Fallback: video only
    execSync(
      `ffmpeg -y -i "${textPath}" -c:v copy -an "${outPath}"`,
      { stdio: 'pipe', timeout: 30000 }
    )
  }

  // Cleanup
  try {
    ;[bgPath, textPath, overlayPath, musicPath].forEach(p => { try { require('fs').unlinkSync(p) } catch {} })
  } catch {}

  return outPath
}
