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

const THEMES = {
  apple:   { bg0: '#0A0A23', bg1: '#1E1E60', accent: '#5E5CFF' },
  samsung: { bg0: '#0A1623', bg1: '#0F3A5F', accent: '#00A8FF' },
  ai:      { bg0: '#0A0A1A', bg1: '#1A0A3E', accent: '#8B5CF6' },
  gaming:  { bg0: '#230A14', bg1: '#601E3A', accent: '#FF2D7B' },
  security:{ bg0: '#1A0505', bg1: '#3A0A0A', accent: '#EF4444' },
  default: { bg0: '#0B1020', bg1: '#1A2A5A', accent: '#3B82F6' },
}

function getTheme(title) {
  const t = (title || '').toLowerCase()
  if (t.includes('apple') || t.includes('iphone') || t.includes('siri') || t.includes('ios')) return 'apple'
  if (t.includes('samsung') || t.includes('galaxy') || t.includes('fold')) return 'samsung'
  if (t.includes('ai') || t.includes('chatgpt') || t.includes('openai')) return 'ai'
  if (t.includes('xbox') || t.includes('playstation') || t.includes('nintendo') || t.includes('game')) return 'gaming'
  if (t.includes('cyber') || t.includes('hack') || t.includes('breach')) return 'security'
  return 'default'
}

function ff(c) { return c.replace('#', '0x') }

export async function renderNewsVideo(headlines, options = {}) {
  const tmp = tmpdir()
  const out = join(tmp, `v_${Date.now()}.mp4`)
  const musicUrl = options.musicUrl || MUSIC[Math.floor(Math.random() * MUSIC.length)]
  const imageUrl = options.imageUrl || (headlines[0] || {}).imageUrl

  const article = headlines[0] || {}
  const title = (article.title || '').replace(/['":\\,]/g, '').slice(0, 80)
  const rawSource = typeof article.source === 'string' ? article.source : article.source?.name || ''
  const source = rawSource.replace(/['":\\,]/g, '').slice(0, 40)
  const theme = THEMES[getTheme(title)]
  const duration = 10
  const bg0 = ff(theme.bg0)
  const bg1 = ff(theme.bg1)
  const accent = ff(theme.accent)

  // Scene files
  const bgPath = join(tmp, `bg_${Date.now()}.mp4`)
  const imgPath = join(tmp, `img_${Date.now()}.jpg`)
  const overlayPath = join(tmp, `ol_${Date.now()}.mp4`)
  const renderedPath = join(tmp, `ren_${Date.now()}.mp4`)

  try {
    // 1. Gradient background
    execSync(`ffmpeg -y -f lavfi -i "color=c=${bg0}:s=1920x1080:d=${duration}:r=30" -f lavfi -i "color=c=${bg1}:s=1920x1080:d=${duration}:r=30,format=rgba,colorchannelmixer=aa=0.35" -filter_complex "[0][1]overlay=0:0" -c:v libx264 -preset ultrafast -crf 24 "${bgPath}"`, { stdio: 'pipe', timeout: 30000 })

    // 2. Image overlay if available
    let hasImage = false
    if (imageUrl) {
      try {
        execSync(`curl -sL "${imageUrl}" -o "${imgPath}" --max-time 10`, { stdio: 'pipe', timeout: 15000 })
        execSync(`ffmpeg -y -i "${imgPath}" -vf "scale=1920:1080:force_original_aspect_ratio=increase,crop=1920:1080,gblur=sigma=25,colorchannelmixer=aa=0.3" -c:v libx264 -preset ultrafast -crf 28 -t ${duration} -r 30 "${overlayPath}"`, { stdio: 'pipe', timeout: 30000 })
        hasImage = true
      } catch {}
    }

    // 3. Final scene with text overlay
    const accentLine = `drawtext=text='|':fontcolor=${accent}:fontsize=80:x=80:y=200:box=1:boxcolor=0x000000@0.2:boxborderw=2`
    const headline = `drawtext=text='${title}':fontcolor=white:fontsize=52:x=100:y=280:box=1:boxcolor=0x000000@0.4:boxborderw=16`
    const srcText = source ? `,drawtext=text='${source}':fontcolor=${accent}:fontsize=22:x=100:y=500:box=1:boxcolor=0x000000@0.3:boxborderw=10` : ''
    const badgeText = `,drawtext=text='${getTheme(title).toUpperCase()}':fontcolor=${accent}:fontsize=14:x=80:y=80:box=1:boxcolor=0x000000@0.4:boxborderw=8`
    const bottomText = `,drawtext=text='NEWS  |  1/1':fontcolor=gray:fontsize=16:x=80:y=h-60:box=1:boxcolor=0x000000@0.3:boxborderw=8`

    const inputSource = hasImage ? `-i "${overlayPath}"` : `-i "${bgPath}"`
    const vf = `${accentLine},${headline}${srcText}${badgeText}${bottomText}`

    execSync(`ffmpeg -y ${inputSource} -vf "${vf}" -c:v libx264 -preset ultrafast -crf 24 "${renderedPath}"`, { stdio: 'pipe', timeout: 30000 })

    // 4. Add music with loudnorm
    try {
      execSync(
        `ffmpeg -y -i "${renderedPath}" -i "${musicUrl}" -map 0:v -map 1:a ` +
        `-filter_complex "[1:a]volume=0.18,afade=t=in:st=0:d=1.5,afade=t=out:st=${duration-1.5}:d=1.5,loudnorm=I=-16:TP=-1.5:LRA=11[mu]" ` +
        `-map "[mu]" -c:v copy -c:a aac -b:a 192k -ac 2 -shortest "${out}"`,
        { stdio: 'pipe', timeout: 60000 }
      )
    } catch {
      execSync(`ffmpeg -y -i "${renderedPath}" -c:v copy -an "${out}"`, { stdio: 'pipe', timeout: 30000 })
    }
  } catch (e) {
    // Ultimate fallback: simple text on color
    const simpleCmd = `ffmpeg -y -f lavfi -i "color=c=0x0B1020:s=1920x1080:d=${duration}:r=30" -vf "drawtext=text='${title}':fontcolor=white:fontsize=48:x=(w-text_w)/2:y=(h-text_h)/2:box=1:boxcolor=black@0.4:boxborderw=16" -c:v libx264 -preset ultrafast -crf 28 -an "${out}"`
    execSync(simpleCmd, { stdio: 'pipe', timeout: 60000 })
  }

  // Cleanup temp files
  try { [bgPath, imgPath, overlayPath, renderedPath].forEach(p => { try { unlinkSync(p) } catch {} }) } catch {}

  return out
}
