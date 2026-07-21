/**
 * TECH-MONSTER | AI News Broadcast Intro
 * Spec: 3840×2160 60fps (rendered at 1920×1080 30fps, upscaled)
 * Style: Cyberpunk Digital Newsroom — Network grids, holographic elements
 *         5 scenes over 12 seconds
 *
 * Scenes:
 *   0-2s    "BREAKING NEWS" + "Real Tech, Real Trends, Real News." + grid
 *   2-4.5s  "UNFILTERED" digital fragment assemble + red glow
 *   4.5-7s  "BREAKING NEWS" energy burst + data streams + holographic panels
 *   7-9.5s  Global AI network globe + radar scan + orbital camera
 *   9.5-12s Final card: TECH-MONSTER logo + anchor sham435 + live dot + ticker
 */

import { createCanvas, GlobalFonts } from '@napi-rs/canvas'
import { execSync } from 'child_process'
import fs from 'fs'

// ── Fonts ──
try {
  if (fs.existsSync('assets/fonts/Anton-Regular.ttf'))
    GlobalFonts.registerFromPath('assets/fonts/Anton-Regular.ttf', 'Anton')
  if (fs.existsSync('assets/fonts/Inter-Bold.ttf'))
    GlobalFonts.registerFromPath('assets/fonts/Inter-Bold.ttf', 'InterBold')
  if (fs.existsSync('assets/fonts/Inter-Black.ttf'))
    GlobalFonts.registerFromPath('assets/fonts/Inter-Black.ttf', 'InterBlack')
} catch {}

const W = 1920, H = 1080  // render resolution; upscale to 4K in FFmpeg
const FPS = 30
const TOTAL_FRAMES = 360  // 12s × 30fps

const COLORS = {
  bg: '#050505',
  bg2: '#111111',
  red: '#E10600',
  cyan: '#00E5FF',
  white: '#FFFFFF',
  glass: 'rgba(255,255,255,0.06)',
  glassBorder: 'rgba(255,255,255,0.1)',
}

// ===================================================================
// DRAWING HELPERS
// ===================================================================

/**
 * Scene 1: Dark digital grid + floating data particles + camera push
 */
