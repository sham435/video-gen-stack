import { writeFileSync, mkdirSync } from 'fs'

function formatSRTTime(s) {
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = s % 60
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${sec.toFixed(3).replace('.', ',')}`
}

export function generateSRT(script, duration) {
  const words = script.split(' ')
  const targetChunks = Math.max(1, Math.ceil(duration / 2.5))
  const chunkSize = Math.max(1, Math.ceil(words.length / targetChunks))
  const actualChunks = Math.ceil(words.length / chunkSize)
  const timePerChunk = duration / actualChunks

  const lines = []
  for (let i = 0; i < words.length; i += chunkSize) {
    const chunk = words.slice(i, i + chunkSize)
    const start = i / words.length * duration
    const end = Math.min(start + timePerChunk + 0.2, duration)

    lines.push(`${Math.floor(i / chunkSize) + 1}`)
    lines.push(`${formatSRTTime(start)} --> ${formatSRTTime(end)}`)
    lines.push(chunk.join(' '))
    lines.push('')
  }

  return lines.join('\n')
}

export async function burnSubtitles(videoPath, subtitlePath, outputPath) {
  const { execFileSync } = await import('child_process')
  execFileSync(
    'ffmpeg',
    ['-y', '-i', videoPath, '-vf', `subtitles=${subtitlePath}:force_style='FontName=Inter,FontSize=28,PrimaryColour=&H00FFFFFF,BackColour=&H80000000,Outline=0,Shadow=2,Alignment=2,MarginV=100'`, '-c:a', 'copy', outputPath],
    { stdio: 'pipe', timeout: 120000 }
  )
  return outputPath
}
