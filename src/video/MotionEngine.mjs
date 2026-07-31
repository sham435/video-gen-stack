const W = 1080, H = 1920

const EFFECTS = {
  glitch_red(ctx, p) {
    if (Math.random() > 0.08 / (p + 0.1)) return
    const sliceH = 2 + Math.random() * 10
    const sliceY = Math.random() * H
    const offset = (Math.random() - 0.5) * 30 * (1 - p)
    ctx.save()
    ctx.globalAlpha = 0.3 + Math.random() * 0.4
    ctx.fillStyle = '#E10600'
    ctx.fillRect(Math.max(0, offset), sliceY, W, sliceH)
    ctx.fillStyle = '#00E5FF'
    ctx.fillRect(offset > 0 ? 0 : W + offset, sliceY + sliceH + 2, W, sliceH)
    ctx.restore()
  },

  rgb_split(ctx, p) {
    if (Math.random() > 0.06) return
    const offset = (Math.random() - 0.5) * 8 * (1 - p)
    ctx.save()
    ctx.globalCompositeOperation = 'screen'
    ctx.globalAlpha = 0.15
    ctx.fillStyle = '#FF0000'
    ctx.fillRect(offset, 0, W, H)
    ctx.fillStyle = '#00FFFF'
    ctx.fillRect(-offset, 0, W, H)
    ctx.restore()
  },

  scan_lines(ctx, p) {
    ctx.save()
    ctx.fillStyle = `rgba(0, 229, 255, ${0.015 + Math.sin(p * 60) * 0.01})`
    for (let i = 0; i < H; i += 4) ctx.fillRect(0, i, W, 1)
    ctx.restore()
  },

  vignette(ctx, p) {
    const radius = W * 0.7
    const grad = ctx.createRadialGradient(W / 2, H / 2, radius * 0.4, W / 2, H / 2, radius)
    grad.addColorStop(0, 'rgba(0,0,0,0)')
    grad.addColorStop(1, `rgba(0,0,0,${0.4 + Math.sin(p * 3) * 0.1})`)
    ctx.fillStyle = grad
    ctx.fillRect(0, 0, W, H)
  },

  camera_shake(ctx, p) {
    const intensity = 3 * (1 - p)
    if (intensity < 0.5) return
    const sx = (Math.random() - 0.5) * intensity
    const sy = (Math.random() - 0.5) * intensity
    ctx.translate(sx, sy)
  },

  particle_burst(ctx, p) {
    if (p > 0.3) return
    const count = 30
    for (let i = 0; i < count; i++) {
      const angle = (i / count) * Math.PI * 2 + p * 5
      const dist = p * 200 * (0.5 + Math.random() * 0.5)
      const x = W / 2 + Math.cos(angle) * dist
      const y = H / 2 + Math.sin(angle) * dist
      const size = 2 + Math.random() * 3 * (1 - p)
      ctx.fillStyle = `rgba(225, 6, 0, ${0.3 * (1 - p)})`
      ctx.beginPath()
      ctx.arc(x, y, size, 0, Math.PI * 2)
      ctx.fill()
    }
  },

  light_sweep(ctx, p) {
    const sweepX = (p * 1.5 % 1) * W * 1.5 - W * 0.25
    const grad = ctx.createLinearGradient(sweepX - 80, 0, sweepX + 80, 0)
    grad.addColorStop(0, 'rgba(255,255,255,0)')
    grad.addColorStop(0.5, 'rgba(255,255,255,0.04)')
    grad.addColorStop(1, 'rgba(255,255,255,0)')
    ctx.fillStyle = grad
    ctx.fillRect(0, 0, W, H)
  },

  noise_overlay(ctx, p) {
    const density = 0.01
    ctx.fillStyle = 'rgba(255,255,255,0.03)'
    for (let i = 0; i < W * H * density; i++) {
      const x = Math.random() * W
      const y = Math.random() * H
      ctx.fillRect(x, y, 1, 1)
    }
  },

  cameraPush(ctx, p, color = '#00E5FF') {
    const zoom = 1 + Math.sin(p * Math.PI * 0.5) * 0.03
    ctx.translate(W / 2, H / 2)
    ctx.scale(zoom, zoom)
    ctx.translate(-W / 2, -H / 2)
  },

  cameraOrbit(ctx, p, radius = 15) {
    const angle = p * Math.PI * 2
    const ox = Math.cos(angle) * radius
    const oy = Math.sin(angle) * radius * 0.5
    ctx.translate(ox, oy)
  },

  depthBlur(ctx, p, intensity = 0.3) {
    const blurAmount = Math.sin(p * Math.PI) * intensity
    ctx.save()
    ctx.globalAlpha = blurAmount * 0.15
    ctx.fillStyle = '#000000'
    ctx.fillRect(0, 0, W, H * 0.05)
    ctx.fillRect(0, H * 0.95, W, H * 0.05)
    const grad = ctx.createRadialGradient(W / 2, H / 2, H * 0.2, W / 2, H / 2, H * 0.5)
    grad.addColorStop(0, 'rgba(0,0,0,0)')
    grad.addColorStop(1, `rgba(0,0,0,${blurAmount * 0.4})`)
    ctx.fillStyle = grad
    ctx.fillRect(0, 0, W, H)
    ctx.restore()
  },

  particleField(ctx, p, color = '#00E5FF', count = 40) {
    const phase = p * 60
    for (let i = 0; i < count; i++) {
      const seed = i * 137.508
      const x = (Math.sin(seed + phase * 0.01) * 0.5 + 0.5) * W
      const y = (Math.cos(seed * 1.3 + phase * 0.008) * 0.5 + 0.5) * H
      const size = 1.5 + Math.sin(seed + phase * 0.02) * 1.5
      const alpha = 0.1 + Math.sin(seed + phase * 0.015) * 0.1
      ctx.fillStyle = color + Math.floor(Math.max(0, alpha * 255)).toString(16).padStart(2, '0')
      ctx.beginPath()
      ctx.arc(x, y, size, 0, Math.PI * 2)
      ctx.fill()
    }
  },

  digitalHUD(ctx, p, color = '#00E5FF') {
    ctx.save()
    ctx.strokeStyle = color
    ctx.lineWidth = 1.5

    const corners = [
      [20, 20, 30, 8],
      [W - 20, 20, 30, 8],
      [20, H - 20, 30, 8],
      [W - 20, H - 20, 30, 8],
    ]
    for (const [cx, cy, len, gap] of corners) {
      ctx.beginPath()
      const vx = cx < W / 2 ? 1 : -1
      const vy = cy < H / 2 ? 1 : -1
      ctx.moveTo(cx + vx * gap, cy)
      ctx.lineTo(cx + vx * (gap + len), cy)
      ctx.moveTo(cx, cy + vy * gap)
      ctx.lineTo(cx, cy + vy * (gap + len))
      ctx.stroke()
    }

    ctx.globalAlpha = 0.2 + Math.sin(p * 4) * 0.1
    ctx.beginPath()
    ctx.moveTo(W / 2 - 60, 40)
    ctx.lineTo(W / 2 + 60, 40)
    ctx.stroke()
    ctx.beginPath()
    ctx.moveTo(W / 2 - 40, 48)
    ctx.lineTo(W / 2 + 40, 48)
    ctx.stroke()
    ctx.restore()
  },

  cinematicReveal(ctx, p, color = '#FFFFFF') {
    const reveal = Math.min(1, p * 2)
    const barH = H * 0.5 * (1 - reveal)
    ctx.save()
    ctx.globalAlpha = 1 - reveal * 0.5
    ctx.fillStyle = '#000000'
    ctx.fillRect(0, 0, W, barH)
    ctx.fillRect(0, H - barH, W, barH)
    ctx.restore()
    ctx.save()
    ctx.globalAlpha = reveal * 0.3
    const linePos = H / 2 + Math.sin(p * 8) * 50
    ctx.strokeStyle = color
    ctx.lineWidth = 1
    ctx.beginPath()
    ctx.moveTo(0, linePos)
    ctx.lineTo(W, linePos)
    ctx.stroke()
    ctx.restore()
  },

  lensFlare(ctx, p, color = '#00E5FF') {
    if (Math.random() > 0.03) return
    const x = W * 0.2 + Math.random() * W * 0.6
    const y = H * 0.2 + Math.random() * H * 0.6
    ctx.save()
    ctx.globalAlpha = 0.08 + Math.random() * 0.06
    const grad = ctx.createRadialGradient(x, y, 0, x, y, 40)
    grad.addColorStop(0, color)
    grad.addColorStop(0.5, color + '80')
    grad.addColorStop(1, color + '00')
    ctx.fillStyle = grad
    ctx.beginPath()
    ctx.arc(x, y, 40, 0, Math.PI * 2)
    ctx.fill()
    for (let i = 1; i <= 3; i++) {
      const dx = (Math.random() - 0.5) * 60
      const dy = (Math.random() - 0.5) * 60
      const s = 5 + Math.random() * 15
      ctx.globalAlpha = 0.03
      ctx.beginPath()
      ctx.arc(x + dx, y + dy, s, 0, Math.PI * 2)
      ctx.fill()
    }
    ctx.restore()
  },

  smartTransition(ctx, p, type = 'crossfade') {
    if (type === 'crossfade') {
      ctx.save()
      ctx.globalAlpha = 1 - p
      ctx.fillStyle = '#000000'
      ctx.fillRect(0, 0, W, H)
      ctx.restore()
    } else if (type === 'flash') {
      const flash = Math.sin(p * Math.PI)
      ctx.save()
      ctx.globalAlpha = flash * 0.6
      ctx.fillStyle = '#FFFFFF'
      ctx.fillRect(0, 0, W, H)
      ctx.restore()
    } else if (type === 'glitch') {
      if (Math.random() > 0.3) return
      ctx.save()
      ctx.globalAlpha = 0.4
      for (let i = 0; i < 5; i++) {
        const sy = Math.random() * H
        const sh = 2 + Math.random() * 15
        const ox = (Math.random() - 0.5) * 40 * (1 - p)
        ctx.fillStyle = Math.random() > 0.5 ? '#E10600' : '#00E5FF'
        ctx.fillRect(ox > 0 ? 0 : W + ox, sy, W, sh)
      }
      ctx.restore()
    }
  },
}

export function applyMotionEffect(ctx, effectName, progress, ...args) {
  const effect = EFFECTS[effectName]
  if (effect) effect(ctx, progress, ...args)
}

export function applyDefaultEffects(ctx, progress) {
  EFFECTS.vignette(ctx, progress)
  EFFECTS.scan_lines(ctx, progress)
  EFFECTS.noise_overlay(ctx, progress)
}

export const CINEMATIC_EFFECTS = EFFECTS