function drawScene1(ctx, p) {
  // p = progress from 0 to 1 for this scene
  const pp = p  // 0→1 over 2s

  // Gradient background
  const grad = ctx.createRadialGradient(W/2, H/2, 0, W/2, H/2, W*0.7)
  grad.addColorStop(0, '#111111')
  grad.addColorStop(0.5, '#0A0A0A')
  grad.addColorStop(1, COLORS.bg)
  ctx.fillStyle = grad
  ctx.fillRect(0, 0, W, H)

  // Digital grid (perspective)
  ctx.strokeStyle = `rgba(0, 229, 255, ${0.06 + pp * 0.04})`
  ctx.lineWidth = 1
  const vanishX = W/2, vanishY = H * 0.35
  for (let i = -20; i <= 20; i++) {
    const x = vanishX + i * 25 * (1 + pp * 0.3)
    ctx.beginPath()
    ctx.moveTo(vanishX + i * 4, vanishY)
    ctx.lineTo(x, H)
    ctx.stroke()
  }
  // Horizontal grid lines
  for (let j = 1; j <= 10; j++) {
    const yy = vanishY + (H - vanishY) * (j / 10)
    const spread = 30 + j * 80
    ctx.beginPath()
    ctx.moveTo(vanishX - spread, yy)
    ctx.lineTo(vanishX + spread, yy)
    ctx.stroke()
  }

  // Floating data particles
  for (let i = 0; i < 60; i++) {
    const seed = i * 137.5
    const x = ((seed + pp * 300) % W)
    const y = ((seed * 0.7 + pp * 200) % H)
    const size = 1 + Math.sin(seed + pp * 10) * 1.5
    const alpha = 0.1 + Math.sin(seed * 0.5 + pp * 4) * 0.08
    ctx.fillStyle = `rgba(0, 229, 255, ${Math.max(0, alpha)})`
    ctx.beginPath()
    ctx.arc(x, y, Math.max(0.5, size), 0, Math.PI * 2)
    ctx.fill()
  }

  // Network connection lines between nearby nodes
  ctx.strokeStyle = `rgba(225, 6, 0, ${0.04 + Math.sin(pp * 8) * 0.03})`
  ctx.lineWidth = 0.5
  for (let i = 0; i < 15; i++) {
    const x1 = (i * 137.5) % W
    const y1 = (i * 97.3) % H
    const x2 = ((i + 5) * 137.5 + pp * 100) % W
    const y2 = ((i + 5) * 97.3 + pp * 80) % H
    ctx.beginPath()
    ctx.moveTo(x1, y1)
    ctx.lineTo(x2, y2)
    ctx.stroke()
  }

  // Red energy pulse
  const pulseSize = 200 + Math.sin(pp * Math.PI) * 100
  const pulse = ctx.createRadialGradient(W/2, H/2, 0, W/2, H/2, pulseSize)
  pulse.addColorStop(0, `rgba(225, 6, 0, ${0.08 * (1 - pp)})`)
  pulse.addColorStop(1, 'rgba(225, 6, 0, 0)')
  ctx.fillStyle = pulse
  ctx.fillRect(0, 0, W, H)

  // Camera push effect — vignette narrowing
  const vScale = 1 - pp * 0.05
  ctx.fillStyle = 'rgba(0,0,0,0)'
  ctx.strokeStyle = `rgba(0,0,0,${pp * 0.15})`
  ctx.lineWidth = (1 - vScale) * W / 2
  ctx.strokeRect(0, 0, W, H)

  // BREAKING NEWS — appears from first second
  const bp = Math.min(1, pp * 2)
  ctx.save()
  ctx.globalAlpha = bp
  ctx.font = '900 90px Anton, Impact, sans-serif'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.shadowColor = COLORS.red
  ctx.shadowBlur = 40 * (1 - bp * 0.5)
  ctx.fillStyle = '#FFFFFF'
  ctx.fillText('BREAKING', W/2, H * 0.38)
  ctx.fillStyle = COLORS.red
  ctx.fillText('NEWS', W/2, H * 0.52)
  ctx.shadowBlur = 0
  ctx.restore()

  // "Real Tech, Real Trends, Real News." from the start
  const tp = Math.min(1, pp * 2.5)
  ctx.font = '500 42px Inter, sans-serif'
  ctx.fillStyle = `rgba(255,255,255,${tp * 0.8})`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText('Real Tech, Real Trends, Real News.', W/2, H * 0.66)
}

/**
 * Scene 2: UNFILTERED digital fragment assemble + red glow
 */
function drawScene2(ctx, p) {
  const pp = p  // 0→1 over 2.5s

  // Background: dark with horizontal scanlines
  const grad = ctx.createLinearGradient(0, 0, 0, H)
  grad.addColorStop(0, '#080808')
  grad.addColorStop(0.5, '#0D0D0D')
  grad.addColorStop(1, '#050505')
  ctx.fillStyle = grad
  ctx.fillRect(0, 0, W, H)

  // Scan lines
  ctx.fillStyle = `rgba(0, 229, 255, ${0.02 + Math.sin(pp * 30) * 0.01})`
  for (let i = 0; i < H; i += 4) ctx.fillRect(0, i, W, 1)

  // "UNFILTERED" text — fragment assemble
  const fontSize = 130
  ctx.font = `900 ${fontSize}px Anton, Impact, sans-serif`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'

  // Fragment effect: characters appear with offset
  const text = 'UNFILTERED'
  const chars = text.split('')
  const charWidth = ctx.measureText('W').width
  const totalWidth = charWidth * chars.length
  const startX = W / 2 - totalWidth / 2

  chars.forEach((ch, i) => {
    const charP = Math.max(0, Math.min(1, (pp * 1.5) - i * 0.08))
    const xOffset = (1 - charP) * (Math.random() > 0.5 ? 80 : -80) * (1 - i * 0.1)
    const alpha = charP
    const yOffset = (1 - charP) * 40

    ctx.save()
    ctx.globalAlpha = alpha
    ctx.translate(startX + i * charWidth + charWidth / 2 + xOffset, H/2 - 20 + yOffset)
    ctx.transform(1, 0, -0.12 * (1 - charP), 1, 0, 0)

    // Red glow on assemble
    if (charP < 0.8) {
      ctx.shadowColor = COLORS.red
      ctx.shadowBlur = 30 * (1 - charP)
    }

    ctx.fillStyle = '#FFFFFF'
    ctx.fillText(ch, 0, 0)
    ctx.restore()
  })

  // Red glow pulse behind text
  const glowR = 300 + Math.sin(pp * 6) * 80
  const glow = ctx.createRadialGradient(W/2, H/2, 0, W/2, H/2, glowR)
  glow.addColorStop(0, `rgba(225, 6, 0, ${0.12 * (1 - pp * 0.5)})`)
  glow.addColorStop(1, 'rgba(225, 6, 0, 0)')
  ctx.fillStyle = glow
  ctx.fillRect(0, 0, W, H)

  // Subtitle fade up
  if (pp > 0.4) {
    const tp = (pp - 0.4) / 0.4
    ctx.font = '500 22px Inter, sans-serif'
    ctx.fillStyle = `rgba(255,255,255,${tp * 0.7})`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText('Technology without the noise', W/2, H/2 + 90)
  }
}

