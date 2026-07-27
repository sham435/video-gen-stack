/**
 * NEWS-MONSTER | Broadcast Intro
 * 8 scenes over 14 seconds, 1080×1920 vertical
 *
 * Scenes:
 *   0-1.5s  Flash → "BREAKING NEWS" impact
 *   1.5-3s  Category montage: AI, Gaming, Sports, Space, Politics
 *   3-5s    "UNFILTERED" word build
 *   5-7s    Globe + network connections
 *   7-9s    NEWS-MONSTER logo reveal
 *   9-11s   Tagline + anchor
 *   11-14s  Category ticker + CTA
 */

import { createCanvas, GlobalFonts } from '@napi-rs/canvas'
import { execSync } from 'child_process'
import fs from 'fs'

try {
  if (fs.existsSync('assets/fonts/Anton-Regular.ttf'))
    GlobalFonts.registerFromPath('assets/fonts/Anton-Regular.ttf', 'Anton')
  if (fs.existsSync('assets/fonts/Inter-Black.ttf'))
    GlobalFonts.registerFromPath('assets/fonts/Inter-Black.ttf', 'InterBlack')
} catch {}

const W = 1080, H = 1920
const FPS = 30
const TOTAL_FRAMES = 420

const C = {
  bg: '#050505',
  red: '#E10600',
  cyan: '#00E5FF',
  white: '#FFFFFF',
  gold: '#FFD700',
  magenta: '#E100FF',
}

function drawScene1(ctx, p) {
  const grad = ctx.createRadialGradient(W / 2, H / 2, 0, W / 2, H / 2, W * 0.7)
  grad.addColorStop(0, '#1A0505')
  grad.addColorStop(0.5, '#0A0505')
  grad.addColorStop(1, C.bg)
  ctx.fillStyle = grad
  ctx.fillRect(0, 0, W, H)

  const pp = Math.min(1, p * 3)
  ctx.save()
  ctx.globalAlpha = pp
  const scale = 1.2 - pp * 0.2
  ctx.translate(W / 2, H / 2)
  ctx.scale(scale, scale)
  ctx.translate(-W / 2, -H / 2)

  ctx.fillStyle = `rgba(225, 6, 0, ${0.2 * (1 - pp)})`
  ctx.beginPath()
  ctx.arc(W / 2, H / 2, 400 * (1 + (1 - pp) * 3), 0, Math.PI * 2)
  ctx.fill()

  ctx.font = '900 100px Anton, Impact, sans-serif'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.shadowColor = C.red
  ctx.shadowBlur = 60 * (1 - pp * 0.5)
  ctx.fillStyle = C.white
  ctx.fillText('BREAKING', W / 2, H * 0.42)
  ctx.fillStyle = C.red
  ctx.fillText('NEWS', W / 2, H * 0.56)
  ctx.shadowBlur = 0
  ctx.restore()
}

function drawScene2(ctx, p) {
  const pp = Math.min(1, p * 1.5)
  ctx.fillStyle = '#050505'
  ctx.fillRect(0, 0, W, H)

  const categories = [
    { icon: '🤖', label: 'AI', x: W * 0.15, delay: 0 },
    { icon: '🎮', label: 'GAMING', x: W * 0.38, delay: 0.15 },
    { icon: '🚀', label: 'SPACE', x: W * 0.62, delay: 0.3 },
    { icon: '🏆', label: 'SPORTS', x: W * 0.85, delay: 0.45 },
  ]

  ctx.font = '700 24px Inter, sans-serif'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'

  categories.forEach(cat => {
    const cp = Math.max(0, Math.min(1, (pp - cat.delay) / 0.3))
    if (cp <= 0) return
    ctx.save()
    ctx.globalAlpha = cp
    const cs = 0.5 + cp * 0.5
    ctx.translate(cat.x, H * 0.35)
    ctx.scale(cs, cs)
    ctx.font = '40px sans-serif'
    ctx.fillText(cat.icon, 0, -30)
    ctx.font = '800 22px Inter, sans-serif'
    ctx.fillStyle = C.cyan
    ctx.fillText(cat.label, 0, 20)
    ctx.restore()
  })

  const subP = Math.max(0, (pp - 0.3) / 0.4)
  if (subP > 0) {
    ctx.save()
    ctx.globalAlpha = subP
    ctx.font = '500 28px Inter, sans-serif'
    ctx.fillStyle = 'rgba(255,255,255,0.7)'
    ctx.textAlign = 'center'
    ctx.fillText('Unfiltered Breaking News From Every Category', W / 2, H * 0.65)
    ctx.restore()
  }
}

