import { execSync } from 'child_process'
import { tmpdir } from 'os'
import { join } from 'path'

// Professional background music tracks (free license, broadcast quality)
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

  // Build text overlays
  const texts = headlines.map((h, i) => {
    const y = 140 + i * 190
    const t = i * 4 + 1
    const title = (h.title || '').replace(/['":\\,]/g, '').slice(0, 55)
    return `drawtext=text='${title}':fontcolor=white:fontsize=28:x=(w-text_w)/2:y=${y}:enable='between(t\\,${t}\\,${t+3})'`
  }).join(',')

  try {
    // Primary: Background music at professional volume (-20dB) + stereo mix
    // Music at low volume acts as subtle background, not distracting
    const cmd = [
      'ffmpeg -y',
      `-f lavfi -i "color=c=0x07111F:s=1920x1080:r=30:d=${dur}"`,
      `-i "${musicUrl}"`,
      `-filter_complex "[1:a]volume=-18dB[a]"`,
      `-map 0:v -map "[a]"`,
      `-vf "${texts}"`,
      '-c:v libx264 -preset ultrafast -crf 28',
      '-c:a aac -b:a 192k -ac 2',
      '-shortest',
      `"${out}"`,
    ].join(' ')

    execSync(cmd, { stdio: 'pipe', timeout: 180000 })
  } catch {
    // Fallback: same but without music processing
    const fallback = [
      'ffmpeg -y',
      `-f lavfi -i "color=c=0x07111F:s=1920x1080:r=30:d=${dur}"`,
      musicUrl ? `-i "${musicUrl}"` : '',
      '-map 0:v',
      musicUrl ? '-map 1:a' : '',
      `-vf "${texts}"`,
      '-c:v libx264 -preset ultrafast -crf 28',
      musicUrl ? '-c:a aac -b:a 192k -ac 2 -shortest' : '-an',
      `"${out}"`,
    ].filter(Boolean).join(' ')

    execSync(fallback, { stdio: 'pipe', timeout: 180000 })
  }

  return out
}