/**
 * Scene 3: BREAKING NEWS energy burst + data streams
 */
function drawScene3(ctx, p) {
  const pp = p  // 0→1 over 2.5s

  // Dark background with energy gradient
  const grad = ctx.createRadialGradient(W/2, H*0.4, 0, W/2, H*0.4, W*0.6)
  grad.addColorStop(0, '#1A0505')
  grad.addColorStop(0.5, '#0A0505')
  grad.addColorStop(1, COLORS.bg)
  ctx.fillStyle = grad
  ctx.fillRect(0, 0, W, H)

  // Animated data streams (falling lines)
  for (let i = 0; i < 25; i++) {
    const x = (i * 77.7 + pp * 400) % W
    const yStart = (i * 53.3) % H
    const len = 40 + Math.sin(i + pp * 5) * 20
    const alpha = 0.08 + Math.sin(i + pp * 3) * 0.06
    ctx.fillStyle = `rgba(0, 229, 255, ${Math.max(0, alpha)})`
    ctx.fillRect(x, (yStart + pp * 600) % H, 1, len)
  }

  // AI circuit overlay (hexagonal-ish nodes)
  ctx.strokeStyle = `rgba(0, 229, 255, ${0.04 + Math.sin(pp * 4) * 0.03})`
  ctx.lineWidth = 1
  for (let i = 0; i < 8; i++) {
    const cx = 100 + i * 240
    const cy = 100 + (i % 3) * 200
    const r = 40 + Math.sin(pp * 2 + i) * 10
    ctx.beginPath()
    for (let j = 0; j < 6; j++) {
      const angle = (j / 6) * Math.PI * 2 - Math.PI / 2
      const px = cx + r * Math.cos(angle)
      const py = cy + r * Math.sin(angle)
      j === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py)
    }
    ctx.closePath()
    ctx.stroke()
  }

  // "BREAKING NEWS" with energy burst
  const burstP = Math.min(1, pp * 2)
  const scale = 0.6 + burstP * 0.4
  const alpha = Math.min(1, burstP * 2)

  ctx.save()
  ctx.globalAlpha = alpha
  ctx.translate(W/2, H/2 - 40)
  ctx.scale(scale, scale)

  // Energy burst rings
  ctx.strokeStyle = `rgba(225, 6, 0, ${0.3 * (1 - burstP)})`
  ctx.lineWidth = 3 * (1 - burstP)
  ctx.beginPath()
  ctx.arc(0, 0, 200 * (1 + burstP * 2), 0, Math.PI * 2)
  ctx.stroke()

  // Text
  ctx.font = '900 80px Anton, Impact, sans-serif'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'

  // Red shadow for energy feel
  ctx.shadowColor = COLORS.red
  ctx.shadowBlur = 40 * (1 - burstP * 0.5)
  ctx.fillStyle = '#FFFFFF'
  ctx.fillText('BREAKING', 0, -45)
  ctx.fillStyle = COLORS.red
  ctx.fillText('NEWS', 0, 45)
  ctx.shadowBlur = 0

  ctx.restore()

  // Tagline
  if (pp > 0.3) {
    const tp = Math.min(1, (pp - 0.3) / 0.3)
    ctx.font = '500 42px Inter, sans-serif'
    ctx.fillStyle = `rgba(255,255,255,${tp * 0.8})`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText('Real Tech. Real Trends. Real News.', W/2, H/2 + 90)
  }

  // 4K HDR badge (top right)
  ctx.fillStyle = 'rgba(0,0,0,0.6)'
  ctx.beginPath()
  ctx.roundRect(W - 130, 25, 105, 32, 6)
  ctx.fill()
  ctx.strokeStyle = COLORS.cyan
  ctx.lineWidth = 1
  ctx.beginPath()
  ctx.roundRect(W - 130, 25, 105, 32, 6)
  ctx.stroke()
  ctx.font = '700 14px Inter, sans-serif'
  ctx.fillStyle = COLORS.cyan
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText('4K HDR', W - 77, 41)
}

