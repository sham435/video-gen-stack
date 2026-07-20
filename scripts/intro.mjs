import { createCanvas, GlobalFonts } from '@napi-rs/canvas'
import { execSync } from 'child_process'
import fs from 'fs'
import path from 'path'

try {
  if (fs.existsSync('assets/fonts/Anton-Regular.ttf'))
    GlobalFonts.registerFromPath('assets/fonts/Anton-Regular.ttf', 'Anton')
} catch {}

const W = 1920, H = 1080

function makeIntroFrame(text, sub, progress, outPath) {
  const canvas = createCanvas(W, H)
  const ctx = canvas.getContext('2d')

  // Dark blue gradient background
  const grad = ctx.createLinearGradient(0, 0, 0, H)
  grad.addColorStop(0, '#050814')
  grad.addColorStop(1, '#101B42')
  ctx.fillStyle = grad
  ctx.fillRect(0, 0, W, H)

  // Animated border
  ctx.strokeStyle = '#5E5CFF'
  ctx.lineWidth = 6
  ctx.strokeRect(20 + progress * 10, 20 + progress * 10, W - 40 - progress * 20, H - 40 - progress * 20)

  // BIG text
  if (progress > 0.2) {
    ctx.font = `900 ${160 - Math.floor(progress * 20)}px Anton, Impact, sans-serif`
    ctx.fillStyle = '#FFFFFF'
    ctx.textAlign = 'center'
    ctx.save()
    ctx.translate(W / 2, H / 2 - 40)
    ctx.transform(1, 0, -0.15, 1, 0, 0)
    ctx.fillText(text, 0, 0)
    ctx.restore()
  }

  // Subtitle
  if (progress > 0.5) {
    ctx.font = '600 32px Inter, sans-serif'
    ctx.fillStyle = 'rgba(255,255,255,0.8)'
    ctx.textAlign = 'center'
    ctx.fillText(sub, W / 2, H / 2 + 120)
  }

  // Scanline effect
  ctx.fillStyle = `rgba(94,92,255,${0.1 + progress * 0.1})`
  ctx.fillRect(0, H / 2 + Math.sin(progress * 10) * 200, W, 2)

  fs.writeFileSync(outPath, canvas.toBuffer('image/png'))
}

export function generateCommonIntro(outDir = 'output') {
  fs.mkdirSync(outDir, { recursive: true })
  const framesDir = `${outDir}/intro_frames`
  fs.mkdirSync(framesDir, { recursive: true })

  const totalFrames = 360 // 12 sec at 30fps
  for (let i = 0; i < totalFrames; i++) {
    const p = i / totalFrames
    makeIntroFrame('UNFILTERED', 'BREAKING NEWS', p, `${framesDir}/f${String(i).padStart(4, '0')}.png`)
  }

  const introVideo = `${outDir}/intro_12s.mp4`
  const music = 'assets/music/intro_whoosh.mp3'

  const cmd = fs.existsSync(music)
    ? `ffmpeg -y -framerate 30 -i "${framesDir}/f%04d.png" -i "${music}" -c:v libx264 -pix_fmt yuv420p -c:a aac -shortest -t 12 "${introVideo}"`
    : `ffmpeg -y -framerate 30 -i "${framesDir}/f%04d.png" -f lavfi -i "sine=frequency=440:duration=12,afade=t=out:st=11:d=1" -c:v libx264 -pix_fmt yuv420p -c:a aac -shortest -t 12 "${introVideo}"`

  execSync(cmd, { stdio: 'inherit' })
  console.log('✅ Common intro:', introVideo)
  return introVideo
}

if (import.meta.url.endsWith('intro.mjs')) {
  generateCommonIntro()
}
