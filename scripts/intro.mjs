/**
 * NEWS-MONSTER | Broadcast Intro v3
 * Spec: 1080×1920, 30fps, 12 seconds (360 frames)
 * 4 Scenes matching the final production sheet
 *
 * [0-2s]   THE SIGNAL — glitch data streaks, particles
 * [2-4.5s] THE HOOK — UNFILTERED text + globe wireframe + tagline
 * [4.5-7.5s] THE SCOPE — BREAKING NEWS + category flicker
 * [7.5-12s] THE BRAND LOCK — NEWS-MONSTER + sham435 + ticker
 */

import { createCanvas, GlobalFonts } from '@napi-rs/canvas'
import { execSync } from 'child_process'
import fs from 'fs'

try {
  if (fs.existsSync('assets/fonts/Anton-Regular.ttf'))
    GlobalFonts.registerFromPath('assets/fonts/Anton-Regular.ttf', 'Anton')
  if (fs.existsSync('assets/fonts/Inter-Black.ttf'))
    GlobalFonts.registerFromPath('assets/fonts/Inter-Black.ttf', 'InterBlack')
  if (fs.existsSync('assets/fonts/Inter-Bold.ttf'))
    GlobalFonts.registerFromPath('assets/fonts/Inter-Bold.ttf', 'InterBold')
} catch {}

const W = 1080, H = 1920, FPS = 30
const TOTAL_FRAMES = 360

const C = {
  bg: '#000000',
  red: '#FF0000',
  cyan: '#00FFFF',
  white: '#FFFFFF',
  gold: '#FFD700',
}

function drawSignalScene(ctx, p) {
  ctx.fillStyle = C.bg
  ctx.fillRect(0, 0, W, H)

  const pp = Math.min(1, p * 2)
  for (let i = 0; i < 30; i++) {
    const x = (i * 37 + pp * 400) % W
    const y = (i * 73) % H
    const len = 10 + Math.sin(i + pp * 20) * 15
    const alpha = 0.05 + Math.random() * 0.15
    ctx.fillStyle = i % 2 === 0 ? `rgba(255,0,0,${alpha})` : `rgba(255,255,255,${alpha})`
    ctx.fillRect(x, y, 2, len)
  }

  for (let i = 0; i < 80; i++) {
    const sx = (i * 47.5 + pp * 600) % W
    const sy = (i * 31.7 + pp * 300) % H
    const size = 1 + Math.random() * 2
    ctx.fillStyle = `rgba(255,255,255,${0.02 + Math.random() * 0.06})`
    ctx.beginPath()
    ctx.arc(sx, sy, size, 0, Math.PI * 2)
    ctx.fill()
  }

  for (let i = 0; i < 8; i++) {
    const bx = (i * 140 + pp * 200) % W
    const sliceH = 1 + Math.random() * 4
    const sliceY = Math.random() * H
    if (Math.random() > 0.6) {
      ctx.fillStyle = `rgba(255,0,0,${0.1 + Math.random() * 0.2})`
      ctx.fillRect(bx, sliceY, Math.random() * 30 + 10, sliceH)
    }
  }
}

