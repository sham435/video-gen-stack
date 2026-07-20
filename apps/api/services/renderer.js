import { execSync } from 'child_process'
import { writeFileSync, unlinkSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

const MUSIC = [
  'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-1.mp3',
  'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-2.mp3',
  'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-8.mp3',
]

// Coordinated palette: dark bg + matching accent + lighter complement
const SCENES = [
  { bg: '0x07111F', accent: '0x3B82F6', light: '0x60A5FA', line: '0x22D3EE' },
  { bg: '0x0A1628', accent: '0x3B82F6', light: '0x93C5FD', line: '0x22D3EE' },
  { bg: '0x0D1B2A', accent: '0x60A5FA', light: '0xBFDBFE', line: '0x3B82F6' },
  { bg: '0x081020', accent: '0x3B82F6', light: '0x93C5FD', line: '0x2DD4BF' },
  { bg: '0x0C1828', accent: '0x22D3EE', light: '0x67E8F9', line: '0x3B82F6' },
]

export async function renderNewsVideo(headlines, options = {}) {
  const tmp = tmpdir()
  const out = join(tmp, `v_${Date.now()}.mp4`)
  const musicUrl = options.musicUrl || MUSIC[Math.floor(Math.random() * MUSIC.length)]

  const SCENE_SECONDS = 5
  const sceneFiles = []
  const count = Math.min(headlines.length, 5)

  for (let i = 0; i < count; i++) {
    const h = headlines[i]
    const title = (h.title || '').replace(/['":\\,]/g, '').slice(0, 55)
    const source = (h.source?.name || '').replace(/['":\\,]/g, '').slice(0, 30)
    const s = SCENES[i % SCENES.length]
    const sceneOut = join(tmp, `s_${i}_${Date.now()}.mp4`)

    // Accent line (left vertical bar)
    const accentBar = `drawtext=text='|':fontcolor=${s.accent}:fontsize=80:x=80:y=200:box=1:boxcolor=black@0.2:boxborderw=2`

    // Headline with larger text and accent-colored underline
    const headline = `drawtext=text='${title}':fontcolor=white:fontsize=52:x=100:y=280:box=1:boxcolor=black@0.3:boxborderw=14:enable='between(t\\,0\\,${SCENE_SECONDS})'`

    // Accent underline bar
    const underline = `drawtext=text='━':fontcolor=${s.accent}:fontsize=24:x=100:y=480:box=1:boxcolor=black@0.2:boxborderw=4:enable='between(t\\,0\\,${SCENE_SECONDS})'`

    // Source with accent color
    const srcText = source ? `,drawtext=text='${source}':fontcolor=${s.light}:fontsize=22:x=100:y=520:box=1:boxcolor=black@0.2:boxborderw=8:enable='between(t\\,0\\,${SCENE_SECONDS})'` : ''

    // Bottom info bar
    const infoBar = `drawtext=text='TECHNOLOGY  |  ${i + 1}/${count}':fontcolor=gray:fontsize=18:x=80:y=h-60:box=1:boxcolor=black@0.2:boxborderw=6:enable='between(t\\,0\\,${SCENE_SECONDS})'`

    const cmd = `ffmpeg -y -f lavfi -i "color=c=${s.bg}:s=1920x1080:r=30:d=${SCENE_SECONDS}" -vf "${accentBar},${headline}${srcText},${underline},${infoBar}" -c:v libx264 -preset ultrafast -crf 24 -pix_fmt yuv420p "${sceneOut}"`
    execSync(cmd, { stdio: 'pipe', timeout: 60000 })
    sceneFiles.push(sceneOut)
  }

  // Concat
  const concatFile = join(tmp, `c_${Date.now()}.txt`)
  writeFileSync(concatFile, sceneFiles.map(f => `file '${f}'`).join('\n'))

  try {
    execSync(`ffmpeg -y -f concat -safe 0 -i "${concatFile}" -i "${musicUrl}" -map 0:v -map 1:a -c:v libx264 -preset ultrafast -crf 24 -c:a aac -b:a 192k -ac 2 -shortest "${out}"`, { stdio: 'pipe', timeout: 120000 })
  } catch {
    execSync(`ffmpeg -y -f concat -safe 0 -i "${concatFile}" -c:v libx264 -preset ultrafast -crf 24 -an "${out}"`, { stdio: 'pipe', timeout: 120000 })
  }

  sceneFiles.forEach(f => { try { unlinkSync(f) } catch {} })
  try { unlinkSync(concatFile) } catch {}
  return out
}