function drawScene3(ctx, p) {
  const pp = Math.min(1, p * 1.2)

  const grad = ctx.createLinearGradient(0, 0, 0, H)
  grad.addColorStop(0, '#080808')
  grad.addColorStop(0.5, '#0D0D0D')
  grad.addColorStop(1, '#050505')
  ctx.fillStyle = grad
  ctx.fillRect(0, 0, W, H)

  const text = 'UNFILTERED'
  const chars = text.split('')
  ctx.font = '900 120px Anton, Impact, sans-serif'
  const charW = ctx.measureText('W').width
  const totalW = charW * chars.length
  const startX = W / 2 - totalW / 2

  chars.forEach((ch, i) => {
    const charP = Math.max(0, Math.min(1, (pp * 1.5) - i * 0.08))
    const dir = i % 2 === 0 ? 1 : -1
    const xOff = (1 - charP) * 80 * dir * (1 - i * 0.1)
    ctx.save()
    ctx.globalAlpha = charP
    ctx.translate(startX + i * charW + charW / 2 + xOff, H / 2 - 20 + (1 - charP) * 40)
    ctx.transform(1, 0, -0.12 * (1 - charP), 1, 0, 0)
    if (charP < 0.8) {
      ctx.shadowColor = C.red
      ctx.shadowBlur = 30 * (1 - charP)
    }
    ctx.fillStyle = C.white
    ctx.fillText(ch, 0, 0)
    ctx.restore()
  })

  const glow = ctx.createRadialGradient(W / 2, H / 2, 0, W / 2, H / 2, 400)
  glow.addColorStop(0, `rgba(225, 6, 0, ${0.12 * (1 - pp * 0.5)})`)
  glow.addColorStop(1, 'rgba(225, 6, 0, 0)')
  ctx.fillStyle = glow
  ctx.fillRect(0, 0, W, H)

  if (pp > 0.4) {
    const tp = (pp - 0.4) / 0.4
    ctx.save()
    ctx.globalAlpha = tp
    ctx.font = '500 24px Inter, sans-serif'
    ctx.fillStyle = `rgba(255,255,255,${tp * 0.7})`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText('Breaking News From The Future', W / 2, H / 2 + 90)
    ctx.restore()
  }
}

function drawScene4(ctx, p) {
  const pp = Math.min(1, p * 1.2)
  ctx.fillStyle = '#050505'
  ctx.fillRect(0, 0, W, H)

  const cx = W / 2, cy = H * 0.4, r = 280
  ctx.strokeStyle = `rgba(0, 229, 255, ${0.12 + Math.sin(pp * 2) * 0.05})`
  ctx.lineWidth = 1

  for (let lat = 0; lat < 5; lat++) {
    const la = (lat / 5) * Math.PI - Math.PI / 2
    const rr = r * Math.cos(la)
    const yy = cy + r * Math.sin(la)
    if (rr > 5) { ctx.beginPath(); ctx.ellipse(cx, yy, rr, rr * 0.35, 0, 0, Math.PI * 2); ctx.stroke() }
  }
  for (let lon = 0; lon < 6; lon++) {
    const lo = (lon / 6) * Math.PI * 2 + pp * 0.5
    ctx.beginPath()
    for (let t = 0; t <= 60; t++) {
      const a = (t / 60) * Math.PI * 2
      const px = cx + r * Math.cos(a + lo) * 0.5
      const py = cy + r * 0.4 * Math.sin(a)
      t === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py)
    }
    ctx.stroke()
  }

  const scanAngle = pp * Math.PI * 2
  ctx.strokeStyle = `rgba(0, 229, 255, 0.15)`
  ctx.lineWidth = 2
  ctx.beginPath()
  ctx.moveTo(cx, cy)
  ctx.lineTo(cx + r * 0.6 * Math.cos(scanAngle), cy + r * 0.4 * Math.sin(scanAngle))
  ctx.stroke()

  ctx.font = '800 52px Anton, Impact, sans-serif'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillStyle = `rgba(225, 6, 0, ${Math.min(1, pp * 1.5)})`
  ctx.shadowColor = C.red
  ctx.shadowBlur = 30 * pp
  ctx.fillText('GLOBAL NETWORK', W / 2, H * 0.15)
  ctx.shadowBlur = 0
}