function drawHookScene(ctx, p) {
  const grad = ctx.createRadialGradient(W / 2, H * 0.3, 0, W / 2, H * 0.3, W * 0.8)
  grad.addColorStop(0, '#0A0A0A')
  grad.addColorStop(1, C.bg)
  ctx.fillStyle = grad
  ctx.fillRect(0, 0, W, H)

  for (let i = 0; i < 20; i++) {
    const sx = (i * 53 + p * 400) % W
    const sy = (i * 37 + p * 200) % H
    ctx.fillStyle = `rgba(0, 255, 255, ${0.02 + Math.sin(i + p * 5) * 0.015})`
    ctx.beginPath()
    ctx.arc(sx, sy, 1 + Math.sin(i + p * 3), 0, Math.PI * 2)
    ctx.fill()
  }

  const cx = W * 0.78, cy = H * 0.35, r = 200
  ctx.strokeStyle = `rgba(0, 255, 255, ${0.15 + Math.sin(p * 3) * 0.05})`
  ctx.lineWidth = 1
  for (let lat = 0; lat < 4; lat++) {
    const la = (lat / 4) * Math.PI - Math.PI / 2
    const rr = r * Math.cos(la)
    const yy = cy + r * Math.sin(la)
    if (rr > 5) { ctx.beginPath(); ctx.ellipse(cx, yy, rr, rr * 0.3, 0, 0, Math.PI * 2); ctx.stroke() }
  }
  for (let lon = 0; lon < 5; lon++) {
    const lo = (lon / 5) * Math.PI * 2 + p * 0.3
    ctx.beginPath()
    for (let t = 0; t <= 40; t++) {
      const a = (t / 40) * Math.PI * 2
      const px = cx + r * 0.45 * Math.cos(a + lo)
      const py = cy + r * 0.3 * Math.sin(a)
      t === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py)
    }
    ctx.stroke()
  }

  const pp = Math.min(1, p * 1.5)
  const text = 'UNFILTERED'
  const chars = text.split('')
  ctx.font = '900 100px Anton, Impact, sans-serif'
  const cw = ctx.measureText('W').width
  const tw = cw * chars.length
  const sx2 = W * 0.38 - tw / 2

  chars.forEach((ch, i) => {
    const cp = Math.max(0, Math.min(1, (pp * 1.5) - i * 0.1))
    const dir = i % 2 === 0 ? 1 : -1
    const xo = (1 - cp) * 60 * dir
    ctx.save()
    ctx.globalAlpha = cp
    ctx.translate(sx2 + i * cw + cw / 2 + xo, H * 0.35 + (1 - cp) * 30)
    ctx.transform(1, 0, -0.1 * (1 - cp), 1, 0, 0)
    if (cp < 0.7) { ctx.shadowColor = C.red; ctx.shadowBlur = 25 * (1 - cp) }
    ctx.strokeStyle = C.red
    ctx.lineWidth = 2
    ctx.strokeText(ch, 0, 0)
    ctx.fillStyle = C.white
    ctx.fillText(ch, 0, 0)
    ctx.restore()
  })

  const tp = Math.max(0, (p - 0.15) / 0.3)
  if (tp > 0) {
    ctx.save()
    ctx.globalAlpha = tp
    ctx.font = '600 28px Inter, sans-serif'
    ctx.fillStyle = `rgba(255,255,255,${tp * 0.8})`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText('Real Tech, Real Trends, Real News.', W * 0.38, H * 0.52)
    ctx.restore()
  }
}

function drawScopeScene(ctx, p) {
  ctx.fillStyle = C.bg
  ctx.fillRect(0, 0, W, H)

  const pp = Math.min(1, p * 1.5)
  const pulse = 0.3 + Math.sin(p * 30) * 0.15
  ctx.fillStyle = `rgba(255, 0, 0, ${pulse * 0.08})`
  for (let i = 0; i < H; i += 4) ctx.fillRect(0, i, W, 1)

  ctx.strokeStyle = `rgba(255, 0, 0, ${0.08 + Math.sin(p * 20) * 0.05})`
  ctx.lineWidth = 2
  ctx.beginPath()
  ctx.moveTo(0, H * 0.5 + Math.sin(p * 30) * 100)
  ctx.lineTo(W, H * 0.5 + Math.sin(p * 30 + 1) * 100)
  ctx.stroke()
  ctx.beginPath()
  ctx.moveTo(0, H * 0.5 + Math.sin(p * 30 + 2) * 100)
  ctx.lineTo(W, H * 0.5 + Math.sin(p * 30 + 3) * 100)
  ctx.stroke()

  const bp = Math.min(1, pp * 1.2)
  ctx.save()
  ctx.globalAlpha = bp
  ctx.shadowColor = C.red
  ctx.shadowBlur = 40
  ctx.font = '900 70px Anton, Impact, sans-serif'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillStyle = C.white
  ctx.fillText('BREAKING', W / 2, H * 0.28)
  ctx.fillStyle = C.red
  ctx.fillText('NEWS', W / 2, H * 0.38)
  ctx.shadowBlur = 0

  const categories = ['TECH', 'SCIENCE', 'AI', 'SPACE', 'GAMING', 'POLITICS', 'FUTURE']
  const catIdx = Math.floor((p * 7 * 2) % categories.length)
  const catP = (p * 7 * 2) % 1
  ctx.globalAlpha = 1 - catP
  ctx.font = '800 40px Inter, sans-serif'
  ctx.fillStyle = C.cyan
  ctx.fillText(categories[catIdx % categories.length], W / 2, H * 0.52)
  ctx.globalAlpha = catP
  ctx.fillText(categories[(catIdx + 1) % categories.length], W / 2, H * 0.52)
  ctx.restore()
}

