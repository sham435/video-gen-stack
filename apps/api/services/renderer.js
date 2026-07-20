import { execSync } from 'child_process'
import { tmpdir } from 'os'
import { join } from 'path'

const MUSIC = [
  'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-1.mp3',
  'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-2.mp3',
  'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-3.mp3',
  'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-4.mp3',
  'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-5.mp3',
  'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-6.mp3',
  'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-7.mp3',
  'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-8.mp3',
]

export async function renderNewsVideo(headlines, options = {}) {
  const tmp = tmpdir()
  const out = join(tmp, `v_${Date.now()}.mp4`)
  const dur = Math.max(headlines.length * 4 + 4, 15)
  const musicUrl = options.musicUrl || MUSIC[Math.floor(Math.random() * MUSIC.length)]

  // Build text overlays with larger font
  const texts = headlines.map((h, i) => {
    const y = 160 + i * 220
    const t = i * 4 + 1
    const title = (h.title || '').replace(/['":\\,]/g, '').slice(0, 50)
    return `drawtext=text='${title}':fontcolor=white:fontsize=48:x=(w-text_w)/2:y=${y}:enable='between(t\\,${t}\\,${t+3})':box=1:boxcolor=black@0.4:boxborderw=12`
  }).join(',')

  try {
    // Simple: background + music without complex filtering
    const cmd = `ffmpeg -y -f lavfi -i "color=c=0x07111F:s=1920x1080:r=30:d=${dur}" -i "${musicUrl}" -map 0:v -map 1:a -vf "${texts}" -c:v libx264 -preset ultrafast -crf 28 -c:a aac -b:a 192k -ac 2 -shortest "${out}"`
    execSync(cmd, { stdio: 'pipe', timeout: 180000 })
  } catch {
    // Fallback: no music
    const fallback = `ffmpeg -y -f lavfi -i "color=c=0x07111F:s=1920x1080:r=30:d=${dur}" -i "${MUSIC[0]}" -map 0:v -map 1:a -vf "${texts}" -c:v libx264 -preset ultrafast -crf 28 -c:a aac -b:a 192k -ac 2 -shortest "${out}"`
    try {
      execSync(fallback, { stdio: 'pipe', timeout: 180000 })
    } catch {
      // Final fallback: no audio
      const final = `ffmpeg -y -f lavfi -i "color=c=0x07111F:s=1920x1080:r=30:d=${dur}" -vf "${texts}" -c:v libx264 -preset ultrafast -crf 28 -an "${out}"`
      execSync(final, { stdio: 'pipe', timeout: 180000 })
    }
  }

  return out
}