function drawScene5(ctx, p) {
  const pp = Math.min(1, p * 1.5)
  const grad = ctx.createRadialGradient(W / 2, H / 2, 0, W / 2, H / 2, W * 0.7)
  grad.addColorStop(0, '#0D0D0D')
  grad.addColorStop(1, C.bg)
  ctx.fillStyle = grad
  ctx.fillRect(0, 0, W, H)

  ctx.strokeStyle = 'rgba(0, 229, 255, 0.03)'
  ctx.lineWidth = 0.5
  for (let x = 0; x < W; x += 40) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke() }
  for (let y = 0; y < H; y += 40) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke() }

  const logoSize = 120
  const logoX = W / 2 - logoSize / 2
  const logoY = H * 0.2
  const ls = Math.min(1, pp * 2)
  ctx.save()
  ctx.translate(W / 2, logoY + logoSize / 2)
  ctx.scale(ls, ls)
  ctx.translate(-W / 2, -(logoY + logoSize / 2))
  ctx.fillStyle = C.red
  ctx.beginPath()
  ctx.roundRect(logoX, logoY, logoSize, logoSize, 16)
  ctx.fill()
  ctx.font = '900 72px Anton, Impact, sans-serif'
  ctx.fillStyle = C.white
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText('NM', W / 2, logoY + logoSize / 2 + 6)
  ctx.restore()

  const nameP = Math.min(1, (pp - 0.1) / 0.4)
  ctx.save()
  ctx.globalAlpha = nameP
  ctx.font = '900 48px Anton, Impact, sans-serif'
  ctx.fillStyle = C.white
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText('NEWS-MONSTER', W / 2, H * 0.48)
  ctx.restore()
}

function drawScene6(ctx, p) {
  const pp = Math.min(1, p * 1.5)
  const grad = ctx.createRadialGradient(W / 2, H / 2, 0, W / 2, H / 2, W * 0.7)
  grad.addColorStop(0, '#0D0D0D')
  grad.addColorStop(1, C.bg)
  ctx.fillStyle = grad
  ctx.fillRect(0, 0, W, H)

  const tagP = Math.min(1, (pp - 0.1) / 0.3)
  ctx.save()
  ctx.globalAlpha = tagP
  ctx.font = '700 34px Inter, sans-serif'
  ctx.fillStyle = `rgba(0, 229, 255, ${tagP})`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText('Unfiltered Breaking News From The Future', W / 2, H * 0.38)
  ctx.restore()

  const ancP = Math.min(1, (pp - 0.3) / 0.3)
  if (ancP > 0) {
    ctx.save()
    ctx.globalAlpha = ancP
    const dotPulse = 0.4 + Math.sin(pp * 20) * 0.3
    ctx.fillStyle = `rgba(225, 6, 0, ${dotPulse})`
    ctx.beginPath()
    ctx.arc(W / 2 - 130, H * 0.52, 8, 0, Math.PI * 2)
    ctx.fill()
    ctx.font = '800 28px Inter, sans-serif'
    ctx.fillStyle = C.white
    ctx.textAlign = 'left'
    ctx.textBaseline = 'middle'
    ctx.fillText('sham435', W / 2 - 110, H * 0.52)
    ctx.font = '500 16px Inter, sans-serif'
    ctx.fillStyle = `rgba(255,255,255,${ancP * 0.5})`
    ctx.textAlign = 'left'
    ctx.fillText('ANCHOR', W / 2 - 110, H * 0.52 + 32)
    ctx.restore()
  }

  const tickP = Math.min(1, (pp - 0.5) / 0.3)
  if (tickP > 0) {
    ctx.save()
    ctx.globalAlpha = tickP
    ctx.fillStyle = 'rgba(255,255,255,0.06)'
    ctx.beginPath()
    ctx.roundRect(W * 0.05, H * 0.78, W * 0.9, 60, 10)
    ctx.fill()
    const items = ['AI', 'Gaming', 'Sports', 'Space', 'Politics', 'Tech', 'Science']
    const scroll = (pp * items.length * 0.5) % items.length
    ctx.font = '600 18px Inter, sans-serif'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    for (let i = 0; i < 5; i++) {
      const idx = Math.floor(scroll + i) % items.length
      const alpha = i === 0 ? 1 - (scroll % 1) : 0.6
      ctx.fillStyle = `rgba(255,255,255,${alpha})`
      ctx.fillText(items[idx], W * 0.1 + i * W * 0.2, H * 0.81)
    }
    ctx.restore()
  }
}