function drawBrandLockScene(ctx, p) {
  const pp = Math.min(1, p * 1.5)
  const grad = ctx.createRadialGradient(W / 2, H / 2, 0, W / 2, H / 2, W * 0.7)
  grad.addColorStop(0, '#0D0D0D')
  grad.addColorStop(1, C.bg)
  ctx.fillStyle = grad
  ctx.fillRect(0, 0, W, H)

  ctx.strokeStyle = 'rgba(0, 255, 255, 0.03)'
  ctx.lineWidth = 0.5
  for (let x = 0; x < W; x += 40) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke() }
  for (let y = 0; y < H; y += 40) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke() }

  const logoSize = 100
  const logoX = W / 2 - logoSize / 2
  const logoY = H * 0.12
  const ls = Math.min(1, pp * 2)
  ctx.save()
  ctx.translate(W / 2, logoY + logoSize / 2)
  ctx.scale(ls, ls)
  ctx.translate(-W / 2, -(logoY + logoSize / 2))
  ctx.fillStyle = C.gold
  ctx.shadowColor = C.gold
  ctx.shadowBlur = 30 * (1 - pp * 0.5)
  ctx.beginPath()
  ctx.roundRect(logoX, logoY, logoSize, logoSize, 14)
  ctx.fill()
  ctx.shadowBlur = 0
  ctx.font = '900 60px Anton, Impact, sans-serif'
  ctx.fillStyle = C.bg
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText('NM', W / 2, logoY + logoSize / 2 + 4)
  ctx.restore()

  const nameP = Math.min(1, (pp - 0.1) / 0.3)
  ctx.save()
  ctx.globalAlpha = nameP
  ctx.font = '900 42px Anton, Impact, sans-serif'
  ctx.fillStyle = C.white
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText('NEWS-MONSTER', W / 2, H * 0.40)
  ctx.restore()

  const tagP = Math.min(1, (pp - 0.2) / 0.25)
  ctx.save()
  ctx.globalAlpha = tagP
  ctx.font = '600 22px Inter, sans-serif'
  ctx.fillStyle = `rgba(255,255,255,${tagP * 0.7})`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText('Unfiltered Breaking News From The Future.', W / 2, H * 0.46)
  ctx.restore()

  const ancP = Math.min(1, (pp - 0.35) / 0.25)
  ctx.save()
  ctx.globalAlpha = ancP
  const dotPulse = 0.4 + Math.sin(pp * 20) * 0.3
  ctx.fillStyle = `rgba(255, 0, 0, ${dotPulse})`
  ctx.beginPath()
  ctx.arc(W / 2 - 120, H * 0.55, 7, 0, Math.PI * 2)
  ctx.fill()
  ctx.font = '800 28px Inter, sans-serif'
  ctx.fillStyle = C.white
  ctx.textAlign = 'left'
  ctx.textBaseline = 'middle'
  ctx.fillText('sham435', W / 2 - 100, H * 0.55)
  ctx.font = '500 14px Inter, sans-serif'
  ctx.fillStyle = `rgba(255,255,255,${ancP * 0.4})`
  ctx.fillText('ANCHOR', W / 2 - 100, H * 0.55 + 30)
  ctx.restore()

  const tickP = Math.min(1, (pp - 0.5) / 0.3)
  ctx.save()
  ctx.globalAlpha = tickP
  ctx.fillStyle = 'rgba(255,255,255,0.06)'
  ctx.beginPath()
  ctx.roundRect(W * 0.05, H * 0.78, W * 0.9, 55, 10)
  ctx.fill()
  ctx.strokeStyle = 'rgba(255,255,255,0.08)'
  ctx.lineWidth = 1
  ctx.beginPath()
  ctx.roundRect(W * 0.05, H * 0.78, W * 0.9, 55, 10)
  ctx.stroke()
  const items = ['AI', 'ROBOTICS', 'QUANTUM', 'CYBERSECURITY', 'BIOTECH', 'SPACE']
  const scroll = (pp * 4) % items.length
  ctx.font = '600 16px Inter, sans-serif'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  for (let i = 0; i < 4; i++) {
    const idx = Math.floor(scroll + i) % items.length
    const a = i === 0 ? 1 - (scroll % 1) : 0.6
    ctx.fillStyle = `rgba(255,255,255,${a})`
    ctx.fillText(items[idx], W * 0.12 + i * W * 0.22, H * 0.805)
  }
  ctx.restore()

  ctx.fillStyle = C.red
  ctx.fillRect(W * 0.05, H * 0.94, W * 0.9, 2)
}