/**
 * Scene 4: Global AI network globe + radar scan
 */
function drawScene4(ctx, p) {
  const pp = p  // 0→1 over 2.5s

  // Dark space background
  ctx.fillStyle = '#050505'
  ctx.fillRect(0, 0, W, H)

  // Globe (wireframe sphere)
  const cx = W/2, cy = H/2, r = 300
  ctx.strokeStyle = `rgba(0, 229, 255, ${0.12 + Math.sin(pp * 2) * 0.05})`
  ctx.lineWidth = 1

  // Horizontal rings
  for (let lat = 0; lat < 5; lat++) {
    const latAngle = (lat / 5) * Math.PI - Math.PI / 2
    const ringR = r * Math.cos(latAngle)
    const ringY = cy + r * Math.sin(latAngle)
    if (ringR > 5) {
      ctx.beginPath()
      ctx.ellipse(cx, ringY, ringR, ringR * 0.35, 0, 0, Math.PI * 2)
      ctx.stroke()
    }
  }

  // Vertical meridians (rotating)
  for (let lon = 0; lon < 6; lon++) {
    const lonAngle = (lon / 6) * Math.PI * 2 + pp * 0.5
    const a = r
    const b = r * 0.4
    ctx.beginPath()
    for (let t = 0; t <= 60; t++) {
      const angle = (t / 60) * Math.PI * 2
      const px = cx + a * Math.cos(angle + lonAngle) * 0.5
      const py = cy + b * Math.sin(angle)
      t === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py)
    }
    ctx.stroke()
  }

  // Network connection lines on globe surface
  ctx.strokeStyle = `rgba(225, 6, 0, ${0.06 + Math.sin(pp * 3) * 0.04})`
  ctx.lineWidth = 0.8
  for (let i = 0; i < 20; i++) {
    const angle1 = (i * 47.7) % (Math.PI * 2)
    const angle2 = ((i + 7) * 47.7 + pp) % (Math.PI * 2)
    const x1 = cx + r * 0.5 * Math.cos(angle1)
    const y1 = cy + r * 0.4 * Math.sin(angle1)
    const x2 = cx + r * 0.5 * Math.cos(angle2)
    const y2 = cy + r * 0.4 * Math.sin(angle2)
    ctx.beginPath()
    ctx.moveTo(x1, y1)
    ctx.lineTo(x2, y2)
    ctx.stroke()
  }

  // Radar scan line
  const scanAngle = pp * Math.PI * 2
  ctx.strokeStyle = `rgba(0, 229, 255, 0.15)`
  ctx.lineWidth = 2
  ctx.beginPath()
  ctx.moveTo(cx, cy)
  ctx.lineTo(cx + r * 0.6 * Math.cos(scanAngle), cy + r * 0.4 * Math.sin(scanAngle))
  ctx.stroke()

  // Radar sweep fill
  const sweep = ctx.createConicGradient(scanAngle, cx, cy)
  sweep.addColorStop(0, 'rgba(0, 229, 255, 0.05)')
  sweep.addColorStop(0.05, 'rgba(0, 229, 255, 0.02)')
  sweep.addColorStop(1, 'rgba(0, 229, 255, 0)')
  ctx.fillStyle = sweep
  ctx.beginPath()
  ctx.ellipse(cx, cy, r * 0.6, r * 0.4, 0, scanAngle - 0.5, scanAngle)
  ctx.fill()

  // "BREAKING NOW" flash in — RED
  const fp = Math.min(1, pp * 1.5)
  ctx.font = `800 ${70 + fp * 10}px Anton, Impact, sans-serif`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillStyle = `rgba(225, 6, 0, ${fp})`
  ctx.shadowColor = COLORS.red
  ctx.shadowBlur = 30 * fp
  ctx.fillText('BREAKING NOW', W/2, H * 0.15)
  ctx.shadowBlur = 0
}

