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
}

export function applyMotionEffect(ctx, effectName, progress) {
  const effect = EFFECTS[effectName]
  if (effect) effect(ctx, progress)
}

export function applyDefaultEffects(ctx, progress) {
  EFFECTS.vignette(ctx, progress)
  EFFECTS.scan_lines(ctx, progress)
  EFFECTS.noise_overlay(ctx, progress)
}
