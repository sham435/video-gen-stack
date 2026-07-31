import { DesignSystem } from '../../visuals/DesignSystem.mjs'

const { W, H } = DesignSystem

export class GlassCardLayer {
  draw(ctx, scene, progress, options = {}) {
    const p = Math.min(1, (progress - (options.delay || 0)) / (options.duration || 0.3))
    if (p <= 0) return

    const glass = DesignSystem.glass
    const x = options.x ?? W * 0.05
    const y = options.y ?? H * 0.65
    const w = options.width ?? W * 0.9
    const h = options.height ?? 200
    const r = options.radius ?? glass.radius

    ctx.save()
    ctx.globalAlpha = p

    ctx.fillStyle = glass.backdrop
    ctx.beginPath()
    ctx.roundRect(x, y, w, h, r)
    ctx.fill()

    ctx.fillStyle = glass.background
    ctx.beginPath()
    ctx.roundRect(x, y, w, h, r)
    ctx.fill()

    ctx.strokeStyle = options.borderColor || glass.border
    ctx.lineWidth = 1
    ctx.beginPath()
    ctx.roundRect(x, y, w, h, r)
    ctx.stroke()

    if (options.accentLine) {
      ctx.fillStyle = DesignSystem.getCategoryStyle(options.category || 'technology').colors.primary
      ctx.fillRect(x + 20, y + 10, 4, h - 20)
    }

    ctx.restore()
  }
}