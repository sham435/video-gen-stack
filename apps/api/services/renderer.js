import { execSync } from 'child_process'
import { writeFileSync, unlinkSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

const MUSIC = [
  'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-1.mp3',
  'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-2.mp3',
  'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-3.mp3',
]

const COLORS = [
  { bg: '0x07111F', accent: '0x3B82F6', line: '0x22D3EE' },
  { bg: '0x0B172A', accent: '0x8B5CF6', line: '0x60A5FA' },
  { bg: '0x111827', accent: '0x06B6D4', line: '0x34D399' },
  { bg: '0x0F172A', accent: '0x3B82F6', line: '0xF59E0B' },
  { bg: '0x0A0A1A', accent: '0x6366F1', line: '0x22D3EE' },
]

export async function renderNewsVideo(headlines, options = {}) {
  const tmp = tmpdir()
  const out = join(tmp, `v_${Date.now()}.mp4`)
  const musicUrl = options.musicUrl || MUSIC[Math.floor(Math.random() * MUSIC.length)]

  const SCENE_SECONDS = 5
  const totalDur = Math.max(headlines.length * SCENE_SECONDS, 15)

  // Build separate scene for each headline using concat
  const sceneFiles = []

  for (let i = 0; i < Math.min(headlines.length, 5); i++) {
    const h = headlines[i]
    const title = (h.title || '').replace(/['":\\,]/g, '').slice(0, 60)
    const source = (h.source?.name || '').replace(/['":\\,]/g, '').slice(0, 30)
    const c = COLORS[i % COLORS.length]
    const sceneOut = join(tmp, `scene_${i}_${Date.now()}.mp4`)

    // Build each scene: colored background + text + accent line + source
    const accentLine = `drawtext=text='|':fontcolor=${c.accent}:fontsize=60:x=80:y=280:box=1:boxcolor=black@0.3:boxborderw=4`
    const headlineText = `drawtext=text='${title}':fontcolor=white:fontsize=48:x=100:y=300:enable='between(t\\,0\\,${SCENE_SECONDS})':box=1:boxcolor=black@0.3:boxborderw=12`
    const sourceText = source ? `:drawtext=text='${source}':fontcolor=${c.accent}:fontsize=24:x=100:y=380:enable='between(t\\,0\\,${SCENE_SECONDS})':box=1:boxcolor=black@0.2:boxborderw=8` : ''
    const counter = `drawtext=text='${i + 1}/${Math.min(headlines.length, 5)}':fontcolor=gray:fontsize=20:x=w-120:y=h-60:enable='between(t\\,0\\,${SCENE_SECONDS})'`

    const cmd = [
      'ffmpeg -y',
      `-f lavfi -i "color=c=${c.bg}:s=1920x1080:r=30:d=${SCENE_SECONDS}"`,
      `-vf "${accentLine},${headlineText}${sourceText},${counter}"`,
      '-c:v libx264 -preset ultrafast -crf 28 -pix_fmt yuv420p',
      `"${sceneOut}"`,
    ].join(' ')

    execSync(cmd, { stdio: 'pipe', timeout: 60000 })
    sceneFiles.push(sceneOut)
  }

  // Create concat file
  const concatFile = join(tmp, `concat_${Date.now()}.txt`)
  writeFileSync(concatFile, sceneFiles.map(f => `file '${f}'`).join('\n'))

  // Concat all scenes + add music
  try {
    const concatCmd = `ffmpeg -y -f concat -safe 0 -i "${concatFile}" -i "${musicUrl}" -map 0:v -map 1:a -c:v libx264 -preset ultrafast -crf 28 -c:a aac -b:a 192k -ac 2 -shortest "${out}"`
    execSync(concatCmd, { stdio: 'pipe', timeout: 120000 })
  } catch {
    // Fallback: concat without music
    const concatCmd = `ffmpeg -y -f concat -safe 0 -i "${concatFile}" -c:v libx264 -preset ultrafast -crf 28 -an "${out}"`
    execSync(concatCmd, { stdio: 'pipe', timeout: 120000 })
  }

  // Cleanup temp files
  sceneFiles.forEach(f => { try { unlinkSync(f) } catch {} })
  try { unlinkSync(concatFile) } catch {}

  return out
}
