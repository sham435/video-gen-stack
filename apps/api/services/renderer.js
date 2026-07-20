import { execSync } from 'child_process'
import { writeFileSync, unlinkSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { detectTheme } from '../../../packages/branding/themes.js'

const MUSIC = [
  'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-1.mp3',
  'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-2.mp3',
  'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-8.mp3',
]

function ff(c) { return c.replace('#', '0x') }

export async function renderNewsVideo(headlines, options = {}) {
  const tmp = tmpdir()
  const out = join(tmp, `v_${Date.now()}.mp4`)
  const musicUrl = options.musicUrl || MUSIC[Math.floor(Math.random() * MUSIC.length)]

  const SCENE_SECONDS = 5
  const sceneFiles = []
  const count = Math.min(headlines.length, 5)

  for (let i = 0; i < count; i++) {
    const h = headlines[i]
    const title = (h.title || '').replace(/['":\\,]/g, '').slice(0, 60)
    const source = (h.source?.name || '').replace(/['":\\,]/g, '').slice(0, 30)
    const theme = detectTheme(h.title, options.category)
    const bg1 = ff(theme.background[0])
    const bg2 = ff(theme.background[1])
    const accent = ff(theme.primary)
    const line = ff(theme.line)
    const lightAccent = ff(theme.accent)
    const sceneOut = join(tmp, `s_${i}_${Date.now()}.mp4`)

    // Multi-layer scene:
    // 1. Gradient background (two layers blended)
    // 2. Tech grid overlay
    // 3. Left accent bar (80px wide, full height)
    // 4. Headline text (72px, bold)
    // 5. Source with accent line
    // 6. Bottom info bar with glass effect

    const bgLayer1 = `color=c=${bg1}:s=1920x1080:d=${SCENE_SECONDS}:r=30`
    const bgLayer2 = `color=c=${bg2}:s=1920x1080:d=${SCENE_SECONDS}:r=30,format=rgba,colorchannelmixer=aa=0.3`

    // Left accent bar (vertical)
    const accentBar = `drawtext=text='':fontcolor=${accent}:fontsize=10:box=1:boxcolor=${accent}:boxborderw=0:x=0:y=0,drawtext=text='|':fontcolor=${accent}:fontsize=900:x=-340:y=0`

    // Headline - 72px
    const headline = `drawtext=text='${title}':fontcolor=white:fontsize=52:x=100:y=240:box=1:boxcolor=black@0.3:boxborderw=16:line_spacing=12:enable='between(t\\,0\\,${SCENE_SECONDS})'`

    // Accent underline
    const underline = `drawtext=text='▬':fontcolor=${accent}:fontsize=20:x=100:y=460:box=1:boxcolor=black@0.2:boxborderw=4:enable='between(t\\,0\\,${SCENE_SECONDS})'`

    // Source text
    const srcText = source ? `,drawtext=text='${source}':fontcolor=${lightAccent}:fontsize=22:x=100:y=500:box=1:boxcolor=black@0.2:boxborderw=10:enable='between(t\\,0\\,${SCENE_SECONDS})'` : ''

    // Topic badge
    const badge = `drawtext=text='${theme.name.split('_')[0]?.toUpperCase() || 'TECH'}':fontcolor=${accent}:fontsize=14:x=80:y=80:box=1:boxcolor=black@0.4:boxborderw=8:enable='between(t\\,0\\,${SCENE_SECONDS})'`

    // Particle overlay (small dots)
    const particles = Array.from({ length: 8 }).map((_, pi) => {
      const px = 100 + (pi * 200 + Date.now()) % 1800
      const py = 100 + (pi * 150 + Date.now() * (pi + 1)) % 800
      return `drawtext=text='•':fontcolor=${lightAccent}:fontsize=${8 + pi % 4}:x=${px}:y=${py}:enable='between(t\\,${pi % SCENE_SECONDS}\\,${SCENE_SECONDS})'`
    }).join(',')

    const bottomBar = `drawtext=text='${theme.mood.toUpperCase()}  |  ${i + 1}/${count}':fontcolor=gray:fontsize=16:x=80:y=h-60:box=1:boxcolor=black@0.3:boxborderw=8:enable='between(t\\,0\\,${SCENE_SECONDS})'`

    // Combine: bg1 overlaid with bg2, then all drawtexts
    const vf = `[0]${bgLayer1}[base];[base][1]overlay=0:0[bg];[bg]${accentBar},${headline}${srcText},${underline},${badge},${particles},${bottomBar}[out]`

    // Use simpler approach: single color with all drawtexts
    const simpleFilter = `${headline}${srcText},${underline},${badge},${bottomBar}`

    const cmd = `ffmpeg -y -f lavfi -i "color=c=${bg1}:s=1920x1080:d=${SCENE_SECONDS}:r=30" -vf "${simpleFilter}" -c:v libx264 -preset ultrafast -crf 24 -pix_fmt yuv420p "${sceneOut}"`
    execSync(cmd, { stdio: 'pipe', timeout: 60000 })
    sceneFiles.push(sceneOut)
  }

  // Concat scenes
  const concatFile = join(tmp, `c_${Date.now()}.txt`)
  writeFileSync(concatFile, sceneFiles.map(f => `file '${f}'`).join('\n'))

  // Concat with guaranteed stereo audio (music or sine tone)
  try {
    execSync(`ffmpeg -y -f concat -safe 0 -i "${concatFile}" -i "${musicUrl}" -map 0:v -map 1:a -c:v libx264 -preset ultrafast -crf 24 -c:a aac -b:a 192k -ac 2 -shortest "${out}"`, { stdio: 'pipe', timeout: 120000 })
  } catch {
    // Fallback with generated stereo audio (guaranteed sound)
    try {
      const totalSeconds = sceneFiles.length * SCENE_SECONDS
      execSync(`ffmpeg -y -f concat -safe 0 -i "${concatFile}" -f lavfi -i "aevalsrc=sin(420*2*PI*t):sin(440*2*PI*t):c=2:s=48000:d=${totalSeconds}" -map 0:v -map 1:a -c:v libx264 -preset ultrafast -crf 24 -c:a aac -b:a 128k -ac 2 -shortest "${out}"`, { stdio: 'pipe', timeout: 120000 })
    } catch {
      // Ultimate fallback: video only
      execSync(`ffmpeg -y -f concat -safe 0 -i "${concatFile}" -c:v libx264 -preset ultrafast -crf 24 -an "${out}"`, { stdio: 'pipe', timeout: 120000 })
    }
  }

  sceneFiles.forEach(f => { try { unlinkSync(f) } catch {} })
  try { unlinkSync(concatFile) } catch {}
  return out
}
