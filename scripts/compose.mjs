import { execSync } from 'child_process'
import { readdirSync, existsSync } from 'fs'

export function createVideoWithMusic(imagePath, musicPath, duration, out) {
  const cmd = [
    'ffmpeg -y',
    `-loop 1 -i "${imagePath}"`,
    `-stream_loop -1 -i "${musicPath}"`,
    `-filter_complex "[0:v]scale=1920:1080,zoompan=z='min(zoom+0.0015,1.28)':d=1:x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)',fps=30,format=yuv420p[v];`,
    `[1:a]aformat=channel_layouts=stereo,volume=0.18,afade=t=in:st=0:d=1,afade=t=out:st=${duration - 1}:d=1,loudnorm=I=-16:TP=-1.5:LRA=11[a]"`,
    `-map "[v]" -map "[a]"`,
    `-c:v libx264 -pix_fmt yuv420p`,
    `-c:a aac -b:a 192k`,
    `-t ${duration} -shortest "${out}"`,
  ].join(' ')

  execSync(cmd, { stdio: 'inherit' })
  return out
}

export function getRandomMusic() {
  const dir = 'assets/music'
  if (!existsSync(dir)) return null
  const files = readdirSync(dir).filter(f => f.endsWith('.mp3'))
  if (files.length === 0) return null
  return `${dir}/${files[Math.floor(Math.random() * files.length)]}`
}