function drawFrame(progress, outPath) {
  const canvas = createCanvas(W, H)
  const ctx = canvas.getContext('2d')

  if (progress < 2 / 12) drawSignalScene(ctx, progress / (2 / 12))
  else if (progress < 4.5 / 12) drawHookScene(ctx, (progress - 2 / 12) / (2.5 / 12))
  else if (progress < 7.5 / 12) drawScopeScene(ctx, (progress - 4.5 / 12) / (3 / 12))
  else drawBrandLockScene(ctx, (progress - 7.5 / 12) / (4.5 / 12))

  ctx.font = '500 10px Inter, sans-serif'
  ctx.fillStyle = 'rgba(255,255,255,0.08)'
  ctx.textAlign = 'left'
  ctx.textBaseline = 'top'
  ctx.fillText('NEWS-MONSTER', 12, 12)

  fs.writeFileSync(outPath, canvas.toBuffer('image/png'))
}

export function generateCommonIntro(outDir = 'output') {
  fs.mkdirSync(outDir, { recursive: true })
  const framesDir = `${outDir}/intro_frames`
  fs.mkdirSync(framesDir, { recursive: true })

  console.log(`Generating NEWS-MONSTER intro: ${TOTAL_FRAMES} frames (${FPS}fps, 12s)`)
  for (let i = 0; i < TOTAL_FRAMES; i++) {
    drawFrame(i / TOTAL_FRAMES, `${framesDir}/f${String(i).padStart(4, '0')}.png`)
    if (i % 60 === 0) process.stdout.write(`  Frame ${i}/${TOTAL_FRAMES}\r`)
  }
  process.stdout.write(`  Frame ${TOTAL_FRAMES}/${TOTAL_FRAMES}\n`)

  const introVideo = `${outDir}/intro_12s.mp4`
  generateIntroAudio(`${outDir}/intro_audio.mp3`)

  execSync(
    `ffmpeg -y -framerate ${FPS} -i "${framesDir}/f%04d.png" -i "${outDir}/intro_audio.mp3" ` +
    `-c:v libx264 -crf 20 -preset medium -pix_fmt yuv420p -c:a aac -b:a 192k -shortest -t 12 "${introVideo}"`,
    { stdio: 'inherit' }
  )
  console.log('NEWS-MONSTER intro:', introVideo)
  return introVideo
}

function generateIntroAudio(outPath) {
  try {
    const parts = [
      '-f lavfi -t 0.4 -i "sine=f=80:r=48000,afade=t=out:st=0.3:d=0.1,volume=1.0"',
      '-f lavfi -t 0.6 -i "sine=f=120:r=48000,afade=t=out:st=0.5:d=0.1,volume=0.6"',
      '-f lavfi -t 0.5 -i "sine=f=55:r=48000,afade=t=out:st=0.4:d=0.1,volume=0.9"',
      '-f lavfi -t 12 -i "anoisesrc=d=12:c=pink:a=0.06:r=48000,afade=t=in:st=0:d=0.5,afade=t=out:st=11:d=1,volume=0.3"',
      '-f lavfi -t 12 -i "sine=f=60:r=48000,afade=t=in:st=0:d=0.5,afade=t=out:st=11.5:d=0.5,volume=0.12"',
      '-f lavfi -t 2 -i "sine=f=880:r=48000,afade=t=in:st=0:d=0.02,afade=t=out:st=1.8:d=0.2,volume=0.15"',
      '-f lavfi -t 12 -i "sine=f=220:r=48000,afade=t=in:st=0:d=0.3,afade=t=out:st=11.5:d=0.5,volume=0.06"',
    ]

    const cmd = `ffmpeg -y ${parts.join(' ')} \
      -filter_complex "[0:a]adelay=0|0[hit1];[1:a]adelay=2000|2000[whoosh];[2:a]adelay=4500|4500[alert];[3:a][4:a][5:a][6:a]amix=inputs=4:duration=longest:normalize=0,volume=0.35[bed];[hit1][whoosh][alert][bed]amix=inputs=4:duration=longest:normalize=0,volume=0.6,aformat=sample_rates=48000:channel_layouts=stereo,afade=t=out:st=11.5:d=0.5[a]" \
      -map "[a]" -c:a mp3 -b:a 192k "${outPath}"`

    execSync(cmd, { stdio: 'pipe', timeout: 15000 })
    console.log('Intro audio generated')
  } catch { console.log('Intro audio generation skipped') }
}

if (import.meta.url.endsWith('intro.mjs')) {
  generateCommonIntro(process.argv[2] || 'output')
}