/**
 * Scene 5: Final card — TECH-MONSTER logo + anchor + ticker
 */
function drawScene5(ctx, p) {
  const pp = p  // 0→1 over 2.5s

  // Dark premium background
  const grad = ctx.createRadialGradient(W/2, H/2, 0, W/2, H/2, W*0.7)
  grad.addColorStop(0, '#0D0D0D')
  grad.addColorStop(1, COLORS.bg)
  ctx.fillStyle = grad
  ctx.fillRect(0, 0, W, H)

  // Subtle grid
  ctx.strokeStyle = `rgba(0, 229, 255, 0.03)`
  ctx.lineWidth = 0.5
  for (let x = 0; x < W; x += 40) {
    ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke()
  }
  for (let y = 0; y < H; y += 40) {
    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke()
  }

  // TECH-MONSTER logo (red square + T)
  const logoSize = 100
  const logoX = W/2 - logoSize/2
  const logoY = H * 0.2

  // Logo scale in
  const ls = Math.min(1, pp * 2)
  ctx.save()
  ctx.translate(W/2, logoY + logoSize/2)
  ctx.scale(ls, ls)
  ctx.translate(-W/2, -(logoY + logoSize/2))

  // Red square
  ctx.fillStyle = COLORS.red
  ctx.beginPath()
  ctx.roundRect(logoX, logoY, logoSize, logoSize, 14)
  ctx.fill()

  // T letter
  ctx.font = '900 64px Anton, Impact, sans-serif'
  ctx.fillStyle = '#FFFFFF'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText('T', W/2, logoY + logoSize/2 + 6)

  ctx.restore()

  // Channel name
  const nameP = Math.min(1, (pp - 0.1) / 0.4)
  ctx.font = '900 52px Anton, Impact, sans-serif'
  ctx.fillStyle = `rgba(255,255,255,${nameP})`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText('TECH-MONSTER', W/2, H * 0.48)

  // Tagline
  const tagP = Math.min(1, (pp - 0.25) / 0.3)
  ctx.font = '500 42px Inter, sans-serif'
  ctx.fillStyle = `rgba(255,255,255,${tagP * 0.8})`
  ctx.fillText('Real Tech. Real Trends. Real News.', W/2, H * 0.56)

  // Anchor
  const ancP = Math.min(1, (pp - 0.35) / 0.3)
  ctx.font = '700 24px Inter, sans-serif'
  ctx.fillStyle = `rgba(0, 229, 255, ${ancP * 0.9})`
  ctx.fillText('Hosted by sham435', W/2, H * 0.66)

  // Live indicator (pulsing dot)
  const dotPulse = 0.4 + Math.sin(pp * 20) * 0.3
  ctx.fillStyle = `rgba(255, 0, 0, ${dotPulse})`
  ctx.beginPath()
  ctx.arc(W/2 - 140, H * 0.75, 8, 0, Math.PI * 2)
  ctx.fill()

  // LIVE text
  ctx.font = '700 18px Inter, sans-serif'
  ctx.fillStyle = COLORS.red
  ctx.textAlign = 'left'
  ctx.textBaseline = 'middle'
  ctx.fillText('LIVE', W/2 - 122, H * 0.75)

  // Glass panel for ticker
  ctx.fillStyle = COLORS.glass
  ctx.beginPath()
  ctx.roundRect(W/2 - 400, H * 0.82, 800, 50, 10)
  ctx.fill()
  ctx.strokeStyle = COLORS.glassBorder
  ctx.lineWidth = 1
  ctx.beginPath()
  ctx.roundRect(W/2 - 400, H * 0.82, 800, 50, 10)
  ctx.stroke()

  // Ticker items (scrolling)
  const tickerItems = ['AI', 'Robotics', 'Cybersecurity', 'Startups', 'Space', 'Science', 'Programming', 'Open Source']
  const tickP = pp * tickerItems.length
  const visibleCount = 4

  ctx.font = '600 16px Inter, sans-serif'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'

  for (let i = 0; i < visibleCount; i++) {
    const idx = Math.floor(tickP + i) % tickerItems.length
    const x = W/2 - 200 + i * 110
    const itemAlpha = (i === 0) ? 1 - (tickP % 1) : 0.7
    ctx.fillStyle = `rgba(255,255,255,${itemAlpha})`
    ctx.fillText(tickerItems[idx], x, H * 0.85 + 25)
  }

  // Accent line
  ctx.fillStyle = COLORS.red
  ctx.fillRect(W/2 - 80, H * 0.78, 160, 2)

  // Bottom: "TECH-MONSTER" watermark
  ctx.font = '500 12px Inter, sans-serif'
  ctx.fillStyle = 'rgba(255,255,255,0.25)'
  ctx.textAlign = 'right'
  ctx.textBaseline = 'bottom'
  ctx.fillText('TECH-MONSTER', W - 20, H - 10)
}

