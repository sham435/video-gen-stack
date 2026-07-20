import { createCanvas, GlobalFonts } from '@napi-rs/canvas'
import { execSync } from 'child_process'
import fs from 'fs'
import path from 'path'

try {
  if (fs.existsSync('assets/fonts/Anton-Regular.ttf'))
    GlobalFonts.registerFromPath('assets/fonts/Anton-Regular.ttf', 'Anton')
  if (fs.existsSync('assets/fonts/Inter-Bold.ttf'))
    GlobalFonts.registerFromPath('assets/fonts/Inter-Bold.ttf', 'InterBold')
} catch {}

const W = 1920, H = 1080

function drawFrame(progress, outPath) {
  const canvas = createCanvas(W, H)
  const ctx = canvas.getContext('2d')

  // Red-black gradient background
  const grad = ctx.createLinearGradient(0, 0, W, H)
  grad.addColorStop(0, '#1A0000')
  grad.addColorStop(0.5, '#2A0000')
  grad.addColorStop(1, '#0A0000')
  ctx.fillStyle = grad
  ctx.fillRect(0, 0, W, H)

  // Circuit lines (subtle tech pattern)
  ctx.strokeStyle = `rgba(255,50,50,${0.05 + Math.sin(progress * 20) * 0.03})`
  ctx.lineWidth = 1
  for (let i = 0; i < 12; i++) {
    const x = (i / 12) * W
    ctx.beginPath()
    ctx.moveTo(x, 0)
    ctx.lineTo(x + 100, H * 0.3)
    ctx.lineTo(x - 50, H * 0.6)
    ctx.lineTo(x + 80, H)
    ctx.stroke()
  }

  // Red accent border
  ctx.strokeStyle = '#EF4444'
  ctx.lineWidth = 3
  ctx.strokeRect(15, 15, W - 30, H - 30)

  ctx.textAlign = 'center'

  // Phase 1: BREAKING NEWS (0-4s)
  if (progress < 0.35) {
    const p = progress / 0.35
    const scale = 0.5 + p * 0.5
    const alpha = Math.min(1, p * 2)
    const xOffset = p < 0.5 ? (0.5 - p) * 200 : 0

    ctx.save()
    ctx.translate(W / 2 + xOffset, H / 2 - 60)
    ctx.scale(scale, scale)
    ctx.globalAlpha = alpha

    // Glitch effect
    if (p > 0.6 && p < 0.75) {
      ctx.fillStyle = '#00FFFF'
      ctx.globalAlpha = 0.3
      ctx.font = '900 80px Anton, Impact, sans-serif'
      ctx.fillText('BREAKING NEWS', 15, 0)
    }

    ctx.globalAlpha = alpha
    ctx.font = '900 110px Anton, Impact, sans-serif'
    ctx.fillStyle = '#FFFFFF'
    ctx.fillText('BREAKING', 0, 0)

    // Red accent line under BREAKING
    if (p > 0.5) {
      ctx.fillStyle = '#EF4444'
      ctx.fillRect(-250, 20, 500, 4)
    }

    ctx.font = '700 40px Inter, sans-serif'
    ctx.fillStyle = '#EF4444'
    ctx.fillText('NEWS', 0, 70)

    ctx.restore()
  }

  // Phase 2: UNFILTERED (4-8s)
  if (progress > 0.3 && progress < 0.7) {
    const p = (progress - 0.3) / 0.4
    const zoom = Math.min(1, p * 1.5)
    const alpha = Math.min(1, p * 2)

    ctx.save()
    ctx.translate(W / 2, H / 2 + 20)
    ctx.scale(zoom, zoom)
    ctx.globalAlpha = alpha

    // Glitch offset
    const glitch = p > 0.3 && p < 0.5 ? (Math.random() > 0.5 ? 8 : -8) : 0
    if (glitch) {
      ctx.fillStyle = '#00FFFF'
      ctx.globalAlpha = 0.2
      ctx.font = '900 100px Anton, Impact, sans-serif'
      ctx.fillText('UNFILTERED', glitch + 10, 0)
    }

    ctx.globalAlpha = alpha
    ctx.font = '900 120px Anton, Impact, sans-serif'
    ctx.fillStyle = '#FFFFFF'
    ctx.fillText('UNFILTERED', glitch, 0)

    ctx.restore()
  }

  // Phase 3: Tagline (8-12s)
  if (progress > 0.65) {
    const p = (progress - 0.65) / 0.35
    const alpha = Math.min(1, p * 2)

    ctx.save()
    ctx.globalAlpha = alpha

    ctx.font = '400 36px Inter, sans-serif'
    ctx.fillStyle = '#FFFFFF'
    ctx.textAlign = 'center'
    ctx.fillText('Real Tech, Real Trends, Real News.', W / 2, H / 2 + 200)

    // Bottom accent bar
    ctx.fillStyle = '#EF4444'
    ctx.fillRect(W / 2 - 120, H / 2 + 230, 240, 3)

    ctx.restore()
  }

  fs.writeFileSync(outPath, canvas.toBuffer('image/png'))
}

export function generateCommonIntro(outDir = 'output') {
  fs.mkdirSync(outDir, { recursive: true })
  const framesDir = `${outDir}/intro_frames`
  fs.mkdirSync(framesDir, { recursive: true })

  const totalFrames = 360
  for (let i = 0; i < totalFrames; i++) {
    const p = i / totalFrames
    drawFrame(p, `${framesDir}/f${String(i).padStart(4, '0')}.png`)
  }

  const introVideo = `${outDir}/intro_12s.mp4`
  const music = 'assets/music/intro_whoosh.mp3'

  const audioSrc = fs.existsSync(music)
    ? `-i "${music}"`
    : '-f lavfi -i "sine=frequency=220:duration=12,volume=0.3"'

  const cmd = `ffmpeg -y -framerate 30 -i "${framesDir}/f%04d.png" ${audioSrc} -c:v libx264 -pix_fmt yuv420p -c:a aac -shortest -t 12 "${introVideo}"`
  execSync(cmd, { stdio: 'inherit', timeout: 60000 })

  console.log('✅ Common intro (BREAKING NEWS UNFILTERED):', introVideo)
  return introVideo
}

if (import.meta.url.endsWith('intro.mjs')) {
  generateCommonIntro()
}
