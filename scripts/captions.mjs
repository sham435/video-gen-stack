import { writeFileSync, mkdirSync, existsSync } from 'fs'

export function generateSRT(script, duration) {
  const words = script.split(' ')
  const chunkSize = Math.ceil(words.length / Math.ceil(duration / 2.5))
  const timePerChunk = duration / Math.ceil(words.length / chunkSize)

  const lines = []
  for (let i = 0; i < words.length; i += chunkSize) {
    const chunk = words.slice(i, i + chunkSize)
    const start = i * timePerChunk
    const end = Math.min(start + timePerChunk + 0.3, duration)

    const fmt = s => {
      const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60
      return `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(sec.toFixed(3)).padStart(6,'0').replace('.',',')}`
    }

    lines.push(`${Math.floor(i / chunkSize) + 1}`)
    lines.push(`${fmt(start)} --> ${fmt(end)}`)
    lines.push(chunk.join(' '))
    lines.push('')
  }

  return lines.join('\n')
}

export async function burnSubtitles(videoPath, subtitlePath, outputPath) {
  const { execSync } = await import('child_process')
  execSync(
    `ffmpeg -y -i "${videoPath}" -vf "subtitles=${subtitlePath}:force_style='FontName=Inter,FontSize=24,PrimaryColour=&H00FFFFFF,BackColour=&H80000000,Outline=0,Shadow=1,Alignment=2,MarginV=80'" -c:a copy "${outputPath}"`,
    { stdio: 'pipe', timeout: 60000 }
  )
  return outputPath
}