function drawFrame(progress, outPath) {
  const canvas = createCanvas(W, H)
  const ctx = canvas.getContext('2d')

  if (progress < 1.5 / 14) drawScene1(ctx, progress / (1.5 / 14))
  else if (progress < 3 / 14) drawScene2(ctx, (progress - 1.5 / 14) / (1.5 / 14))
  else if (progress < 5 / 14) drawScene3(ctx, (progress - 3 / 14) / (2 / 14))
  else if (progress < 7 / 14) drawScene4(ctx, (progress - 5 / 14) / (2 / 14))
  else if (progress < 9 / 14) drawScene5(ctx, (progress - 7 / 14) / (2 / 14))
  else drawScene6(ctx, (progress - 9 / 14) / (5 / 14))

  ctx.font = '500 10px Inter, sans-serif'
  ctx.fillStyle = 'rgba(255,255,255,0.1)'
  ctx.textAlign = 'left'
  ctx.textBaseline = 'top'
  ctx.fillText('NEWS-MONSTER', 12, 12)

  fs.writeFileSync(outPath, canvas.toBuffer('image/png'))
}

export function generateCommonIntro(outDir = 'output', format = 'hd') {
  fs.mkdirSync(outDir, { recursive: true })
  const framesDir = `${outDir}/intro_frames`
  fs.mkdirSync(framesDir, { recursive: true })

  console.log(`Generating NEWS-MONSTER intro: ${TOTAL_FRAMES} frames (${FPS}fps, 14s)`)

  for (let i = 0; i < TOTAL_FRAMES; i++) {
    drawFrame(i / TOTAL_FRAMES, `${framesDir}/f${String(i).padStart(4, '0')}.png`)
    if (i % 60 === 0) process.stdout.write(`  Frame ${i}/${TOTAL_FRAMES}\r`)
  }
  process.stdout.write(`  Frame ${TOTAL_FRAMES}/${TOTAL_FRAMES}\n`)

  const introVideo = `${outDir}/intro_12s.mp4`
  generateIntroAudio(`${outDir}/intro_audio.mp3`)

  const cmd = `ffmpeg -y -framerate ${FPS} -i "${framesDir}/f%04d.png" -i "${outDir}/intro_audio.mp3" -c:v libx264 -crf 20 -preset medium -pix_fmt yuv420p -c:a aac -b:a 192k -shortest -t 14 "${introVideo}"`
  console.log('Encoding intro...')
  execSync(cmd, { stdio: 'inherit' })
  console.log('NEWS-MONSTER intro:', introVideo)
  return introVideo
}

function generateIntroAudio(outPath) {
  try {
    const parts = [
      '-f lavfi -t 0.4 -i "sine=f=80:r=48000,afade=t=out:st=0.3:d=0.1,volume=1.0"',
      '-f lavfi -t 0.6 -i "sine=f=120:r=48000,afade=t=out:st=0.5:d=0.1,volume=0.5"',
      '-f lavfi -t 0.5 -i "sine=f=55:r=48000,afade=t=out:st=0.4:d=0.1,volume=0.8"',
      '-f lavfi -t 14 -i "anoisesrc=d=14:c=pink:a=0.06:r=48000,afade=t=in:st=0:d=0.5,afade=t=out:st=13:d=1,volume=0.3"',
      '-f lavfi -t 14 -i "sine=f=55:r=48000,afade=t=in:st=0:d=0.5,afade=t=out:st=13.5:d=0.5,volume=0.10"',
      '-f lavfi -t 2 -i "sine=f=440:r=48000,afade=t=in:st=0:d=0.05,afade=t=out:st=1.8:d=0.2,volume=0.2"',
      '-f lavfi -t 14 -i "sine=f=220:r=48000,afade=t=in:st=0:d=0.3,afade=t=out:st=13.5:d=0.5,volume=0.06"',
    ]

    const cmd = `ffmpeg -y ${parts.join(' ')} \
      -filter_complex "[0:a]adelay=0|0[hit1];[1:a]adelay=400|400[hit2];[2:a]adelay=3000|3000[hit3];[3:a][4:a][5:a][6:a]amix=inputs=4:duration=longest:normalize=0,volume=0.4[bed];[hit1][hit2][hit3][bed]amix=inputs=4:duration=longest:normalize=0,volume=0.6,aformat=sample_rates=48000:channel_layouts=stereo,afade=t=out:st=13.5:d=0.5[a]" \
      -map "[a]" -c:a mp3 -b:a 192k "${outPath}"`

    execSync(cmd, { stdio: 'pipe', timeout: 15000 })
    console.log('Intro audio generated')
  } catch { console.log('Intro audio generation skipped') }
}

if (import.meta.url.endsWith('intro.mjs')) {
  generateCommonIntro(process.argv[2] || 'output', process.argv.includes('--4k') ? '4k' : 'hd')
}