// ===================================================================
// FRAME GENERATOR
// ===================================================================

function drawFrame(progress, outPath) {
  const canvas = createCanvas(W, H)
  const ctx = canvas.getContext('2d')

  // Normalize progress to scene boundaries
  if (progress < 2/12) {
    // Scene 1: 0-2s
    const p = progress / (2/12)
    drawScene1(ctx, p)
  } else if (progress < 4.5/12) {
    // Scene 2: 2-4.5s
    const p = (progress - 2/12) / (2.5/12)
    drawScene2(ctx, p)
  } else if (progress < 7/12) {
    // Scene 3: 4.5-7s
    const p = (progress - 4.5/12) / (2.5/12)
    drawScene3(ctx, p)
  } else if (progress < 9.5/12) {
    // Scene 4: 7-9.5s
    const p = (progress - 7/12) / (2.5/12)
    drawScene4(ctx, p)
  } else {
    // Scene 5: 9.5-12s
    const p = (progress - 9.5/12) / (2.5/12)
    drawScene5(ctx, p)
  }

  // Channel watermark (always visible, top-left)
  ctx.font = '600 11px Inter, sans-serif'
  ctx.fillStyle = 'rgba(255,255,255,0.15)'
  ctx.textAlign = 'left'
  ctx.textBaseline = 'top'
  ctx.fillText('TECH-MONSTER', 20, 15)

  // Progress bar (bottom)
  ctx.fillStyle = 'rgba(255,255,255,0.05)'
  ctx.fillRect(0, H - 3, W, 3)
  ctx.fillStyle = COLORS.red
  ctx.fillRect(0, H - 3, W * progress, 3)

  fs.writeFileSync(outPath, canvas.toBuffer('image/png'))
}

// ===================================================================
// EXPORT — GENERATE FULL INTRO
// ===================================================================

export function generateCommonIntro(outDir = 'output', format = 'hd') {
  fs.mkdirSync(outDir, { recursive: true })
  const framesDir = `${outDir}/intro_frames`
  fs.mkdirSync(framesDir, { recursive: true })

  console.log(`🎬 Generating TECH-MONSTER intro: ${TOTAL_FRAMES} frames (${FPS}fps, 12s)`)

  for (let i = 0; i < TOTAL_FRAMES; i++) {
    const progress = i / TOTAL_FRAMES
    drawFrame(progress, `${framesDir}/f${String(i).padStart(4, '0')}.png`)
    if (i % 60 === 0) process.stdout.write(`  Frame ${i}/${TOTAL_FRAMES}\r`)
  }
  process.stdout.write(`  Frame ${TOTAL_FRAMES}/${TOTAL_FRAMES} ✅\n`)

  // FFmpeg settings
  const outputRes = format === '4k' ? '3840:2160' : '1920:1080'
  const crf = format === '4k' ? '18' : '20'
  const pixelFormat = format === '4k' ? 'yuv420p10le' : 'yuv420p'

  const introVideo = `${outDir}/intro_12s.mp4`
  const music = 'assets/music/intro_whoosh.mp3'

  // Generate intro cinematic audio
  generateIntroAudio(`${outDir}/intro_audio.mp3`)

  const hasMusic = fs.existsSync(`${outDir}/intro_audio.mp3`)

  const cmd = hasMusic
    ? `ffmpeg -y -framerate ${FPS} -i "${framesDir}/f%04d.png" -i "${outDir}/intro_audio.mp3" -c:v libx264 -crf ${crf} -preset medium -pix_fmt ${pixelFormat} -c:a aac -b:a 192k -shortest -t 12 "${introVideo}"`
    : `ffmpeg -y -framerate ${FPS} -i "${framesDir}/f%04d.png" -f lavfi -i "anullsrc=r=44100:cl=stereo" -c:v libx264 -crf ${crf} -preset medium -pix_fmt ${pixelFormat} -c:a aac -shortest -t 12 "${introVideo}"`

  console.log(`🎥 Encoding intro @ ${outputRes}...`)
  execSync(cmd, { stdio: 'inherit' })

  // If 4K, upscale
  if (format === '4k') {
    const upscaled = `${outDir}/intro_12s_4k.mp4`
    execSync(
      `ffmpeg -y -i "${introVideo}" -vf "scale=3840:2160:flags=lanczos" -c:v libx264 -crf 18 -preset slow -c:a copy "${upscaled}"`,
      { stdio: 'inherit' }
    )
    fs.copyFileSync(upscaled, introVideo)
    console.log('✅ Upscaled to 4K')
  }

  console.log('✅ TECH-MONSTER intro:', introVideo)
  return introVideo
}

/**
 * Generate 12s intro audio: impact → whoosh → bass bed → finish
 */
function generateIntroAudio(outPath) {
  try {
    const parts = []
    // Impact hit (0-0.5s)
    parts.push('-f lavfi -t 0.5 -i "sine=f=60:r=44100,afade=t=out:st=0.4:d=0.1,volume=0.6"')
    // Whoosh rise (0.5-2s)
    parts.push('-f lavfi -t 1.5 -i "sine=f=200:r=44100,afade=t=in:st=0:d=0.3,afade=t=out:st=1.2:d=0.3,volume=0.2"')
    // Ambient bass bed (2-12s)
    parts.push('-f lavfi -t 10 -i "sine=f=55:r=44100,volume=0.15"')
    // Pink noise texture
    parts.push('-f lavfi -t 12 -i "anoisesrc=d=12:c=pink:a=0.03:r=44100,afade=t=in:st=0:d=1,afade=t=out:st=10:d=2,volume=0.2"')
    // Cinematic hit at end (11.5-12s)
    parts.push('-f lavfi -t 0.8 -i "sine=f=80:r=44100,afade=t=in:st=0:d=0.01,afade=t=out:st=0.7:d=0.1,volume=0.5"')

    const cmd = `ffmpeg -y ${parts.join(' ')} \
      -filter_complex "[0:a][1:a][2:a][3:a][4:a]amix=inputs=5:duration=longest:normalize=0,volume=0.6,aformat=sample_rates=44100:channel_layouts=stereo,afade=t=out:st=11.5:d=0.5[a]" \
      -map "[a]" -c:a libmp3lame -b:a 192k "${outPath}"`

    execSync(cmd, { stdio: 'pipe', timeout: 15000 })
    console.log('✅ Intro audio generated')
  } catch (e) {
    console.log('⚠️ Intro audio generation skipped:', e.message)
  }
}

// CLI
if (import.meta.url.endsWith('intro.mjs')) {
  const outDir = process.argv[2] || 'output'
  const format = process.argv.includes('--4k') ? '4k' : 'hd'
  generateCommonIntro(outDir, format)
}
